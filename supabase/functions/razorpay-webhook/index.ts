import { markOrderFailed, markOrderPaid, sendOrderConfirmationEmails, sendPaymentFailedAdminEmail } from "../_shared/order.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);
const WEBHOOK_SECRET = Deno.env.get("RAZORPAY_WEBHOOK_SECRET")!;

async function hmacHex(message: string, secret: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function safeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return result === 0;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  try {
    const rawBody = await req.text();
    const signature = req.headers.get("x-razorpay-signature") || "";
    if (!WEBHOOK_SECRET || !signature) return json({ error: "Webhook not configured" }, 500);

    const expected = await hmacHex(rawBody, WEBHOOK_SECRET);
    if (!safeEqual(expected, signature)) return json({ error: "Invalid signature" }, 401);

    const payload = JSON.parse(rawBody);
    const event = String(payload?.event || "");
    const payment = payload?.payload?.payment?.entity;
    const razorpayOrderId = payment?.order_id || payload?.payload?.order?.entity?.id;
    if (!razorpayOrderId) return json({ received: true });

    const { data: order } = await supabase
      .from("orders")
      .select("id,order_number,payment_status")
      .eq("razorpay_order_id", razorpayOrderId)
      .maybeSingle();
    if (!order) return json({ received: true });

    if (event === "payment.failed") {
      await markOrderFailed(
        razorpayOrderId,
        payment?.error_code || "payment_failed",
        payment?.error_description || payment?.error_reason || "Razorpay reported a failed payment.",
        payment?.id || "",
      );
      EdgeRuntime.waitUntil(
        sendPaymentFailedAdminEmail(order.id).catch((error) =>
          console.error("Background failed-payment email error:", error),
        ),
      );
      return json({ received: true });
    }

    if (event === "payment.captured" || event === "order.paid") {
      const paymentId = payment?.id || payload?.payload?.order?.entity?.payments?.items?.[0]?.id;
      if (!paymentId) return json({ received: true });

      const result = await markOrderPaid(order.id, paymentId, razorpayOrderId);
      // Razorpay expects a quick 200 response. Email delivery runs as a background task.
      // Calling this even when the order was already marked paid also lets a later
      // webhook retry recover an email that previously failed.
      EdgeRuntime.waitUntil(
        sendOrderConfirmationEmails(order.id).catch((error) =>
          console.error("Background confirmation email error:", error),
        ),
      );
    }

    return json({ received: true });
  } catch (error) {
    console.error("razorpay-webhook error:", error);
    return json({ error: "Webhook processing failed" }, 500);
  }
});
