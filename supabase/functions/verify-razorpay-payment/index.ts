import { createClient } from "npm:@supabase/supabase-js@2";
import { markOrderPaid, sendOrderConfirmationEmails } from "../_shared/order.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const KEY_SECRET = Deno.env.get("RAZORPAY_KEY_SECRET")!;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

async function hmacHex(message: string, secret: string) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function safeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return result === 0;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  try {
    const body = await req.json();
    const { order_id, razorpay_order_id, razorpay_payment_id, razorpay_signature } = body || {};
    if (!order_id || !razorpay_order_id || !razorpay_payment_id || !razorpay_signature) return json({ error: "Missing payment verification fields." }, 400);

    const { data: order, error } = await supabase.from("orders").select("id,razorpay_order_id,order_number").eq("id", order_id).single();
    if (error || !order || order.razorpay_order_id !== razorpay_order_id) return json({ error: "Order mismatch." }, 400);

    if (!KEY_SECRET) return json({ error: "Razorpay verification is not configured on the server." }, 500);
    const expected = await hmacHex(`${order.razorpay_order_id}|${razorpay_payment_id}`, KEY_SECRET);
    if (!safeEqual(expected, razorpay_signature)) return json({ error: "Payment verification failed." }, 400);

    const result = await markOrderPaid(order_id, razorpay_payment_id, razorpay_order_id);
    EdgeRuntime.waitUntil(
      sendOrderConfirmationEmails(order_id).catch((emailError) =>
        console.error("Background confirmation email error:", emailError),
      ),
    );

    return json({ success: true, order_id, order_number: order.order_number });
  } catch (error) {
    console.error("verify-razorpay-payment error:", error);
    return json({ error: error instanceof Error ? error.message : "Unable to verify payment." }, 500);
  }
});
