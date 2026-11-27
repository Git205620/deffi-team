const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const fetch = require('node-fetch');

const app = express();
const PORT = process.env.PORT || 3000;
const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_CHAT_ID = process.env.ADMIN_CHAT_ID;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const OWNER_TELEGRAM_ID = String(process.env.OWNER_TELEGRAM_ID || '1497750238');
const PRODUCTS_FILE = path.join(__dirname, 'products.json');
const ADMINS_FILE = path.join(__dirname, 'admins.json');

if (!fs.existsSync(PRODUCTS_FILE)) {
  fs.writeFileSync(PRODUCTS_FILE, JSON.stringify([
    { id: 1, name: 'Одноразка Elf Bar 1500', description: 'Клубника · 1500 затяжек', price: 450, stock: 12, photo: '' },
    { id: 2, name: 'Одноразка HQD Cuvie', description: 'Мята · 900 затяжек', price: 380, stock: 8, photo: '' }
  ], null, 2));
}
if (!fs.existsSync(ADMINS_FILE)) fs.writeFileSync(ADMINS_FILE, '[]');

app.use(cors());
app.use(bodyParser.json({ limit: '1mb' }));
app.use(express.static(__dirname));

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}
function readAdmins() {
  const list = readJson(ADMINS_FILE, []);
  return Array.isArray(list) ? list.map(String).filter(id => id !== OWNER_TELEGRAM_ID) : [];
}
function validateTelegramInitData(initData) {
  if (!BOT_TOKEN || !initData || typeof initData !== 'string') return null;
  try {
    const params = new URLSearchParams(initData);
    const receivedHash = params.get('hash');
    const authDate = Number(params.get('auth_date'));
    if (!receivedHash || !authDate || Math.abs(Date.now() / 1000 - authDate) > 86400) return null;
    const entries = [...params.entries()].filter(([key]) => key !== 'hash').sort(([a], [b]) => a.localeCompare(b));
    const dataCheckString = entries.map(([key, value]) => `${key}=${value}`).join('\n');
    const secretKey = crypto.createHmac('sha256', 'WebAppData').update(BOT_TOKEN).digest();
    const calculatedHash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');
    const a = Buffer.from(calculatedHash, 'hex');
    const b = Buffer.from(receivedHash, 'hex');
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
    const user = JSON.parse(params.get('user') || 'null');
    if (!user || !Number.isSafeInteger(Number(user.id))) return null;
    return { id: String(user.id), user };
  } catch { return null; }
}
function authenticateTelegram(req, res, next) {
  const auth = validateTelegramInitData(req.get('X-Telegram-Init-Data'));
  if (!auth) return res.status(401).json({ error: 'Откройте приложение через Telegram' });
  req.telegramUser = auth;
  next();
}
function requireAdmin(req, res, next) {
  if (!req.telegramUser) return res.status(401).json({ error: 'Необходима авторизация Telegram' });
  const id = req.telegramUser.id;
  if (id !== OWNER_TELEGRAM_ID && !readAdmins().includes(id)) return res.status(403).json({ error: 'Нет доступа к админ-панели' });
  req.adminRole = id === OWNER_TELEGRAM_ID ? 'owner' : 'admin';
  next();
}
function requireOwner(req, res, next) {
  if (req.adminRole !== 'owner') return res.status(403).json({ error: 'Только владелец может управлять администраторами' });
  next();
}
function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}

app.get('/api/products', (req, res) => {
  const products = readJson(PRODUCTS_FILE, null);
  if (!products) return res.status(500).json({ error: 'Ошибка чтения товаров' });
  res.json(products);
});

app.get('/api/admin/me', authenticateTelegram, (req, res) => {
  const id = req.telegramUser.id;
  const role = id === OWNER_TELEGRAM_ID ? 'owner' : readAdmins().includes(id) ? 'admin' : null;
  res.json({ authorized: Boolean(role), role, userId: id });
});

app.get('/api/admin/admins', authenticateTelegram, requireAdmin, requireOwner, (req, res) => {
  res.json({ ownerId: OWNER_TELEGRAM_ID, admins: readAdmins() });
});
app.post('/api/admin/admins', authenticateTelegram, requireAdmin, requireOwner, (req, res) => {
  const id = String(req.body.telegramId || '').trim();
  if (!/^\d{5,20}$/.test(id)) return res.status(400).json({ error: 'Введите корректный числовой Telegram ID' });
  if (id === OWNER_TELEGRAM_ID) return res.status(400).json({ error: 'Владелец уже имеет полный доступ' });
  const admins = readAdmins();
  if (!admins.includes(id)) admins.push(id);
  fs.writeFileSync(ADMINS_FILE, JSON.stringify(admins, null, 2));
  res.json({ success: true, admins });
});
app.delete('/api/admin/admins/:telegramId', authenticateTelegram, requireAdmin, requireOwner, (req, res) => {
  const id = String(req.params.telegramId);
  const admins = readAdmins().filter(adminId => adminId !== id);
  fs.writeFileSync(ADMINS_FILE, JSON.stringify(admins, null, 2));
  res.json({ success: true, admins });
});

app.post('/api/admin/products', authenticateTelegram, requireAdmin, (req, res) => {
  try {
    const products = req.body.products;
    if (!Array.isArray(products) || products.length > 1000) return res.status(400).json({ error: 'Некорректный список товаров' });
    const ids = new Set();
    for (const p of products) {
      if (!Number.isSafeInteger(Number(p.id)) || Number(p.id) < 1 || ids.has(Number(p.id))) return res.status(400).json({ error: 'Некорректный ID товара' });
      ids.add(Number(p.id));
      if (typeof p.name !== 'string' || !p.name.trim() || p.name.length > 160) return res.status(400).json({ error: 'Проверьте название товара' });
      if (!Number.isFinite(Number(p.price)) || Number(p.price) < 0 || Number(p.price) > 10000000) return res.status(400).json({ error: 'Проверьте цену' });
      if (!Number.isSafeInteger(Number(p.stock)) || Number(p.stock) < 0) return res.status(400).json({ error: 'Проверьте остаток' });
      if (p.photo && (typeof p.photo !== 'string' || !/^https:\/\//i.test(p.photo))) return res.status(400).json({ error: 'Ссылка на фото должна начинаться с https://' });
    }
    fs.writeFileSync(PRODUCTS_FILE, JSON.stringify(products, null, 2));
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Ошибка сохранения товаров' });
  }
});

app.post('/api/order', async (req, res) => {
  const order = req.body;
  if (!Array.isArray(order.items) || !order.items.length || order.items.length > 100 || !order.phone) return res.status(400).json({ error: 'Некорректный заказ' });
  if (!['pickup-18', 'pickup-32', 'delivery'].includes(order.deliveryType)) return res.status(400).json({ error: 'Некорректный способ получения' });
  if (order.deliveryType === 'delivery' && (typeof order.address !== 'string' || !order.address.trim())) return res.status(400).json({ error: 'Укажите адрес доставки' });
  const products = readJson(PRODUCTS_FILE, []);
  let subtotal = 0;
  const safeItems = [];
  for (const item of order.items) {
    const product = products.find(p => Number(p.id) === Number(item.id));
    const quantity = Number(item.quantity);
    if (!product || !Number.isSafeInteger(quantity) || quantity < 1 || quantity > Number(product.stock)) return res.status(400).json({ error: 'Проверьте наличие товаров в заказе' });
    subtotal += Number(product.price) * quantity;
    safeItems.push({ name: product.name, price: Number(product.price), quantity });
  }
  const total = subtotal + (order.deliveryType === 'delivery' ? 250 : 0);
  const itemsText = safeItems.map(i => `• ${escapeHtml(i.name)} × ${i.quantity} = ${i.price * i.quantity} ₽`).join('\n');
  const deliveryText = order.deliveryType === 'pickup-18' ? '📍 Самовывоз: 18/70 Зябь' : order.deliveryType === 'pickup-32' ? '📍 Самовывоз: 32/01' : `🚚 Доставка по городу (+250 ₽)\nАдрес: ${escapeHtml(order.address)}`;
  const message = `🛒 <b>Новый заказ DeffiTeam 2.0</b>\n\n👤 Покупатель: ${escapeHtml(order.username ? '@' + order.username : 'без username')}\n📱 Телефон: ${escapeHtml(order.phone)}\n${order.name ? `Имя: ${escapeHtml(order.name)}\n` : ''}\n${itemsText}\n\n💰 Итого: <b>${total} ₽</b>\n${deliveryText}\n\n🕐 ${new Date().toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' })}`;
  if (!BOT_TOKEN || !ADMIN_CHAT_ID) return res.status(503).json({ error: 'Уведомления Telegram не настроены' });
  try {
    const tgResponse = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chat_id: ADMIN_CHAT_ID, text: message, parse_mode: 'HTML' }) });
    const tgData = await tgResponse.json();
    if (tgData.ok) return res.json({ success: true });
    console.error('Telegram error:', tgData);
    res.status(500).json({ error: 'Не удалось отправить заказ в Telegram' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

app.listen(PORT, () => console.log(`DeffiTeam 2.0 запущен на порту ${PORT}; владелец Telegram ID: ${OWNER_TELEGRAM_ID}`));
