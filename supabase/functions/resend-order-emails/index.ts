import { createClient } from "npm:@supabase/supabase-js@2";
import { sendOrderConfirmationEmails } from "../_shared/order.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const adminClient = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const authHeader = req.headers.get("Authorization") || "";
    const token = authHeader.replace(/^Bearer\s+/i, "").trim();
    if (!token) return json({ error: "Authentication required." }, 401);

    const { data: userData, error: userError } = await adminClient.auth.getUser(token);
    if (userError || !userData.user) return json({ error: "Invalid admin session." }, 401);

    const { data: admin, error: adminError } = await adminClient
      .from("admin_users")
      .select("id")
      .eq("id", userData.user.id)
      .maybeSingle();
    if (adminError || !admin) return json({ error: "Admin access required." }, 403);

    const body = await req.json();
    const orderId = String(body?.order_id || "").trim();
    if (!orderId) return json({ error: "order_id is required." }, 400);

    const { data: order, error: orderError } = await adminClient
      .from("orders")
      .select("id,payment_status")
      .eq("id", orderId)
      .single();
    if (orderError || !order) return json({ error: "Order not found." }, 404);
    if (order.payment_status !== "paid") return json({ error: "Only paid orders can receive a confirmation email." }, 400);

    await adminClient
      .from("order_email_deliveries")
      .delete()
      .eq("order_id", orderId)
      .in("recipient_type", ["customer", "admin"]);
    await adminClient
      .from("orders")
      .update({ confirmation_email_sent_at: null, admin_email_sent_at: null })
      .eq("id", orderId);

    const result = await sendOrderConfirmationEmails(orderId, true);
    return json({ success: true, result });
  } catch (error) {
    console.error("resend-order-emails error:", error);
    return json({ error: error instanceof Error ? error.message : "Unable to resend order emails." }, 500);
  }
});
