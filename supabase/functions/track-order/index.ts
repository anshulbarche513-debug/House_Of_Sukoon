import { createClient } from "npm:@supabase/supabase-js@2";
const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  try {
    const body = await req.json();
    const orderNumber = String(body?.order_number || "").trim().toUpperCase();
    const email = String(body?.email || "").trim().toLowerCase();
    if (!orderNumber || !email) return json({ error: "Order ID and email are required." }, 400);
    const { data: order, error } = await supabase.from("orders").select("id,order_number,customer_email,customer_first_name,customer_last_name,total,payment_status,order_status,payment_failure_code,payment_failure_description,created_at,updated_at,shipping_city,shipping_state,shipping_country").eq("order_number", orderNumber).ilike("customer_email", email).maybeSingle();
    if (error || !order) return json({ error: "We couldn't find an order with that ID and email." }, 404);
    const { data: items } = await supabase.from("order_items").select("product_name,quantity,unit_price,total_price").eq("order_id", order.id);
    return json({ success: true, order: { ...order, items: items || [] } });
  } catch (error) { return json({ error: error instanceof Error ? error.message : "Unable to track order." }, 500); }
});
