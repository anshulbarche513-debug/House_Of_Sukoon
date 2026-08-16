const money = (n) => "₹" + Number(n || 0).toLocaleString("en-IN");
const STORAGE_BUCKET = "product-images";
let products = [];
let orders = [];
let previewObjectUrl = null;
const $ = (id) => document.getElementById(id);

async function requireAdmin() {
  const { data: { session } } = await sukoonSupabase.auth.getSession();
  if (!session) {
    location.replace("login.html");
    return null;
  }
  const { data, error } = await sukoonSupabase
    .from("admin_users")
    .select("id,email")
    .eq("id", session.user.id)
    .maybeSingle();
  if (error || !data) {
    await sukoonSupabase.auth.signOut();
    location.replace("login.html");
    return null;
  }
  return session;
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>'"]/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[c],
  );
}

function escapeJs(value) {
  return String(value ?? "").replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

async function load() {
  const { data, error } = await sukoonSupabase
    .from("products")
    .select("*")
    .order("created_at", { ascending: true });
  if (error) throw error;
  products = data || [];
  renderProducts();
}

function renderProducts() {
  const featured = products.filter((p) => p.featured).length;
  $("count").textContent = products.length;
  $("featured").textContent = featured;
  $("stock").textContent = products.reduce((a, p) => a + Number(p.stock || 0), 0);
  $("value").textContent = money(products.reduce((a, p) => a + Number(p.sale_price || 0), 0));

  $("table").innerHTML = `<table class="table"><thead><tr><th>Product</th><th>MRP</th><th>Sale</th><th>Stock</th><th>Category</th><th>Status</th><th>Action</th></tr></thead><tbody>${products.map((p) => `
    <tr><td><div style="display:flex;gap:12px;align-items:center"><img class="thumb" src="${escapeHtml(p.image_url || "")}" alt=""><strong>${escapeHtml(p.name)}</strong></div></td>
    <td><del>${money(p.mrp)}</del></td><td><b>${money(p.sale_price)}</b></td><td>${p.stock ?? 0}</td><td>${escapeHtml(p.category || "")}</td>
    <td>${p.is_active === false ? "Hidden" : "Active"}</td><td><div class="actions"><button class="btn" onclick="editProduct('${escapeJs(p.id)}')">Edit</button><button class="btn" onclick="deleteProduct('${escapeJs(p.id)}')">Delete</button></div></td></tr>`).join("")}</tbody></table>`;
}

function setImagePreview(url) {
  const preview = $("imagePreview");
  if (!preview) return;
  preview.src = url || "";
  preview.style.display = url ? "block" : "none";
}

function fill(p) {
  const values = {
    id: p.id || "", name: p.name || "", subtitle: p.tagline || "", description: p.description || "",
    price: p.sale_price ?? 0, mrp: p.mrp ?? 0, stock: p.stock ?? 0, category: p.category || "", family: p.energy || "",
    top_notes: p.top_notes || "", heart_notes: p.heart_notes || "", base_notes: p.base_notes || "", longevity: p.longevity || "",
    occasion: p.occasion || "", image_url: p.image_url || "",
  };
  Object.entries(values).forEach(([k, v]) => { if ($(k)) $(k).value = v; });
  if ($("featuredInput")) $("featuredInput").checked = Boolean(p.featured);
  if ($("isActiveInput")) $("isActiveInput").checked = p.id ? p.is_active !== false : true;
  if ($("imageFile")) $("imageFile").value = "";
  if ($("imageUploadStatus")) $("imageUploadStatus").textContent = p.image_url ? "Current image loaded. Choose a file to replace it." : "Choose an image to upload.";
  setImagePreview(p.image_url || "");
}

function editProduct(id) {
  fill(products.find((x) => x.id === id) || {});
  $("editorTitle").textContent = "Edit product";
  $("editor").classList.add("open");
}
function newProduct() {
  fill({});
  $("editorTitle").textContent = "Add product";
  $("editor").classList.add("open");
}
function closeEditor() {
  $("editor").classList.remove("open");
  if (previewObjectUrl) {
    URL.revokeObjectURL(previewObjectUrl);
    previewObjectUrl = null;
  }
}
function slugify(value) {
  return String(value || "").toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}
function fileExtension(file) {
  const nameExt = file.name.includes(".") ? file.name.split(".").pop().toLowerCase() : "";
  if (["jpg", "jpeg", "png", "webp", "avif"].includes(nameExt)) return nameExt;
  if (file.type === "image/png") return "png";
  if (file.type === "image/webp") return "webp";
  if (file.type === "image/avif") return "avif";
  return "jpg";
}

async function uploadProductImage(file, productId) {
  if (!file) return $("image_url").value.trim() || null;
  const allowed = ["image/jpeg", "image/png", "image/webp", "image/avif"];
  if (!allowed.includes(file.type)) throw new Error("Please choose a JPG, PNG, WEBP or AVIF image.");
  if (file.size > 8 * 1024 * 1024) throw new Error("Image must be smaller than 8 MB.");
  const path = `products/${productId}/${crypto.randomUUID()}.${fileExtension(file)}`;
  $("imageUploadStatus").textContent = "Uploading image…";
  const { error: uploadError } = await sukoonSupabase.storage.from(STORAGE_BUCKET).upload(path, file, {
    cacheControl: "31536000", upsert: false, contentType: file.type,
  });
  if (uploadError) throw uploadError;
  const { data } = sukoonSupabase.storage.from(STORAGE_BUCKET).getPublicUrl(path);
  if (!data?.publicUrl) throw new Error("Image uploaded, but Supabase did not return a public URL.");
  return { publicUrl: data.publicUrl, path };
}

async function deleteProduct(id) {
  if (!confirm("Delete this product?")) return;
  const { error } = await sukoonSupabase.from("products").delete().eq("id", id);
  if (error) return alert(error.message);
  await load();
}

if ($("imageFile")) {
  $("imageFile").addEventListener("change", (e) => {
    const file = e.target.files?.[0];
    if (!file || !file.type.startsWith("image/")) return;
    if (previewObjectUrl) URL.revokeObjectURL(previewObjectUrl);
    previewObjectUrl = URL.createObjectURL(file);
    setImagePreview(previewObjectUrl);
    $("imageUploadStatus").textContent = `${file.name} selected. Save product to upload it.`;
  });
}

$("productForm").onsubmit = async (e) => {
  e.preventDefault();
  const id = $("id").value.trim();
  const name = $("name").value.trim();
  const mrp = Number($("mrp").value);
  const salePrice = Number($("price").value);
  const stock = Number($("stock").value);
  if (!name) return alert("Product name is required.");
  if (!Number.isFinite(mrp) || mrp < 0) return alert("MRP must be a valid non-negative number.");
  if (!Number.isFinite(salePrice) || salePrice < 0) return alert("Selling price must be a valid non-negative number.");
  if (!Number.isFinite(stock) || stock < 0) return alert("Stock must be a valid non-negative number.");
  if (salePrice > mrp) return alert("Selling price cannot be greater than MRP.");

  try {
    const existing = products.find((p) => p.id === id);
    const productId = id || crypto.randomUUID();
    const imageFile = $("imageFile")?.files?.[0] || null;
    let imageUrl = $("image_url").value.trim() || null;
    if (imageFile) imageUrl = (await uploadProductImage(imageFile, productId)).publicUrl;

    const payload = {
      id: productId, name, slug: existing?.slug || slugify(name) || productId, tagline: $("subtitle").value.trim(),
      description: $("description").value.trim(), sale_price: salePrice, mrp, stock, category: $("category").value.trim(),
      energy: $("family").value.trim(), top_notes: $("top_notes").value.trim(), heart_notes: $("heart_notes").value.trim(),
      base_notes: $("base_notes").value.trim(), longevity: $("longevity").value.trim(), occasion: $("occasion").value.trim(),
      image_url: imageUrl, featured: $("featuredInput")?.checked ?? false, is_active: $("isActiveInput")?.checked ?? true,
    };
    $("imageUploadStatus").textContent = "Saving product…";
    const result = id
      ? await sukoonSupabase.from("products").update(payload).eq("id", id).select().single()
      : await sukoonSupabase.from("products").insert(payload).select().single();
    if (result.error) throw result.error;
    if (!result.data) throw new Error("Product was not updated.");
    closeEditor();
    await load();
  } catch (error) {
    console.error(error);
    alert(error.message || "Unable to save product.");
    if ($("imageUploadStatus")) $("imageUploadStatus").textContent = "Save failed. Please try again.";
  }
};

function orderStatusOptions(current, paymentStatus) {
  const allowed = paymentStatus === "paid"
    ? ["confirmed", "processing", "shipped", "delivered", "cancelled"]
    : ["pending", "payment_failed", "cancelled"];
  if (current && !allowed.includes(current)) allowed.unshift(current);
  return allowed.map((v) => `<option value="${v}" ${v === current ? "selected" : ""}>${v.replaceAll("_", " ")}</option>`).join("");
}

function filteredOrders() {
  const q = String($("orderSearch")?.value || "").trim().toLowerCase();
  const status = $("orderFilter")?.value || "all";
  return orders.filter((o) => {
    const matchesStatus = status === "all" || o.payment_status === status || o.order_status === status;
    const haystack = `${o.order_number} ${o.customer_email} ${o.customer_mobile} ${o.customer_first_name} ${o.customer_last_name} ${o.payment_id} ${o.razorpay_order_id}`.toLowerCase();
    return matchesStatus && (!q || haystack.includes(q));
  });
}

function renderOrders() {
  const wrap = $("ordersTable");
  if (!wrap) return;
  const list = filteredOrders();
  if (!orders.length) { wrap.innerHTML = '<p style="color:#777">No orders yet.</p>'; return; }
  if (!list.length) { wrap.innerHTML = '<p style="color:#777">No orders match the current filters.</p>'; return; }
  wrap.innerHTML = `<div style="overflow:auto"><table class="table"><thead><tr><th>Order</th><th>Customer</th><th>Total</th><th>Payment</th><th>Fulfilment</th><th>Date</th><th>Action</th></tr></thead><tbody>${list.map((o) => `
    <tr><td><strong>${escapeHtml(o.order_number)}</strong><br><small>${escapeHtml(o.payment_id || o.razorpay_order_id || "")}</small></td>
    <td>${escapeHtml(`${o.customer_first_name || ""} ${o.customer_last_name || ""}`.trim())}<br><small>${escapeHtml(o.customer_email || "")}<br>${escapeHtml(o.customer_mobile || "")}</small></td>
    <td><b>${money(o.total)}</b></td><td><span class="status-pill ${escapeHtml(o.payment_status || "pending")}">${escapeHtml(o.payment_status || "pending")}</span></td>
    <td><select onchange="updateOrderStatus('${escapeJs(o.id)}', this.value)" ${o.payment_status === "failed" ? "" : ""}>${orderStatusOptions(o.order_status, o.payment_status)}</select></td>
    <td>${new Date(o.created_at).toLocaleString("en-IN")}</td><td><button class="btn" onclick="viewOrder('${escapeJs(o.id)}')">View</button></td></tr>`).join("")}</tbody></table></div><div id="orderDetail" style="margin-top:18px"></div>`;
}

async function loadOrders() {
  const wrap = $("ordersTable");
  if (!wrap) return;
  wrap.innerHTML = '<p style="color:#777">Loading orders…</p>';
  const { data, error } = await sukoonSupabase
    .from("orders")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) { wrap.innerHTML = `<p class="error">Unable to load orders: ${escapeHtml(error.message)}</p>`; return; }
  orders = data || [];
  renderOrders();
  await loadCustomers();
}

async function updateOrderStatus(id, status) {
  const { error } = await sukoonSupabase.from("orders").update({ order_status: status, updated_at: new Date().toISOString() }).eq("id", id);
  if (error) return alert(`Unable to update order: ${error.message}`);
  const row = orders.find((o) => o.id === id);
  if (row) row.order_status = status;
  renderOrders();
}

async function viewOrder(id) {
  const detail = $("orderDetail");
  if (!detail) return;
  const [{ data: order, error: oe }, { data: items, error: ie }, { data: emails }] = await Promise.all([
    sukoonSupabase.from("orders").select("*").eq("id", id).single(),
    sukoonSupabase.from("order_items").select("product_name,quantity,unit_price,total_price").eq("order_id", id).order("created_at", { ascending: true }),
    sukoonSupabase.from("order_email_deliveries").select("recipient_type,status,attempts,last_attempt_at,sent_at,last_error").eq("order_id", id),
  ]);
  if (oe || ie) { detail.innerHTML = `<p class="error">Unable to load order details.</p>`; return; }
  const emailText = (emails || []).map((e) => `${escapeHtml(e.recipient_type)}: ${escapeHtml(e.status)}${e.last_error ? ` — ${escapeHtml(e.last_error)}` : ""}`).join("<br>") || "No email delivery record yet.";
  detail.innerHTML = `<div class="notice"><strong>${escapeHtml(order.order_number)}</strong><br>${escapeHtml(`${order.customer_first_name || ""} ${order.customer_last_name || ""}`.trim())} · ${escapeHtml(order.customer_email || "")} · ${escapeHtml(order.customer_mobile || "")}<br><br><strong>Shipping:</strong> ${escapeHtml(order.shipping_address_line1 || "")}, ${escapeHtml(order.shipping_city || "")}, ${escapeHtml(order.shipping_state || "")} ${escapeHtml(order.shipping_postal_code || "")}<br><strong>Payment:</strong> ${escapeHtml(order.payment_status || "")} · <strong>Razorpay payment:</strong> ${escapeHtml(order.payment_id || "—")} · <strong>Razorpay order:</strong> ${escapeHtml(order.razorpay_order_id || "—")}<br><strong>Total:</strong> ${money(order.total)}${order.payment_failure_description ? `<br><strong>Failure:</strong> ${escapeHtml(order.payment_failure_description)}` : ""}<br><br><strong>Email delivery:</strong><br>${emailText}</div><div style="margin-top:12px">${(items || []).map((i) => `<div class="summary-line"><span>${escapeHtml(i.product_name)} × ${i.quantity}</span><strong>${money(i.total_price)}</strong></div>`).join("")}</div><div class="actions" style="margin-top:15px"><button class="btn gold" onclick="resendOrderEmails('${escapeJs(order.id)}')">Resend confirmation email</button></div>`;
}

async function resendOrderEmails(id) {
  if (!confirm("Resend the customer and store-owner confirmation emails for this paid order?")) return;
  try {
    const { data, error } = await sukoonSupabase.functions.invoke("resend-order-emails", { body: { order_id: id } });
    if (error) throw error;
    if (data?.error) throw new Error(data.error);
    alert("Confirmation emails sent.");
    await loadOrders();
    await viewOrder(id);
  } catch (error) {
    alert(error.message || "Unable to resend confirmation emails.");
  }
}

async function loadCustomers() {
  const wrap = $("customersTable");
  if (!wrap) return;
  const map = new Map();
  orders.forEach((o) => {
    const email = String(o.customer_email || "").toLowerCase();
    if (!email) return;
    const current = map.get(email) || { email, name: `${o.customer_first_name || ""} ${o.customer_last_name || ""}`.trim(), mobile: o.customer_mobile || "", orders: 0, paid: 0, total: 0, last: o.created_at };
    current.orders += 1;
    if (o.payment_status === "paid") { current.paid += 1; current.total += Number(o.total || 0); }
    if (new Date(o.created_at) > new Date(current.last)) current.last = o.created_at;
    map.set(email, current);
  });
  const customers = [...map.values()].sort((a, b) => new Date(b.last) - new Date(a.last));
  wrap.innerHTML = customers.length ? `<div style="overflow:auto"><table class="table"><thead><tr><th>Customer</th><th>Mobile</th><th>Orders</th><th>Paid value</th><th>Last order</th></tr></thead><tbody>${customers.map((c) => `<tr><td><strong>${escapeHtml(c.name || "Guest")}</strong><br><small>${escapeHtml(c.email)}</small></td><td>${escapeHtml(c.mobile)}</td><td>${c.orders} (${c.paid} paid)</td><td>${money(c.total)}</td><td>${new Date(c.last).toLocaleString("en-IN")}</td></tr>`).join("")}</tbody></table></div>` : '<p style="color:#777">No customers yet.</p>';
}

async function logout() {
  await sukoonSupabase.auth.signOut();
  location.href = "login.html";
}

$("orderSearch")?.addEventListener("input", renderOrders);
$("orderFilter")?.addEventListener("change", renderOrders);

(async () => {
  const session = await requireAdmin();
  if (!session) return;
  try {
    await load();
    await loadOrders();
  } catch (e) {
    console.error(e);
    alert(e.message || "Unable to load admin dashboard.");
  }
})();
