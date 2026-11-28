const tg = window.Telegram && window.Telegram.WebApp ? window.Telegram.WebApp : {
  ready(){}, expand(){}, showAlert(message){ alert(message); }
};
tg.ready();
tg.expand();

let products = [];
let cart = {};
let adminPassword = null;
let currentCategory = 'all';
let currentSubcategory = null;
let searchQuery = '';
let currentProductId = null;
let selectedWarehouse = localStorage.getItem('deffiWarehouse') || '';
let ordersCache = [];

const $ = id => document.getElementById(id);
const stockField = () => selectedWarehouse === '1870' ? 'stock1870' : 'stock3201';
const warehouseName = () => selectedWarehouse === '1870' ? '18/70 Зябь' : '32/01';
const safe = value => String(value == null ? '' : value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const alertUser = message => tg.showAlert ? tg.showAlert(message) : alert(message);

async function apiJson(url, options = {}) {
  const response = await fetch(url, options);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Ошибка запроса');
  return data;
}
function postJson(url, body) {
  return apiJson(url, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body) });
}

async function loadProducts() {
  try {
    products = await apiJson('/api/products');
    if (!Array.isArray(products)) products = [];
    if (!selectedWarehouse) showWarehouseChooser();
    else {
      $('warehouse-modal').classList.add('hidden');
      updateWarehouseLabel();
      renderCatalog();
    }
  } catch (e) {
    $('catalog').innerHTML = '<p class="empty-state">Не удалось загрузить товары. Обновите страницу.</p>';
  }
}
function showWarehouseChooser() {
  $('warehouse-modal').classList.remove('hidden');
}
function chooseWarehouse(value) {
  if (!['1870','3201'].includes(value)) return;
  if (selectedWarehouse && selectedWarehouse !== value && Object.keys(cart).length) {
    if (!confirm('При смене склада корзина очистится. Продолжить?')) return;
  }
  selectedWarehouse = value;
  localStorage.setItem('deffiWarehouse', value);
  cart = {};
  updateCartCount();
  $('warehouse-modal').classList.add('hidden');
  updateWarehouseLabel();
  renderCatalog();
}
function updateWarehouseLabel() {
  const label = selectedWarehouse === '1870' ? 'Склад 18/70' : 'Склад 32/01';
  $('warehouse-current').textContent = label;
  $('change-warehouse-btn').textContent = label;
  $('warehouse-current-cart').textContent = label;
  $('pickup-text').textContent = selectedWarehouse === '1870' ? 'Самовывоз — 18/70 Зябь' : 'Самовывоз — 32/01';
  $('pickup-radio').value = 'pickup';
}
function switchWarehouse() { showWarehouseChooser(); }

function renderSubcategories() {
  const container = $('subcategories');
  container.innerHTML = '';
  if (currentCategory === 'all') return;
  const subs = [...new Set(products.filter(p => p.category === currentCategory && p.subcategory).map(p => p.subcategory))].sort();
  if (!subs.length) return;
  const allBtn = document.createElement('button');
  allBtn.className = 'sub-btn' + (currentSubcategory === null ? ' active' : '');
  allBtn.textContent = 'Все';
  allBtn.onclick = () => { currentSubcategory = null; renderCatalog(); };
  container.appendChild(allBtn);
  subs.forEach(sub => {
    const btn = document.createElement('button');
    btn.className = 'sub-btn' + (currentSubcategory === sub ? ' active' : '');
    btn.textContent = sub;
    btn.onclick = () => { currentSubcategory = sub; renderCatalog(); };
    container.appendChild(btn);
  });
}
function renderCatalog() {
  renderSubcategories();
  const catalog = $('catalog');
  catalog.innerHTML = '';
  if (!selectedWarehouse) return;
  let filtered = products.filter(p => Number(p[stockField()] || 0) > 0);
  if (currentCategory !== 'all') filtered = filtered.filter(p => p.category === currentCategory);
  if (currentSubcategory) filtered = filtered.filter(p => p.subcategory === currentSubcategory);
  if (searchQuery) {
    const q = searchQuery.toLowerCase();
    filtered = filtered.filter(p => (p.name || '').toLowerCase().includes(q) || (p.description || '').toLowerCase().includes(q));
  }
  if (!filtered.length) {
    catalog.innerHTML = '<p class="empty-state">На выбранном складе пока нет таких товаров</p>';
    return;
  }
  filtered.forEach(p => {
    const card = document.createElement('article');
    card.className = 'product-card';
    const photo = p.photo ? `<img class="product-photo" src="${safe(p.photo)}" alt="${safe(p.name)}" onerror="this.style.display='none'">` : '<div class="product-photo no-photo">DEFFI</div>';
    card.innerHTML = `${photo}<div class="product-info"><div class="product-name">${safe(p.name)}</div><div class="product-desc">${safe(p.description || '')}</div><div class="product-bottom"><div class="product-price">${Number(p.price)} ₽</div><button class="add-btn" type="button">В корзину</button></div></div>`;
    card.addEventListener('click', () => openProduct(p.id));
    card.querySelector('.add-btn').addEventListener('click', e => { e.stopPropagation(); addToCart(p.id); });
    catalog.appendChild(card);
  });
}

document.querySelectorAll('.cat-btn').forEach(btn => btn.addEventListener('click', () => {
  document.querySelectorAll('.cat-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  currentCategory = btn.dataset.cat;
  currentSubcategory = null;
  renderCatalog();
}));
$('search-input').addEventListener('input', e => { searchQuery = e.target.value.trim(); renderCatalog(); });

function openProduct(id) {
  const p = products.find(x => String(x.id) === String(id));
  if (!p) return;
  currentProductId = id;
  $('pd-name').textContent = p.name;
  $('pd-desc').textContent = p.description || '';
  $('pd-price').textContent = p.price + ' ₽';
  $('pd-stock').textContent = Number(p[stockField()] || 0);
  const photo = $('pd-photo');
  if (p.photo) { photo.src = p.photo; photo.style.display = 'block'; }
  else photo.style.display = 'none';
  $('pd-add-btn').onclick = () => { addToCart(id); closeProduct(); };
  $('product-modal').classList.remove('hidden');
}
function closeProduct() { $('product-modal').classList.add('hidden'); }

function addToCart(id) {
  const p = products.find(x => String(x.id) === String(id));
  if (!p) return;
  const stock = Number(p[stockField()] || 0);
  if (stock <= 0) return alertUser('На выбранном складе товара нет');
  cart[id] = (cart[id] || 0) + 1;
  if (cart[id] > stock) { cart[id] = stock; return alertUser('Больше нет в наличии'); }
  updateCartCount();
}
function updateCartCount() { $('cart-count').textContent = Object.values(cart).reduce((a,b) => a+b, 0); }
function openCart() { renderCart(); $('cart-modal').classList.remove('hidden'); }
function closeCart() { $('cart-modal').classList.add('hidden'); }
function renderCart() {
  const container = $('cart-items');
  container.innerHTML = '';
  let subtotal = 0;
  const ids = Object.keys(cart);
  if (!ids.length) {
    container.innerHTML = '<p class="empty-state">Корзина пуста</p>';
    $('cart-total').textContent = '0';
    return;
  }
  ids.forEach(id => {
    const p = products.find(x => String(x.id) === String(id));
    if (!p) return;
    const qty = cart[id];
    subtotal += Number(p.price) * qty;
    const row = document.createElement('div');
    row.className = 'cart-item';
    row.innerHTML = `<div class="cart-item-info"><strong>${safe(p.name)}</strong><small>${Number(p.price)} ₽ × ${qty}</small></div><div class="qty-controls"><button class="qty-btn" aria-label="Уменьшить">−</button><span>${qty}</span><button class="qty-btn" aria-label="Увеличить">+</button></div>`;
    const buttons = row.querySelectorAll('button');
    buttons[0].onclick = () => changeQty(id, -1);
    buttons[1].onclick = () => changeQty(id, 1);
    container.appendChild(row);
  });
  const delivery = document.querySelector('input[name="delivery"]:checked').value === 'delivery' ? 250 : 0;
  $('cart-total').textContent = subtotal + delivery;
}
function changeQty(id, delta) {
  const p = products.find(x => String(x.id) === String(id));
  if (!p) return;
  const stock = Number(p[stockField()] || 0);
  const next = (cart[id] || 0) + delta;
  if (next <= 0) delete cart[id];
  else if (next > stock) return alertUser('Больше нет в наличии');
  else cart[id] = next;
  updateCartCount();
  renderCart();
}
document.querySelectorAll('input[name="delivery"]').forEach(r => r.addEventListener('change', () => {
  $('address-field').classList.toggle('hidden', document.querySelector('input[name="delivery"]:checked').value !== 'delivery');
  renderCart();
}));

async function submitOrder() {
  const button = $('order-btn');
  if (button.disabled) return;
  const phone = $('phone').value.trim();
  const ids = Object.keys(cart);
  const deliveryType = document.querySelector('input[name="delivery"]:checked').value;
  const address = $('address').value.trim();
  if (!phone) return alertUser('Укажите телефон');
  if (!ids.length) return alertUser('Корзина пуста');
  if (deliveryType === 'delivery' && !address) return alertUser('Укажите адрес доставки');
  const items = ids.map(id => ({ id, quantity: cart[id] }));
  const user = tg.initDataUnsafe && tg.initDataUnsafe.user ? tg.initDataUnsafe.user : {};
  const requestId = 'req-' + Date.now() + '-' + Math.random().toString(36).slice(2, 10);
  button.disabled = true;
  button.textContent = 'Отправляем...';
  try {
    const data = await postJson('/api/order', {
      requestId, warehouse: selectedWarehouse, items,
      deliveryType, address, name: $('name').value.trim(), phone,
      username: user.username || '', userId: user.id || null
    });
    cart = {};
    updateCartCount();
    closeCart();
    await loadProducts();
    alertUser(data.notificationWarning ? `Заказ ${data.orderId} сохранён. Но уведомление администраторам не отправилось.` : `Заказ ${data.orderId} успешно оформлен!`);
  } catch (e) { alertUser(e.message); }
  finally { button.disabled = false; button.textContent = 'Оформить заказ'; }
}

function openAdmin() {
  $('admin-modal').classList.remove('hidden');
  $('admin-login').classList.remove('hidden');
  $('admin-panel').classList.add('hidden');
  $('admin-password').value = '';
}
function closeAdmin() { $('admin-modal').classList.add('hidden'); adminPassword = null; }
async function loginAdmin() {
  const password = $('admin-password').value;
  try {
    await postJson('/api/admin/login', { password });
    adminPassword = password;
    $('admin-login').classList.add('hidden');
    $('admin-panel').classList.remove('hidden');
    showAdminTab('products');
    renderAdminProducts();
  } catch (e) { alertUser(e.message); }
}
function showAdminTab(tab) {
  $('admin-products-view').classList.toggle('hidden', tab !== 'products');
  $('admin-orders-view').classList.toggle('hidden', tab !== 'orders');
  document.querySelectorAll('.admin-tab').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  if (tab === 'orders') loadAdminOrders();
}
function renderAdminProducts() {
  const container = $('admin-products');
  const search = ($('admin-product-search')?.value || '').toLowerCase().trim();
  const category = $('admin-product-category')?.value || 'all';
  container.innerHTML = '';

  const filtered = products.filter(p => {
    const searchable = `${p.name || ''} ${p.subcategory || ''} ${p.description || ''}`.toLowerCase();
    return searchable.includes(search) && (category === 'all' || p.category === category);
  });

  if (!filtered.length) {
    container.innerHTML = '<p class="empty-state">Товары не найдены</p>';
    return;
  }

  filtered.forEach(p => {
    const div = document.createElement('div');
    div.className = 'admin-product';
    div.innerHTML = `<div class="admin-product-info"><strong>${safe(p.name)}</strong><small>${safe(p.category)} · ${Number(p.price)} ₽ · 18/70: ${Number(p.stock1870||0)} · 32/01: ${Number(p.stock3201||0)}</small></div><div class="admin-actions"><button type="button" class="edit">Изменить</button><button type="button" class="delete danger">Удалить</button></div>`;
    div.querySelector('.edit').onclick = () => editProduct(p.id);
    div.querySelector('.delete').onclick = () => deleteProduct(p.id);
    container.appendChild(div);
  });
}
function editProduct(id) {
  const p = products.find(x => String(x.id) === String(id));
  if (!p) return;
  $('edit-id').value = p.id;
  $('p-name').value = p.name || '';
  $('p-desc').value = p.description || '';
  $('p-category').value = p.category || 'жижи';
  $('p-subcategory').value = p.subcategory || '';
  $('p-price').value = p.price || '';
  $('p-stock-1870').value = p.stock1870 || 0;
  $('p-stock-3201').value = p.stock3201 || 0;
  $('p-photo').value = p.photo || '';
  $('photo-preview').innerHTML = p.photo ? `<img src="${safe(p.photo)}" alt="Предпросмотр">` : '';
  $('product-form-title').textContent = 'Изменить товар';
  $('product-form').scrollIntoView({ behavior:'smooth', block:'start' });
}
function clearProductForm() {
  ['edit-id','p-name','p-desc','p-subcategory','p-price','p-stock-1870','p-stock-3201','p-photo','p-photo-file'].forEach(id => $(id).value = '');
  $('p-category').value = 'жижи';
  $('photo-preview').innerHTML = '';
  $('product-form-title').textContent = 'Добавить товар';
}
$('p-photo-file').addEventListener('change', async e => {
  const file = e.target.files[0];
  if (!file) return;
  if (file.size > 5 * 1024 * 1024) return alertUser('Фото должно быть меньше 5 МБ');
  const form = new FormData();
  form.append('file', file);
  form.append('upload_preset', 'deffi_products');
  try {
    alertUser('Загружаю фотографию...');
    const response = await fetch('https://api.cloudinary.com/v1_1/yovkf3nu/image/upload', { method:'POST', body:form });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error?.message || 'Ошибка загрузки');
    $('p-photo').value = data.secure_url;
    $('photo-preview').innerHTML = `<img src="${safe(data.secure_url)}" alt="Предпросмотр">`;
    alertUser('Фото загружено');
  } catch (err) { alertUser('Не удалось загрузить фото: ' + err.message); }
});
async function saveProduct() {
  if (!adminPassword) return;
  const product = {
    id: $('edit-id').value || undefined,
    name: $('p-name').value.trim(),
    description: $('p-desc').value.trim(),
    category: $('p-category').value,
    subcategory: $('p-subcategory').value.trim(),
    price: Number($('p-price').value),
    stock1870: Number($('p-stock-1870').value),
    stock3201: Number($('p-stock-3201').value),
    photo: $('p-photo').value.trim()
  };
  if (!product.name || !Number.isFinite(product.price) || product.price <= 0) return alertUser('Заполните название и корректную цену');
  if (![product.stock1870, product.stock3201].every(n => Number.isInteger(n) && n >= 0)) return alertUser('Остатки должны быть целыми числами от 0');
  try {
    await postJson('/api/admin/product', { password:adminPassword, product });
    await loadProducts();
    renderAdminProducts();
    clearProductForm();
    alertUser('Товар сохранён');
  } catch (e) { alertUser(e.message); }
}
async function deleteProduct(id) {
  if (!confirm('Удалить товар из каталога?')) return;
  try {
    await postJson('/api/admin/product/delete', { password:adminPassword, id });
    await loadProducts();
    renderAdminProducts();
    alertUser('Товар удалён');
  } catch (e) { alertUser(e.message); }
}
async function loadAdminOrders() {
  if (!adminPassword) return;
  const container = $('admin-orders');
  container.innerHTML = '<p class="empty-state">Загружаем заказы...</p>';
  try {
    const data = await postJson('/api/admin/orders', { password:adminPassword });
    ordersCache = data.orders || [];
    renderAdminOrders();
  } catch (e) { container.innerHTML = `<p class="empty-state">${safe(e.message)}</p>`; }
}
function renderAdminOrders() {
  const container = $('admin-orders');
  container.innerHTML = '';
  if (!ordersCache.length) { container.innerHTML = '<p class="empty-state">Заказов пока нет</p>'; return; }
  ordersCache.forEach(order => {
    const date = new Date(order.createdAt).toLocaleString('ru-RU');
    const items = (order.items || []).map(i => `<li>${safe(i.name)} × ${i.quantity} — ${i.price * i.quantity} ₽</li>`).join('');
    const div = document.createElement('article');
    div.className = 'order-card';
    const telegramContact = order.username ? `@${safe(order.username)}` : (order.userId ? `ID: ${safe(order.userId)}` : 'не указан');
    div.innerHTML = `<div class="order-head"><strong>Заказ ${safe(order.id)}</strong><span>${safe(order.status)}</span></div><small>${safe(date)} · склад ${order.warehouse === '1870' ? '18/70' : '32/01'}</small><p>${safe(order.name || 'Покупатель')} · ${safe(order.phone)}</p><p>Telegram: ${telegramContact}</p><ul>${items}</ul><p class="order-total">Итого: ${Number(order.total)} ₽</p><p class="order-delivery">${order.deliveryType === 'delivery' ? 'Доставка: ' + safe(order.address) : 'Самовывоз'}</p><label>Статус<select class="status-select">${['Новый','Принят','Готовится','Готов','Выдан','Отменён'].map(s => `<option ${s===order.status?'selected':''}>${s}</option>`).join('')}</select></label>`;
    div.querySelector('select').onchange = e => updateOrderStatus(order.id, e.target.value);
    container.appendChild(div);
  });
}
async function updateOrderStatus(orderId, status) {
  if (status === 'Отменён' && !confirm('Отменить заказ и вернуть товары на исходный склад?')) { loadAdminOrders(); return; }
  try {
    await postJson('/api/admin/order/status', { password:adminPassword, orderId, status });
    await loadProducts();
    await loadAdminOrders();
    alertUser('Статус заказа обновлён');
  } catch (e) { alertUser(e.message); loadAdminOrders(); }
}

$('cart-btn').addEventListener('click', openCart);
$('change-warehouse-btn').addEventListener('click', switchWarehouse);
$('admin-password').addEventListener('keydown', e => { if (e.key === 'Enter') loginAdmin(); });
$('new-product-btn').addEventListener('click', clearProductForm);
document.querySelectorAll('.admin-tab').forEach(b => b.addEventListener('click', () => showAdminTab(b.dataset.tab)));

loadProducts();

// Пять нажатий по логотипу открывают админку
let logoClicks = 0;
let logoTimer;
document.querySelector('.logo').addEventListener('click', () => {
  logoClicks++;
  clearTimeout(logoTimer);
  logoTimer = setTimeout(() => logoClicks = 0, 1500);
  if (logoClicks >= 5) { logoClicks = 0; openAdmin(); }
});
