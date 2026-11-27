const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch');

const app = express();
const PORT = process.env.PORT || 3000;

// ====== НАСТРОЙКИ ======
const BOT_TOKEN = process.env.BOT_TOKEN || '9252459439:AAEuxIAoZeJ7MBrdtBSHR5Ihxa9oGTZzGdg';
const ADMIN_CHAT_ID = process.env.ADMIN_CHAT_ID || '1497750238';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'deffi2026';
// ========================

const PRODUCTS_FILE = path.join(__dirname, 'products.json');

// Создаём файл товаров, если его нет
if (!fs.existsSync(PRODUCTS_FILE)) {
  fs.writeFileSync(PRODUCTS_FILE, JSON.stringify([
    {
      id: 1,
      name: "Одноразка Elf Bar 1500",
      description: "Клубника, 1500 затяжек",
      category: "одноразки",
      price: 450,
      stock: 12,
      photo: ""
    },
    {
      id: 2,
      name: "Одноразка HQD Cuvie",
      description: "Мята, 900 затяжек",
      category: "одноразки",
      price: 380,
      stock: 8,
      photo: ""
    }
  ], null, 2));
}

app.use(cors());
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));

// Получить все товары
app.get('/api/products', (req, res) => {
  try {
    const products = JSON.parse(fs.readFileSync(PRODUCTS_FILE, 'utf8'));
    res.json(products);
  } catch (e) {
    res.status(500).json({ error: 'Ошибка чтения товаров' });
  }
});

// Админ: проверить пароль
app.post('/api/admin/login', (req, res) => {
  const { password } = req.body;
  if (password === ADMIN_PASSWORD) {
    res.json({ success: true });
  } else {
    res.status(401).json({ success: false, error: 'Неверный пароль' });
  }
});

// Админ: сохранить товары
app.post('/api/admin/products', (req, res) => {
  const { password, products } = req.body;
  if (password !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Нет доступа' });
  }
  try {
    fs.writeFileSync(PRODUCTS_FILE, JSON.stringify(products, null, 2));
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: 'Ошибка сохранения' });
  }
});

// Оформить заказ → отправить админу в личку
app.post('/api/order', async (req, res) => {
  const order = req.body;

  const itemsText = order.items.map(i => 
    `• ${i.name} × ${i.quantity} = ${i.price * i.quantity} ₽`
  ).join('\n');

  const deliveryText = order.deliveryText || (
    order.deliveryType === 'pickup1' ? '📍 Самовывоз: 18/70 Зябь' :
    order.deliveryType === 'pickup2' ? '📍 Самовывоз: 32/01' :
    `🚚 Доставка по городу (+250 ₽)\nАдрес: ${order.address || 'не указан'}`
  );

  const message = `
🛒 <b>Новый заказ</b>

👤 Покупатель: @${order.username || 'без username'}
📱 Телефон: ${order.phone}
${order.name ? `Имя: ${order.name}` : ''}

${itemsText}

💰 Итого: <b>${order.total} ₽</b>
${deliveryText}

🕐 ${new Date().toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' })}
  `.trim();

  try {
    const tgRes = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: ADMIN_CHAT_ID,
        text: message,
        parse_mode: 'HTML'
      })
    });

    const tgData = await tgRes.json();
    if (tgData.ok) {
      res.json({ success: true });
    } else {
      console.error('Telegram error:', tgData);
      res.status(500).json({ error: 'Не удалось отправить заказ в Telegram' });
    }
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

app.listen(PORT, () => {
  console.log(`Сервер запущен: http://localhost:${PORT}`);
  console.log(`Мини-приложение: http://localhost:${PORT}`);
});
