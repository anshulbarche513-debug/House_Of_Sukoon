const $ = (s) => document.querySelector(s);
const $$ = (s) => document.querySelectorAll(s);
const money = (n) => "₹" + Number(n || 0).toLocaleString("en-IN");

// Supabase is the single source of truth for products.
// localStorage is intentionally used only for the cart.
let products = [];
let productsLoadPromise = null;
let productsLoadedAt = 0;
let cart = JSON.parse(localStorage.getItem("hos-cart") || "[]");

function escapeHtml(value) {
  return String(value ?? "").replace(
    /[&<>'"]/g,
    (c) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        "'": "&#39;",
        '"': "&quot;",
      })[c],
  );
}

function safeImageUrl(value) {
  if (!value) return "assets/shukra.jpg";
  try {
    const url = new URL(value, window.location.href);
    if (url.protocol === "https:" || url.protocol === "http:") {
      return url.href;
    }
  } catch (_) {}
  return "assets/shukra.jpg";
}

function mapSupabaseProduct(p) {
  return {
    id: p.id,
    slug: p.slug || "",
    name: p.name || "",
    tagline: p.tagline || "",
    description: p.description || "",
    price: Number(p.mrp || 0),
    sale_price: Number(p.sale_price || 0),
    image: safeImageUrl(p.image_url || p.image),
    featured: Boolean(p.featured),
    stock: Number(p.stock || 0),
    category: p.category || "",
    glyph: p.glyph || "",
    energy: p.energy || "",
    notes: {
      top: p.top_notes || "",
      heart: p.heart_notes || "",
      base: p.base_notes || "Sandalwood, Amber, White Musk",
    },
    concentration: p.concentration || "18–20% Extrait de Parfum",
    longevity: p.longevity || "",
    size: p.size || "50ml",
    family: p.family || "",
    occasion: p.occasion || "",
    ritual: p.ritual || "",
    is_active: Boolean(p.is_active),
  };
}

function loadProductsFromSupabase(force = false) {
  const freshForMs = 30000;
  if (!force && productsLoadPromise && Date.now() - productsLoadedAt < freshForMs) return productsLoadPromise;

  productsLoadPromise = (async () => {
    if (!window.sukoonSupabase) {
      console.error("Supabase client is not available.");
      products = [];
      renderProducts();
      productPage();
      renderCart();
      return products;
    }

    const { data, error } = await window.sukoonSupabase
      .from("products")
      .select("*")
      .order("created_at", { ascending: true });

    if (error) {
      console.error("Supabase product load failed:", error);
      products = [];
      renderProducts();
      productPage();
      renderCart();
      const el = $("#products");
      if (el) {
        el.innerHTML = `<div class="empty"><strong>Unable to load fragrances.</strong><br><span>Supabase error: ${escapeHtml(error.message || "Unknown error")}</span></div>`;
      }
      return products;
    }

    // Treat NULL/missing legacy is_active values as visible. Only an explicit
    // false hides a product. This keeps older rows visible until the admin
    // saves them with is_active=true.
    products = (data || [])
      .filter((p) => p.is_active !== false)
      .map(mapSupabaseProduct);
    productsLoadedAt = Date.now();
    renderProducts("#products", document.body.dataset.home ? 4 : null);
    productPage();
    renderCart();

    return products;
  })();

  return productsLoadPromise;
}

// Expose the live loader for pages such as checkout.html.
window.loadProductsFromSupabase = loadProductsFromSupabase;
window.refreshProductsFromSupabase = () => loadProductsFromSupabase(true);
window.getLiveProducts = () => products.slice();

document.addEventListener("visibilitychange", () => {
  if (!document.hidden) loadProductsFromSupabase(true).catch(() => {});
});

function saveCart() {
  localStorage.setItem("hos-cart", JSON.stringify(cart));
  updateBag();
}

function updateBag() {
  const n = cart.reduce((a, x) => a + Math.max(0, Number(x.qty) || 0), 0);
  $$(".bag-count").forEach((e) => (e.textContent = n));
}

function addToCart(id, qty = 1) {
  const product = products.find((p) => p.id === id);
  if (!product) {
    alert("This product is no longer available.");
    return;
  }

  qty = Math.max(1, Number(qty) || 1);
  const item = cart.find((x) => x.id === id);
  const currentQty = item ? Number(item.qty) || 0 : 0;

  if (Number.isFinite(product.stock) && product.stock >= 0 && currentQty + qty > product.stock) {
    alert(`Only ${product.stock} unit${product.stock === 1 ? "" : "s"} available.`);
    return;
  }

  if (item) item.qty = currentQty + qty;
  else cart.push({ id, qty });

  saveCart();
  openCart();
}

function removeFromCart(id) {
  cart = cart.filter((x) => x.id !== id);
  saveCart();
  renderCart();
}

function changeQty(id, d) {
  const item = cart.find((x) => x.id === id);
  const product = products.find((p) => p.id === id);
  if (!item || !product) return;

  const nextQty = (Number(item.qty) || 0) + Number(d || 0);
  if (nextQty < 1) {
    removeFromCart(id);
    return;
  }

  if (nextQty > Number(product.stock || 0)) {
    alert(`Only ${product.stock} unit${product.stock === 1 ? "" : "s"} available.`);
    return;
  }

  item.qty = nextQty;
  saveCart();
  renderCart();
}

function renderProducts(target = "#products", limit = null) {
  const el = $(target);
  if (!el) return;

  const list = limit
    ? products.filter((p) => p.featured).slice(0, limit)
    : products;

  if (!list.length) {
    el.innerHTML = `<div class="empty"><strong>No fragrances available.</strong><br><span>Please check back shortly.</span></div>`;
    return;
  }

  el.innerHTML = list
    .map((p) => {
      const id = encodeURIComponent(p.id);
      const name = escapeHtml(p.name);
      const tagline = escapeHtml(p.tagline);
      const energy = escapeHtml(p.energy);
      const image = escapeHtml(p.image);
      return `<article class="product-card"><a href="product.html?id=${id}"><div class="image"><img src="${image}" alt="${name}" loading="lazy"></div></a><div class="product-info"><span class="energy">${energy}</span><h3>${name}</h3><p>${tagline}</p><div class="price"><del>${money(p.price)}</del><strong>${money(p.sale_price)}</strong></div><div class="card-actions"><a href="product.html?id=${id}">View details</a><button onclick="addToCart(decodeURIComponent('${id}'))">Add to bag</button></div></div></article>`;
    })
    .join("");
}

function openCart() {
  renderCart();
  $("#drawer")?.classList.add("open");
}

function closeCart() {
  $("#drawer")?.classList.remove("open");
}

function renderCart() {
  const el = $("#cartItems");
  if (!el) return;

  // Remove invalid/non-numeric cart quantities and unavailable products from the displayed total.
  cart = cart
    .map((i) => ({ ...i, qty: Number(i.qty) || 0 }))
    .filter((i) => i.qty > 0);

  if (!cart.length) {
    el.innerHTML =
      '<div class="empty"><strong>Your bag is empty.</strong><br><span>Choose a fragrance and make it yours.</span></div>';
  } else {
    const rows = cart
      .map((i) => {
        const p = products.find((x) => x.id === i.id);
        if (!p) return "";
        const id = encodeURIComponent(p.id);
        return `<div class="cart-row"><img src="${escapeHtml(p.image)}" alt="${escapeHtml(p.name)}"><div><h3>${escapeHtml(p.name)}</h3><p>${money(p.sale_price)} · Qty ${i.qty}</p><div class="qty"><button onclick="changeQty(decodeURIComponent('${id}'),-1)">−</button><span>${i.qty}</span><button onclick="changeQty(decodeURIComponent('${id}'),1)">+</button></div></div><button class="icon-btn" onclick="removeFromCart(decodeURIComponent('${id}'))">Remove</button></div>`;
      })
      .filter(Boolean);

    el.innerHTML = rows.length
      ? rows.join("")
      : '<div class="empty"><strong>Your bag needs attention.</strong><br><span>One or more products are no longer available.</span></div>';
  }

  const total = cart.reduce((a, i) => {
    const p = products.find((x) => x.id === i.id);
    return a + (p ? p.sale_price * i.qty : 0);
  }, 0);

  if ($("#cartTotal")) $("#cartTotal").textContent = money(total);

  const btn = $("#cartCheckout");
  if (btn) {
    const hasValidItems = cart.some((i) => products.some((p) => p.id === i.id));
    btn.classList.toggle("disabled", !hasValidItems);
    btn.setAttribute("aria-disabled", String(!hasValidItems));
    btn.href = hasValidItems ? "checkout.html" : "#";
  }
}

function productPage() {
  const container = $("#productDetailPage");
  if (!container) return;

  const id = new URLSearchParams(location.search).get("id");
  const p = products.find((x) => x.id === id);

  if (!p) {
    container.innerHTML = `<div class="container empty-page"><h2>Fragrance not found</h2><p>This fragrance may no longer be available.</p><a class="gold-btn" href="collection.html">View collection ↗</a></div>`;
    return;
  }

  const encodedId = encodeURIComponent(p.id);
  const notes = Object.entries(p.notes)
    .map(([k, v]) => `<div><small>${escapeHtml(k)}</small><span>${escapeHtml(v)}</span></div>`)
    .join("");

  container.innerHTML = `<div class="product-page-image"><img src="${escapeHtml(p.image)}" alt="${escapeHtml(p.name)}"></div><div class="product-page-copy"><span class="kicker">${escapeHtml(p.energy)}</span><h1>${escapeHtml(p.name)}</h1><div class="tagline">${escapeHtml(p.tagline)}</div><p class="description">${escapeHtml(p.description)}</p><div class="notes">${notes}</div><p><b>${money(p.sale_price)}</b> &nbsp; <del>${money(p.price)}</del></p><p style="font-size:10px;color:#777">${escapeHtml(p.concentration)} · ${escapeHtml(p.longevity)} · ${escapeHtml(p.size)}</p><button class="gold-btn" onclick="addToCart(decodeURIComponent('${encodedId}'))">Add to bag ↗</button><p class="description"><b>The ritual.</b><br>${escapeHtml(p.ritual)}</p><a class="text-link" href="collection.html">Back to collection</a></div>`;
}

async function init() {
  updateBag();
  await loadProductsFromSupabase();

  const heroImg = document.querySelector(".hero-image img");
  const heroProduct = products.find(
    (p) => p.slug === "shukra-udgam" || p.name === "Shukra Udgam",
  );

  if (heroImg && heroProduct?.image) {
    heroImg.src = heroProduct.image;
  }
}

document.addEventListener("DOMContentLoaded", init);
