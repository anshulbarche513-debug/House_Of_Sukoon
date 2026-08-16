import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);
const RAZORPAY_KEY_ID = Deno.env.get("RAZORPAY_KEY_ID")!;
const RAZORPAY_KEY_SECRET = Deno.env.get("RAZORPAY_KEY_SECRET")!;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function splitName(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return { first: parts[0] || "", last: parts.slice(1).join(" ") || "" };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    if (!RAZORPAY_KEY_ID || !RAZORPAY_KEY_SECRET) {
      return json({ error: "Razorpay is not configured on the server." }, 500);
    }

    const body = await req.json();
    const items = Array.isArray(body?.items) ? body.items : [];
    const customer = body?.customer || {};
    if (!items.length) return json({ error: "Cart is empty." }, 400);

    const rawItems = items.map((item: any) => ({
      product_id: String(item?.product_id || "").trim(),
      quantity: Number(item?.quantity),
    }));

    if (rawItems.some((i: any) => !i.product_id || !Number.isInteger(i.quantity) || i.quantity <= 0 || i.quantity > 20)) {
      return json({ error: "Invalid cart item or quantity." }, 400);
    }

    const quantityByProduct = new Map<string, number>();
    for (const item of rawItems) {
      quantityByProduct.set(item.product_id, (quantityByProduct.get(item.product_id) || 0) + item.quantity);
    }
    const cleanItems = [...quantityByProduct.entries()].map(([product_id, quantity]) => ({ product_id, quantity }));
    if (cleanItems.some((i: any) => i.quantity > 20)) {
      return json({ error: "Maximum quantity per product is 20." }, 400);
    }

    const ids = cleanItems.map((i: any) => i.product_id);
    const { data: products, error: productsError } = await supabase
      .from("products")
      .select("id,name,sale_price,stock,is_active")
      .in("id", ids);
    if (productsError) return json({ error: "Unable to load products.", details: productsError.message }, 500);
    if (!products || products.length !== ids.length) return json({ error: "One or more products are unavailable." }, 400);

    let subtotalPaise = 0;
    const orderItems = [] as Array<any>;
    for (const item of cleanItems) {
      const product = products.find((p) => String(p.id) === item.product_id);
      if (!product || product.is_active === false) return json({ error: `${product?.name || "Product"} is unavailable.` }, 400);
      const price = Number(product.sale_price);
      const stock = Number(product.stock);
      if (!Number.isFinite(price) || price <= 0) return json({ error: `Invalid price for ${product.name}.` }, 500);
      if (!Number.isFinite(stock) || stock < item.quantity) return json({ error: `Only ${Math.max(0, stock)} unit${stock === 1 ? "" : "s"} of ${product.name} are available.` }, 400);
      const linePaise = Math.round(price * 100) * item.quantity;
      subtotalPaise += linePaise;
      orderItems.push({ product_id: String(product.id), product_name: product.name, quantity: item.quantity, unit_price: price, total_price: linePaise / 100 });
    }

    const customerName = String(customer.name || "").trim();
    const customerEmail = String(customer.email || "").trim().toLowerCase();
    const customerMobile = String(customer.phone || "").trim();
    const addressLine1 = String(customer.address_line1 || "").trim();
    const addressLine2 = String(customer.address_line2 || "").trim();
    const city = String(customer.city || "").trim();
    const state = String(customer.state || "").trim();
    const postalCode = String(customer.pincode || "").trim();
    const country = String(customer.country || "India").trim() || "India";
    if (!customerName || !customerEmail || !customerMobile || !addressLine1 || !city || !state || !postalCode) {
      return json({ error: "Please provide all required customer and address details." }, 400);
    }
    if (!/^\S+@\S+\.\S+$/.test(customerEmail)) return json({ error: "Please provide a valid email address." }, 400);

    const { first, last } = splitName(customerName);
    const orderNumber = `HS-${Date.now().toString(36).toUpperCase()}-${crypto.randomUUID().slice(0, 6).toUpperCase()}`;
    const sameBilling = body?.billing_same_as_shipping !== false;
    const billing = sameBilling ? {
      address1: addressLine1, address2: addressLine2, city, state, postalCode, country,
    } : {
      address1: String(customer.billing_address_line1 || "").trim(),
      address2: String(customer.billing_address_line2 || "").trim(),
      city: String(customer.billing_city || "").trim(),
      state: String(customer.billing_state || "").trim(),
      postalCode: String(customer.billing_postal_code || "").trim(),
      country: String(customer.billing_country || country).trim() || country,
    };
    if (!billing.address1 || !billing.city || !billing.state || !billing.postalCode) return json({ error: "Please provide the complete billing address." }, 400);

    const total = subtotalPaise / 100;
    const { data: order, error: orderError } = await supabase
      .from("orders")
      .insert({
        order_number: orderNumber,
        user_id: null,
        customer_email: customerEmail,
        customer_mobile: customerMobile,
        customer_first_name: first,
        customer_last_name: last,
        shipping_address_line1: addressLine1,
        shipping_address_line2: addressLine2 || null,
        shipping_city: city,
        shipping_state: state,
        shipping_postal_code: postalCode,
        shipping_country: country,
        billing_same_as_shipping: sameBilling,
        billing_address_line1: billing.address1,
        billing_address_line2: billing.address2 || null,
        billing_city: billing.city,
        billing_state: billing.state,
        billing_postal_code: billing.postalCode,
        billing_country: billing.country,
        subtotal: total,
        shipping_fee: 0,
        discount: 0,
        total,
        payment_status: "pending",
        order_status: "pending",
        payment_method: "razorpay",
        payment_id: null,
        notes: null,
      })
      .select("id,order_number")
      .single();
    if (orderError || !order) return json({ error: "Unable to create order.", details: orderError?.message }, 500);

    const { error: itemError } = await supabase.from("order_items").insert(orderItems.map((item) => ({
      order_id: order.id,
      product_id: item.product_id,
      product_name: item.product_name,
      quantity: item.quantity,
      unit_price: item.unit_price,
      total_price: item.total_price,
    })));
    if (itemError) {
      await supabase.from("orders").delete().eq("id", order.id);
      return json({ error: "Unable to save order items.", details: itemError.message, code: itemError.code }, 500);
    }

    const razorpayResponse = await fetch("https://api.razorpay.com/v1/orders", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Basic ${btoa(`${RAZORPAY_KEY_ID}:${RAZORPAY_KEY_SECRET}`)}`,
      },
      body: JSON.stringify({
  amount: subtotalPaise,
  currency: "INR",
  receipt: order.order_number.slice(0, 40),
  notes: {
    local_order_id: order.id,
    order_number: order.order_number,
  },
      }),
    });
    const razorpayData = await razorpayResponse.json();
    if (!razorpayResponse.ok) {
      await supabase.from("order_items").delete().eq("order_id", order.id);
      await supabase.from("orders").delete().eq("id", order.id);
      return json({ error: razorpayData?.error?.description || "Unable to create Razorpay order." }, 500);
    }

    const { error: updateError } = await supabase.from("orders").update({ razorpay_order_id: razorpayData.id }).eq("id", order.id);
    if (updateError) return json({ error: "Unable to save Razorpay order ID.", details: updateError.message }, 500);

    return json({
      success: true,
      order_id: order.id,
      order_number: order.order_number,
      razorpay_order_id: razorpayData.id,
      amount: razorpayData.amount,
      currency: razorpayData.currency,
      key_id: RAZORPAY_KEY_ID,
      customer: { name: customerName, email: customerEmail, phone: customerMobile },
    });
  } catch (error) {
    console.error(error);
    return json({ error: error instanceof Error ? error.message : "Unexpected server error." }, 500);
  }
});
