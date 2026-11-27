const tg = window.Telegram.WebApp;
tg.ready();
tg.expand();

let products = [];
let cart = {};
let adminPassword = null;
let currentCategory = 'all';
let currentSubcategory = null;
let searchQuery = '';
let currentProductId = null;

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

function renderSubcategories() {
  const container = document.getElementById('subcategories');
  container.innerHTML = '';
  if (currentCategory === 'all') return;

  const subs = [...new Set(
    products
      .filter(p => p.category === currentCategory && p.subcategory)
      .map(p => p.subcategory)
  )].sort();

  if (subs.length === 0) return;

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
  const catalog = document.getElementById('catalog');
  catalog.innerHTML = '';

  let filtered = products;
  if (currentCategory !== 'all') filtered = filtered.filter(p => p.category === currentCategory);
  if (currentSubcategory) filtered = filtered.filter(p => p.subcategory === currentSubcategory);
  if (searchQuery) {
    const q = searchQuery.toLowerCase();
    filtered = filtered.filter(p => (p.name && p.name.toLowerCase().includes(q)) || (p.description && p.description.toLowerCase().includes(q)));
  }

  if (filtered.length === 0) {
    catalog.innerHTML = '<p style="padding:20px;opacity:0.6;grid-column:1/-1">Ничего не найдено</p>';
    return;
  }

  filtered.forEach(p => {
    const totalStock = (p.stock1870 || 0) + (p.stock3201 || 0);
    if (totalStock <= 0) return;

    const card = document.createElement('div');
    card.className = 'product-card';
    card.onclick = () => openProduct(p.id);
    card.innerHTML = `
      ${p.photo ? '<img class="product-photo" src="'+p.photo+'" alt="'+p.name+'" onerror="this.style.display=\'none\'">' : '<div class="product-photo"></div>'}
      <div class="product-info">
        <div class="product-name">${p.name}</div>
        <div class="product-desc">${p.description || ''}</div>
        <div class="product-locations">
          <span class="loc ${(p.stock1870||0)>0 ? 'in-stock' : 'out'}">18/70: ${p.stock1870||0}</span>
          <span class="loc ${(p.stock3201||0)>0 ? 'in-stock' : 'out'}">32/01: ${p.stock3201||0}</span>
        </div>
        <div class="product-bottom">
          <div class="product-price">${p.price} ₽</div>
          <button class="add-btn" onclick="event.stopPropagation(); addToCart(${p.id})">В корзину</button>
        </div>
      </div>
    `;
    catalog.appendChild(card);
  });
}

document.querySelectorAll('.cat-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.cat-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    currentCategory = btn.dataset.cat;
    currentSubcategory = null;
    renderCatalog();
  });
});

document.getElementById('search-input').addEventListener('input', (e) => {
  searchQuery = e.target.value.trim();
  renderCatalog();
});

function openProduct(id) {
  const p = products.find(pr => pr.id === id);
  if (!p) return;
  currentProductId = id;
  document.getElementById('pd-name').textContent = p.name;
  document.getElementById('pd-desc').textContent = p.description || '';
  document.getElementById('pd-price').textContent = p.price + ' ₽';
  document.getElementById('pd-stock-1870').textContent = p.stock1870 || 0;
  document.getElementById('pd-stock-3201').textContent = p.stock3201 || 0;
  const photo = document.getElementById('pd-photo');
  if (p.photo) { photo.src = p.photo; photo.style.display = 'block'; }
  else photo.style.display = 'none';
  document.getElementById('pd-add-btn').onclick = () => { addToCart(id); closeProduct(); };
  document.getElementById('product-modal').classList.remove('hidden');
}

function closeProduct() {
  document.getElementById('product-modal').classList.add('hidden');
}

function addToCart(id) {
  const product = products.find(p => p.id === id);
  if (!product) return;
  const totalStock = (product.stock1870 || 0) + (product.stock3201 || 0);
  if (totalStock <= 0) return;
  if (!cart[id]) cart[id] = 0;
  if (cart[id] < totalStock) { cart[id]++; updateCartCount(); }
  else tg.showAlert('Больше нет в наличии');
}

function updateCartCount() {
  document.getElementById('cart-count').textContent = Object.values(cart).reduce((a,b)=>a+b,0);
}

function openCart() { renderCart(); document.getElementById('cart-modal').classList.remove('hidden'); }
function closeCart() { document.getElementById('cart-modal').classList.add('hidden'); }

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
    total += product.price * qty;
    const div = document.createElement('div');
    div.className = 'cart-item';
    div.innerHTML = '<div class="cart-item-info"><div>'+product.name+'</div><div style="font-size:13px;opacity:0.7">'+product.price+' ₽ × '+qty+'</div></div><div class="qty-controls"><button class="qty-btn" onclick="changeQty('+id+', -1)">−</button><span>'+qty+'</span><button class="qty-btn" onclick="changeQty('+id+', 1)">+</button></div>';
    container.appendChild(div);
  });
  if (document.querySelector('input[name="delivery"]:checked').value === 'delivery') total += 250;
  document.getElementById('cart-total').textContent = total;
}

function changeQty(id, delta) {
  const product = products.find(p => p.id == id);
  if (!product) return;
  const totalStock = (product.stock1870 || 0) + (product.stock3201 || 0);
  cart[id] = (cart[id] || 0) + delta;
  if (cart[id] <= 0) delete cart[id];
  if (cart[id] > totalStock) cart[id] = totalStock;
  updateCartCount();
  renderCart();
}

document.querySelectorAll('input[name="delivery"]').forEach(radio => {
  radio.addEventListener('change', () => {
    document.getElementById('address-field').classList.toggle('hidden', document.querySelector('input[name="delivery"]:checked').value !== 'delivery');
    renderCart();
  });
});

async function submitOrder() {
  const phone = document.getElementById('phone').value.trim();
  if (!phone) { tg.showAlert('Укажите телефон'); return; }
  const ids = Object.keys(cart);
  if (ids.length === 0) { tg.showAlert('Корзина пуста'); return; }
  const deliveryType = document.querySelector('input[name="delivery"]:checked').value;
  const address = document.getElementById('address').value.trim();
  const name = document.getElementById('name').value.trim();
  if (deliveryType === 'delivery' && !address) { tg.showAlert('Укажите адрес доставки'); return; }

  const items = ids.map(id => {
    const p = products.find(pr => pr.id == id);
    return { id: p.id, name: p.name, price: p.price, quantity: cart[id] };
  });
  let total = items.reduce((s,i) => s + i.price * i.quantity, 0);
  if (deliveryType === 'delivery') total += 250;

  let deliveryText = deliveryType === 'pickup1' ? 'Самовывоз: 18/70 Зябь' : deliveryType === 'pickup2' ? 'Самовывоз: 32/01' : 'Доставка (+250 ₽): ' + address;
  const user = tg.initDataUnsafe?.user || {};

  try {
    const res = await fetch('/api/order', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items, total, deliveryType, deliveryText, address: deliveryType==='delivery'?address:null, name, phone, username: user.username||null, userId: user.id||null })
    });
    if ((await res.json()).success) {
      tg.showAlert('Заказ отправлен!');
      cart = {}; updateCartCount(); closeCart();
    } else tg.showAlert('Ошибка отправки');
  } catch(e) { tg.showAlert('Ошибка сети'); }
}

function openAdmin() {
  document.getElementById('admin-modal').classList.remove('hidden');
  document.getElementById('admin-login').classList.remove('hidden');
  document.getElementById('admin-panel').classList.add('hidden');
}
function closeAdmin() { document.getElementById('admin-modal').classList.add('hidden'); adminPassword = null; }

async function loginAdmin() {
  const password = document.getElementById('admin-password').value;
  try {
    const res = await fetch('/api/admin/login', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({password}) });
    if ((await res.json()).success) {
      adminPassword = password;
      document.getElementById('admin-login').classList.add('hidden');
      document.getElementById('admin-panel').classList.remove('hidden');
      renderAdminProducts();
    } else tg.showAlert('Неверный пароль');
  } catch(e) { tg.showAlert('Ошибка'); }
}

function renderAdminProducts() {
  const container = document.getElementById('admin-products');
  container.innerHTML = '';
  products.forEach(p => {
    const div = document.createElement('div');
    div.className = 'admin-product';
    div.innerHTML = '<div><div><b>'+p.name+'</b> — '+p.price+' ₽</div><div style="font-size:13px;opacity:0.7">'+(p.category||'')+' · 18/70: '+(p.stock1870||0)+' · 32/01: '+(p.stock3201||0)+'</div></div><div><button onclick="editProduct('+p.id+')">✏️</button><button onclick="deleteProduct('+p.id+')">🗑</button></div>';
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
  document.getElementById('p-subcategory').value = p.subcategory || '';
  document.getElementById('p-price').value = p.price;
  document.getElementById('p-stock-1870').value = p.stock1870 || 0;
  document.getElementById('p-stock-3201').value = p.stock3201 || 0;
  document.getElementById('p-photo').value = p.photo || '';
  document.getElementById('photo-preview').innerHTML = p.photo ? '<img src="'+p.photo+'" style="max-width:100px;margin-top:8px;border-radius:8px">' : '';
}

document.getElementById('p-photo-file').addEventListener('change', function(e) {
  const file = e.target.files[0];
  if (!file) return;
  if (file.size > 1.5*1024*1024) { tg.showAlert('Фото слишком большое'); return; }
  const reader = new FileReader();
  reader.onload = ev => {
    document.getElementById('p-photo').value = ev.target.result;
    document.getElementById('photo-preview').innerHTML = '<img src="'+ev.target.result+'" style="max-width:100px;margin-top:8px;border-radius:8px">';
  };
  reader.readAsDataURL(file);
});

async function saveProduct() {
  if (!adminPassword) return;
  const id = document.getElementById('edit-id').value;
  const name = document.getElementById('p-name').value.trim();
  const description = document.getElementById('p-desc').value.trim();
  const category = document.getElementById('p-category').value;
  const subcategory = document.getElementById('p-subcategory').value.trim();
  const price = parseInt(document.getElementById('p-price').value) || 0;
  const stock1870 = parseInt(document.getElementById('p-stock-1870').value) || 0;
  const stock3201 = parseInt(document.getElementById('p-stock-3201').value) || 0;
  const photo = document.getElementById('p-photo').value.trim();
  if (!name || price <= 0) { tg.showAlert('Заполните название и цену'); return; }

  if (id) {
    const idx = products.findIndex(p => p.id == id);
    if (idx !== -1) products[idx] = {...products[idx], name, description, category, subcategory, price, stock1870, stock3201, photo};
  } else {
    const newId = products.length ? Math.max(...products.map(p=>p.id))+1 : 1;
    products.push({id: newId, name, description, category, subcategory, price, stock1870, stock3201, photo});
  }

  try {
    const res = await fetch('/api/admin/products', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({password: adminPassword, products}) });
    if ((await res.json()).success) {
      ['edit-id','p-name','p-desc','p-subcategory','p-price','p-stock-1870','p-stock-3201','p-photo','p-photo-file'].forEach(id => document.getElementById(id).value = '');
      document.getElementById('photo-preview').innerHTML = '';
      renderAdminProducts(); renderCatalog();
      tg.showAlert('Товар сохранён');
    }
  } catch(e) { tg.showAlert('Ошибка'); }
}

async function deleteProduct(id) {
  if (!confirm('Удалить?')) return;
  products = products.filter(p => p.id !== id);
  try {
    await fetch('/api/admin/products', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({password: adminPassword, products}) });
    renderAdminProducts(); renderCatalog();
  } catch(e) {}
}

document.getElementById('cart-btn').addEventListener('click', openCart);
loadProducts();
