const tg = window.Telegram.WebApp;
tg.ready();
tg.expand();

let products = [];
let cart = {};
let adminPassword = null;
let currentCategory = 'all';
let searchQuery = '';

// ========== КАТАЛОГ ==========
async function loadProducts() {
  try {
    const res = await fetch('/api/products');
    products = await res.json();
    renderCatalog();
  } catch (e) {
    console.error(e);
    document.getElementById('catalog').innerHTML = '<p style="padding:20px">Не удалось загрузить товары</p>';
  }
}

function renderCatalog() {
  const catalog = document.getElementById('catalog');
  catalog.innerHTML = '';

  let filtered = products;

  // Фильтр по категории
  if (currentCategory !== 'all') {
    filtered = filtered.filter(p => p.category === currentCategory);
  }

  // Поиск
  if (searchQuery) {
    const q = searchQuery.toLowerCase();
    filtered = filtered.filter(p => 
      (p.name && p.name.toLowerCase().includes(q)) || 
      (p.description && p.description.toLowerCase().includes(q))
    );
  }

  if (filtered.length === 0) {
    catalog.innerHTML = '<p style="padding:20px;opacity:0.6;grid-column:1/-1">Ничего не найдено</p>';
    return;
  }

  filtered.forEach(p => {
    if (p.stock <= 0) return;

    const card = document.createElement('div');
    card.className = 'product-card';
    card.innerHTML = `
      ${p.photo ? `<img class="product-photo" src="${p.photo}" alt="${p.name}" onerror="this.style.display='none'">` : '<div class="product-photo"></div>'}
      <div class="product-info">
        <div class="product-name">${p.name}</div>
        <div class="product-desc">${p.description || ''}</div>
        <div class="product-bottom">
          <div class="product-price">${p.price} ₽</div>
          <button class="add-btn" onclick="addToCart(${p.id})">В корзину</button>
        </div>
      </div>
    `;
    catalog.appendChild(card);
  });
}

// Категории
document.querySelectorAll('.cat-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.cat-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    currentCategory = btn.dataset.cat;
    renderCatalog();
  });
});

// ========== КОРЗИНА ==========
function addToCart(id) {
  const product = products.find(p => p.id === id);
  if (!product || product.stock <= 0) return;

  if (!cart[id]) cart[id] = 0;
  if (cart[id] < product.stock) {
    cart[id]++;
    updateCartCount();
  } else {
    tg.showAlert('Больше нет в наличии');
  }
}

function updateCartCount() {
  const count = Object.values(cart).reduce((a, b) => a + b, 0);
  document.getElementById('cart-count').textContent = count;
}

function openCart() {
  renderCart();
  document.getElementById('cart-modal').classList.remove('hidden');
}

function closeCart() {
  document.getElementById('cart-modal').classList.add('hidden');
}

function renderCart() {
  const container = document.getElementById('cart-items');
  container.innerHTML = '';

  let total = 0;
  const ids = Object.keys(cart);

  if (ids.length === 0) {
    container.innerHTML = '<p style="opacity:0.6;padding:20px 0">Корзина пуста</p>';
    document.getElementById('cart-total').textContent = '0';
    return;
  }

  ids.forEach(id => {
    const product = products.find(p => p.id == id);
    if (!product) return;
    const qty = cart[id];
    const sum = product.price * qty;
    total += sum;

    const div = document.createElement('div');
    div.className = 'cart-item';
    div.innerHTML = `
      <div class="cart-item-info">
        <div>${product.name}</div>
        <div style="font-size:13px;opacity:0.7">${product.price} ₽ × ${qty}</div>
      </div>
      <div class="qty-controls">
        <button class="qty-btn" onclick="changeQty(${id}, -1)">−</button>
        <span>${qty}</span>
        <button class="qty-btn" onclick="changeQty(${id}, 1)">+</button>
      </div>
    `;
    container.appendChild(div);
  });

  const deliveryType = document.querySelector('input[name="delivery"]:checked').value;
  if (deliveryType === 'delivery') total += 250;

  document.getElementById('cart-total').textContent = total;
}

function changeQty(id, delta) {
  const product = products.find(p => p.id == id);
  if (!product) return;

  cart[id] = (cart[id] || 0) + delta;
  if (cart[id] <= 0) delete cart[id];
  if (cart[id] > product.stock) cart[id] = product.stock;

  updateCartCount();
  renderCart();
}

document.querySelectorAll('input[name="delivery"]').forEach(radio => {
  radio.addEventListener('change', () => {
    const isDelivery = document.querySelector('input[name="delivery"]:checked').value === 'delivery';
    document.getElementById('address-field').classList.toggle('hidden', !isDelivery);
    renderCart();
  });
});

// ========== ЗАКАЗ ==========
async function submitOrder() {
  const phone = document.getElementById('phone').value.trim();
  if (!phone) {
    tg.showAlert('Укажите телефон');
    return;
  }

  const ids = Object.keys(cart);
  if (ids.length === 0) {
    tg.showAlert('Корзина пуста');
    return;
  }

  const deliveryType = document.querySelector('input[name="delivery"]:checked').value;
  const address = document.getElementById('address').value.trim();
  const name = document.getElementById('name').value.trim();

  if (deliveryType === 'delivery' && !address) {
    tg.showAlert('Укажите адрес доставки');
    return;
  }

  const items = ids.map(id => {
    const p = products.find(pr => pr.id == id);
    return {
      id: p.id,
      name: p.name,
      price: p.price,
      quantity: cart[id]
    };
  });

  let total = items.reduce((sum, i) => sum + i.price * i.quantity, 0);
  if (deliveryType === 'delivery') total += 250;

  let deliveryText = '';
  if (deliveryType === 'pickup1') deliveryText = 'Самовывоз: 18/70 Зябь';
  else if (deliveryType === 'pickup2') deliveryText = 'Самовывоз: 32/01';
  else deliveryText = `Доставка (+250 ₽): ${address}`;

  const user = tg.initDataUnsafe?.user || {};

  const order = {
    items,
    total,
    deliveryType,
    deliveryText,
    address: deliveryType === 'delivery' ? address : null,
    name,
    phone,
    username: user.username || null,
    userId: user.id || null
  };

  try {
    const res = await fetch('/api/order', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(order)
    });

    const data = await res.json();
    if (data.success) {
      tg.showAlert('Заказ отправлен! Мы скоро свяжемся с вами.');
      cart = {};
      updateCartCount();
      closeCart();
    } else {
      tg.showAlert(data.error || 'Ошибка при отправке заказа');
    }
  } catch (e) {
    tg.showAlert('Не удалось отправить заказ. Попробуйте позже.');
  }
}

// ========== АДМИНКА ==========
function openAdmin() {
  document.getElementById('admin-modal').classList.remove('hidden');
  document.getElementById('admin-login').classList.remove('hidden');
  document.getElementById('admin-panel').classList.add('hidden');
}

function closeAdmin() {
  document.getElementById('admin-modal').classList.add('hidden');
  adminPassword = null;
}

async function loginAdmin() {
  const password = document.getElementById('admin-password').value;
  try {
    const res = await fetch('/api/admin/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password })
    });
    const data = await res.json();
    if (data.success) {
      adminPassword = password;
      document.getElementById('admin-login').classList.add('hidden');
      document.getElementById('admin-panel').classList.remove('hidden');
      renderAdminProducts();
    } else {
      tg.showAlert('Неверный пароль');
    }
  } catch (e) {
    tg.showAlert('Ошибка входа');
  }
}

function renderAdminProducts() {
  const container = document.getElementById('admin-products');
  container.innerHTML = '';

  products.forEach(p => {
    const div = document.createElement('div');
    div.className = 'admin-product';
    div.innerHTML = `
      <div>
        <div><b>${p.name}</b> — ${p.price} ₽</div>
        <div style="font-size:13px;opacity:0.7">${p.category || 'без категории'} · Наличие: ${p.stock} шт</div>
      </div>
      <div>
        <button onclick="editProduct(${p.id})">✏️</button>
        <button onclick="deleteProduct(${p.id})">🗑</button>
      </div>
    `;
    container.appendChild(div);
  });
}

function editProduct(id) {
  const p = products.find(pr => pr.id === id);
  if (!p) return;
  document.getElementById('edit-id').value = p.id;
  document.getElementById('p-name').value = p.name;
  document.getElementById('p-desc').value = p.description || '';
  document.getElementById('p-category').value = p.category || 'одноразки';
  document.getElementById('p-price').value = p.price;
  document.getElementById('p-stock').value = p.stock;
  document.getElementById('p-photo').value = p.photo || '';
  document.getElementById('photo-preview').innerHTML = p.photo ? `<img src="${p.photo}" style="max-width:100px;margin-top:8px;border-radius:8px">` : '';
}

// Загрузка фото с телефона
document.getElementById('p-photo-file').addEventListener('change', function(e) {
  const file = e.target.files[0];
  if (!file) return;
  
  if (file.size > 1.5 * 1024 * 1024) {
    tg.showAlert('Фото слишком большое (макс 1.5 МБ)');
    return;
  }

  const reader = new FileReader();
  reader.onload = function(ev) {
    const dataUrl = ev.target.result;
    document.getElementById('p-photo').value = dataUrl;
    document.getElementById('photo-preview').innerHTML = `<img src="${dataUrl}" style="max-width:100px;margin-top:8px;border-radius:8px">`;
  };
  reader.readAsDataURL(file);
});

async function saveProduct() {
  if (!adminPassword) return;

  const id = document.getElementById('edit-id').value;
  const name = document.getElementById('p-name').value.trim();
  const description = document.getElementById('p-desc').value.trim();
  const category = document.getElementById('p-category').value;
  const price = parseInt(document.getElementById('p-price').value) || 0;
  const stock = parseInt(document.getElementById('p-stock').value) || 0;
  const photo = document.getElementById('p-photo').value.trim();

  if (!name || price <= 0) {
    tg.showAlert('Заполните название и цену');
    return;
  }

  if (id) {
    const idx = products.findIndex(p => p.id == id);
    if (idx !== -1) {
      products[idx] = { ...products[idx], name, description, category, price, stock, photo };
    }
  } else {
    const newId = products.length ? Math.max(...products.map(p => p.id)) + 1 : 1;
    products.push({ id: newId, name, description, category, price, stock, photo });
  }

  try {
    const res = await fetch('/api/admin/products', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: adminPassword, products })
    });
    const data = await res.json();
    if (data.success) {
      document.getElementById('edit-id').value = '';
      document.getElementById('p-name').value = '';
      document.getElementById('p-desc').value = '';
      document.getElementById('p-price').value = '';
      document.getElementById('p-stock').value = '';
      document.getElementById('p-photo').value = '';
      document.getElementById('p-photo-file').value = '';
      document.getElementById('photo-preview').innerHTML = '';
      renderAdminProducts();
      renderCatalog();
      tg.showAlert('Товар сохранён');
    } else {
      tg.showAlert('Ошибка сохранения');
    }
  } catch (e) {
    tg.showAlert('Ошибка сети');
  }
}

async function deleteProduct(id) {
  if (!confirm('Удалить товар?')) return;
  products = products.filter(p => p.id !== id);

  try {
    const res = await fetch('/api/admin/products', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: adminPassword, products })
    });
    if ((await res.json()).success) {
      renderAdminProducts();
      renderCatalog();
    }
  } catch (e) {
    tg.showAlert('Ошибка удаления');
  }
}

// Поиск
document.getElementById('search-input').addEventListener('input', (e) => {
  searchQuery = e.target.value.trim();
  renderCatalog();
});

// ========== ИНИЦИАЛИЗАЦИЯ ==========
document.getElementById('cart-btn').addEventListener('click', openCart);
loadProducts();
