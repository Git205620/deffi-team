const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch');

const app = express();
const PORT = process.env.PORT || 3000;
const BOT_TOKEN = process.env.BOT_TOKEN || '';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const ADMIN_CHAT_IDS = (process.env.ADMIN_CHAT_IDS || process.env.ADMIN_CHAT_ID || '')
  .split(',').map(x => x.trim()).filter(Boolean);

const PRODUCTS_FILE = path.join(__dirname, 'products.json');
const ORDERS_FILE = path.join(__dirname, 'orders.json');
const TX_FILE = path.join(__dirname, 'store-transaction.json');

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (e) {
    if (e.code === 'ENOENT') return fallback;
    console.error('Ошибка чтения ' + path.basename(file), e);
    throw e;
  }
}
function atomicWrite(file, value) {
  const temp = file + '.tmp';
  fs.writeFileSync(temp, JSON.stringify(value, null, 2));
  fs.renameSync(temp, file);
}
function recoverTransaction() {
  if (!fs.existsSync(TX_FILE)) return;
  try {
    const tx = JSON.parse(fs.readFileSync(TX_FILE, 'utf8'));
    atomicWrite(PRODUCTS_FILE, tx.products);
    atomicWrite(ORDERS_FILE, tx.orders);
    fs.unlinkSync(TX_FILE);
    console.log('Восстановлена незавершённая транзакция');
  } catch (e) {
    console.error('Не удалось восстановить транзакцию. Файлы не изменяйте вручную.', e);
    throw e;
  }
}
recoverTransaction();
if (!fs.existsSync(PRODUCTS_FILE)) atomicWrite(PRODUCTS_FILE, []);
if (!fs.existsSync(ORDERS_FILE)) atomicWrite(ORDERS_FILE, []);

function loadProducts() { return readJson(PRODUCTS_FILE, []); }
function loadOrders() { return readJson(ORDERS_FILE, []); }
function commitState(products, orders) {
  atomicWrite(TX_FILE, { products, orders, createdAt: new Date().toISOString() });
  atomicWrite(PRODUCTS_FILE, products);
  atomicWrite(ORDERS_FILE, orders);
  fs.unlinkSync(TX_FILE);
}
function adminOk(req) {
  if (!ADMIN_PASSWORD) return false;
  const supplied = (req.body && req.body.password) || req.headers['x-admin-password'];
  return supplied === ADMIN_PASSWORD;
}
function requireAdmin(req, res, next) {
  if (!adminOk(req)) return res.status(401).json({ success: false, error: 'Нет доступа. Войдите заново.' });
  next();
}
function escapeHtml(value) {
  return String(value == null ? '' : value).replace(/[&<>"']/g, c => ({
    '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'
  }[c]));
}
function numberOrZero(value) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0;
}
function warehouseField(warehouse) {
  if (warehouse === '1870') return 'stock1870';
  if (warehouse === '3201') return 'stock3201';
  return null;
}
async function notifyAdmins(message) {
  if (!BOT_TOKEN || !ADMIN_CHAT_IDS.length) {
    console.warn('Заказ сохранён, но BOT_TOKEN/ADMIN_CHAT_IDS не настроены.');
    return false;
  }
  let allOk = true;
  for (const chatId of ADMIN_CHAT_IDS) {
    try {
      const r = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text: message, parse_mode: 'HTML' })
      });
      const data = await r.json();
      if (!data.ok) { allOk = false; console.error('Telegram notification error:', data); }
    } catch (e) { allOk = false; console.error('Telegram notification error:', e); }
  }
  return allOk;
}

app.use(cors());
app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.static(__dirname));

app.get('/', (req, res) => {
  const pub = path.join(__dirname, 'public', 'index.html');
  const root = path.join(__dirname, 'index.html');
  if (fs.existsSync(pub)) return res.sendFile(pub);
  if (fs.existsSync(root)) return res.sendFile(root);
  res.status(404).send('index.html not found');
});

app.get('/api/products', (req, res) => {
  try { res.json(loadProducts()); }
  catch (e) { res.status(500).json({ error: 'Не удалось прочитать каталог' }); }
});

app.post('/api/admin/login', (req, res) => {
  if (!ADMIN_PASSWORD) return res.status(503).json({ success: false, error: 'Задайте ADMIN_PASSWORD в Railway Variables' });
  if (req.body.password === ADMIN_PASSWORD) return res.json({ success: true });
  res.status(401).json({ success: false, error: 'Неверный пароль' });
});

app.post('/api/admin/product', requireAdmin, (req, res) => {
  try {
    const input = req.body.product || {};
    const name = String(input.name || '').trim();
    const price = Number(input.price);
    const category = String(input.category || '').trim();
    if (!name || !Number.isFinite(price) || price <= 0 || !category) {
      return res.status(400).json({ error: 'Проверьте название, категорию и цену' });
    }
    const products = loadProducts();
    const product = {
      id: input.id ? Number(input.id) : (products.reduce((m, p) => Math.max(m, Number(p.id) || 0), 0) + 1),
      name,
      description: String(input.description || ''),
      category,
      subcategory: String(input.subcategory || ''),
      price: Math.round(price),
      stock1870: numberOrZero(input.stock1870),
      stock3201: numberOrZero(input.stock3201),
      photo: String(input.photo || '')
    };
    const index = products.findIndex(p => String(p.id) === String(product.id));
    if (index >= 0) products[index] = product;
    else products.push(product);
    commitState(products, loadOrders());
    res.json({ success: true, product });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Не удалось сохранить товар' });
  }
});

app.post('/api/admin/product/delete', requireAdmin, (req, res) => {
  try {
    const id = String(req.body.id);
    const products = loadProducts().filter(p => String(p.id) !== id);
    commitState(products, loadOrders());
    res.json({ success: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Не удалось удалить товар' });
  }
});

app.post('/api/admin/orders', requireAdmin, (req, res) => {
  try { res.json({ success: true, orders: loadOrders().sort((a,b) => new Date(b.createdAt)-new Date(a.createdAt)) }); }
  catch (e) { res.status(500).json({ error: 'Не удалось загрузить заказы' }); }
});

const ORDER_STATUSES = ['Новый', 'Принят', 'Готовится', 'Готов', 'Выдан', 'Отменён'];
app.post('/api/admin/order/status', requireAdmin, (req, res) => {
  try {
    const { orderId, status } = req.body;
    if (!ORDER_STATUSES.includes(status)) return res.status(400).json({ error: 'Неизвестный статус' });
    const products = loadProducts();
    const orders = loadOrders();
    const order = orders.find(o => String(o.id) === String(orderId));
    if (!order) return res.status(404).json({ error: 'Заказ не найден' });

    if (status === 'Отменён' && order.status !== 'Отменён' && !order.stockRestored) {
      const field = warehouseField(order.warehouse);
      if (!field) return res.status(400).json({ error: 'У заказа не указан склад' });
      for (const item of order.items) {
        const product = products.find(p => String(p.id) === String(item.id));
        if (product) product[field] = numberOrZero(product[field]) + numberOrZero(item.quantity);
      }
      order.stockRestored = true;
    }
    if (order.status === 'Отменён' && status !== 'Отменён') {
      return res.status(409).json({ error: 'Отменённый заказ нельзя вернуть в работу автоматически' });
    }
    order.status = status;
    order.updatedAt = new Date().toISOString();
    commitState(products, orders);
    res.json({ success: true, order });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Не удалось обновить заказ' });
  }
});

app.post('/api/order', async (req, res) => {
  try {
    const body = req.body || {};
    const field = warehouseField(String(body.warehouse || ''));
    if (!field) return res.status(400).json({ error: 'Сначала выберите склад' });
    if (!Array.isArray(body.items) || !body.items.length) return res.status(400).json({ error: 'Корзина пуста' });
    const phone = String(body.phone || '').trim();
    if (!phone) return res.status(400).json({ error: 'Укажите телефон' });
    const deliveryType = body.deliveryType === 'delivery' ? 'delivery' : 'pickup';
    const address = String(body.address || '').trim();
    if (deliveryType === 'delivery' && !address) return res.status(400).json({ error: 'Укажите адрес доставки' });

    const requestId = String(body.requestId || '');
    if (!requestId || requestId.length > 100) return res.status(400).json({ error: 'Обновите страницу и повторите заказ' });

    const products = loadProducts();
    const orders = loadOrders();
    const duplicate = orders.find(o => o.requestId === requestId);
    if (duplicate) return res.json({ success: true, orderId: duplicate.id, duplicate: true });

    const normalized = [];
    let subtotal = 0;
    for (const raw of body.items) {
      const id = String(raw.id);
      const quantity = Number(raw.quantity);
      if (!Number.isInteger(quantity) || quantity < 1 || quantity > 99) {
        return res.status(400).json({ error: 'Некорректное количество товара' });
      }
      const product = products.find(p => String(p.id) === id);
      if (!product) return res.status(409).json({ error: 'Один из товаров больше не доступен. Обновите каталог.' });
      const stock = numberOrZero(product[field]);
      if (stock < quantity) return res.status(409).json({ error: `Недостаточно товара «${product.name}» на выбранном складе. Остаток: ${stock}` });
      normalized.push({ id: product.id, name: product.name, price: Number(product.price), quantity });
      subtotal += Number(product.price) * quantity;
    }
    const deliveryPrice = deliveryType === 'delivery' ? 250 : 0;
    const total = subtotal + deliveryPrice;
    normalized.forEach(item => {
      const product = products.find(p => String(p.id) === String(item.id));
      product[field] = numberOrZero(product[field]) - item.quantity;
    });

    const id = 'D' + Date.now().toString(36).toUpperCase();
    const order = {
      id, requestId, warehouse: String(body.warehouse), items: normalized,
      subtotal, deliveryPrice, total, deliveryType, address: deliveryType === 'delivery' ? address : '',
      name: String(body.name || '').trim().slice(0, 100),
      phone: phone.slice(0, 50),
      username: String(body.username || '').replace(/^@/, '').slice(0, 64),
      userId: body.userId || null,
      status: 'Новый', stockRestored: false,
      createdAt: new Date().toISOString()
    };
    orders.push(order);
    commitState(products, orders);

    const itemsText = normalized.map(i => `• ${escapeHtml(i.name)} × ${i.quantity} = ${i.price * i.quantity} ₽`).join('\n');
    const deliveryText = deliveryType === 'delivery'
      ? `🚚 Доставка (+${deliveryPrice} ₽)\nАдрес: ${escapeHtml(address)}`
      : `📍 Самовывоз: ${order.warehouse === '1870' ? '18/70 Зябь' : '32/01'}`;
    const telegramContact = order.username
      ? `🔗 Telegram: @${escapeHtml(order.username)}`
      : `🔗 Telegram username: не указан${order.userId ? `\n🆔 Telegram ID: ${escapeHtml(order.userId)}` : ''}`;
    const message = `🛒 <b>Новый заказ ${escapeHtml(id)}</b>\n\n` +
      `👤 Имя: ${escapeHtml(order.name || 'Не указано')}\n` +
      `${telegramContact}\n` +
      `📱 Телефон: ${escapeHtml(phone)}\n🏬 Склад: ${order.warehouse === '1870' ? '18/70' : '32/01'}\n\n` +
      `${itemsText}\n\n💰 <b>Итого: ${total} ₽</b>\n${deliveryText}\n` +
      `🕐 ${new Date(order.createdAt).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' })}`;
    const notified = await notifyAdmins(message);
    res.json({ success: true, orderId: id, notificationWarning: !notified });
  } catch (e) {
    console.error('Order error:', e);
    res.status(500).json({ error: 'Ошибка сервера при оформлении заказа' });
  }
});

app.listen(PORT, () => {
  console.log(`Deffi Team запущен на порту ${PORT}`);
  if (!ADMIN_PASSWORD) console.warn('Не задан ADMIN_PASSWORD в переменных окружения');
});
