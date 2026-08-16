import { createClient } from "npm:@supabase/supabase-js@2";
import { esc, sendEmail } from "./email.ts";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

export async function markOrderPaid(
  orderId: string,
  paymentId: string,
  razorpayOrderId: string,
) {
  const { data, error } = await supabase.rpc("mark_order_paid", {
    p_order_id: orderId,
    p_payment_id: paymentId,
    p_razorpay_order_id: razorpayOrderId,
  });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) throw new Error("Unable to finalize order.");
  return row as { order_id: string; newly_paid: boolean };
}

export async function markOrderFailed(
  razorpayOrderId: string,
  failureCode = "",
  failureDescription = "",
  paymentId = "",
) {
  const { error } = await supabase
    .from("orders")
    .update({
      payment_status: "failed",
      order_status: "payment_failed",
      payment_id: paymentId || null,
      payment_failure_code: failureCode || null,
      payment_failure_description: failureDescription || null,
      updated_at: new Date().toISOString(),
    })
    .eq("razorpay_order_id", razorpayOrderId)
    .neq("payment_status", "paid");
  if (error) throw error;
}

async function claimEmail(orderId: string, recipientType: "customer" | "admin" | "payment_failed_admin") {
  const { data, error } = await supabase.rpc("claim_order_email", {
    p_order_id: orderId,
    p_recipient_type: recipientType,
  });
  if (error) throw error;
  return data === true;
}

async function completeEmail(orderId: string, recipientType: "customer" | "admin" | "payment_failed_admin") {
  const { error } = await supabase.rpc("complete_order_email", {
    p_order_id: orderId,
    p_recipient_type: recipientType,
  });
  if (error) throw error;
}

async function failEmail(orderId: string, recipientType: "customer" | "admin" | "payment_failed_admin", message: string) {
  await supabase.rpc("fail_order_email", {
    p_order_id: orderId,
    p_recipient_type: recipientType,
    p_error: message.slice(0, 500),
  });
}

export async function sendPaymentFailedAdminEmail(orderId: string) {
  const { data: order, error } = await supabase
    .from("orders")
    .select("order_number,customer_email,customer_first_name,customer_last_name,customer_mobile,total,payment_failure_code,payment_failure_description")
    .eq("id", orderId)
    .single();
  if (error || !order) throw error || new Error("Order not found.");
  const adminEmails = String(Deno.env.get("ADMIN_ORDER_EMAIL") || "")
    .split(",").map((x) => x.trim()).filter(Boolean);
  if (!adminEmails.length) return false;
  const claimed = await claimEmail(orderId, "payment_failed_admin");
  if (!claimed) return false;
  try {
    await sendEmail({
      to: adminEmails,
      subject: `Payment failed — House of Sukoon ${order.order_number}`,
      html: `<div style="font-family:Arial,sans-serif;max-width:720px;margin:auto;color:#181613"><h1>Payment failed</h1><p><strong>Order ID:</strong> ${esc(order.order_number)}</p><p><strong>Customer:</strong> ${esc(`${order.customer_first_name || ""} ${order.customer_last_name || ""}`.trim())}</p><p><strong>Email:</strong> ${esc(order.customer_email)}</p><p><strong>Mobile:</strong> ${esc(order.customer_mobile)}</p><p><strong>Total:</strong> ₹${Number(order.total || 0).toLocaleString("en-IN")}</p><p><strong>Code:</strong> ${esc(order.payment_failure_code || "payment_failed")}</p><p><strong>Reason:</strong> ${esc(order.payment_failure_description || "Razorpay reported a failed payment.")}</p></div>`,
      idempotencyKey: `payment-failed/admin/${orderId}`,
    });
    await completeEmail(orderId, "payment_failed_admin");
    return true;
  } catch (error) {
    await failEmail(orderId, "payment_failed_admin", error instanceof Error ? error.message : String(error));
    throw error;
  }
}

export async function sendOrderConfirmationEmails(orderId: string, force = false) {
  const { data: order, error: oe } = await supabase
    .from("orders")
    .select("*")
    .eq("id", orderId)
    .single();
  if (oe || !order) throw oe || new Error("Order not found.");
  if (order.payment_status !== "paid") return { customer: false, admin: false };

  const { data: items, error: ie } = await supabase
    .from("order_items")
    .select("product_name,quantity,unit_price,total_price")
    .eq("order_id", orderId)
    .order("created_at", { ascending: true });
  if (ie) throw ie;

  const siteUrl = (Deno.env.get("PUBLIC_SITE_URL") || "").replace(/\/$/, "");
  const trackUrl = siteUrl
    ? `${siteUrl}/track-order.html?order=${encodeURIComponent(order.order_number)}`
    : "";
  const rows = (items || []).map((i) =>
    `<tr><td style="padding:10px 0;border-bottom:1px solid #eee">${esc(i.product_name)} × ${Number(i.quantity)}</td><td style="padding:10px 0;border-bottom:1px solid #eee;text-align:right">₹${Number(i.total_price || 0).toLocaleString("en-IN")}</td></tr>`,
  ).join("");
  const firstName = esc(order.customer_first_name || "there");
  const orderNumber = esc(order.order_number);
  const total = `₹${Number(order.total || 0).toLocaleString("en-IN")}`;
  const customerHtml = `<div style="font-family:Arial,sans-serif;max-width:620px;margin:auto;color:#181613"><h1 style="font-weight:400">House of Sukoon</h1><p>Dear ${firstName},</p><p>Your payment was successful and your order is confirmed.</p><p><strong>Order ID:</strong> ${orderNumber}</p><table style="width:100%;border-collapse:collapse">${rows}</table><p style="font-size:18px"><strong>Total: ${total}</strong></p>${trackUrl ? `<p><a href="${esc(trackUrl)}">Track your order</a></p>` : ""}<p>Keep this email to check your order status later as a guest.</p><p>With warmth,<br>House of Sukoon</p></div>`;
  const adminHtml = `<div style="font-family:Arial,sans-serif;max-width:720px;margin:auto;color:#181613"><h1>New House of Sukoon order</h1><p><strong>Order ID:</strong> ${orderNumber}</p><p><strong>Customer:</strong> ${esc(`${order.customer_first_name || ""} ${order.customer_last_name || ""}`.trim())}</p><p><strong>Email:</strong> ${esc(order.customer_email)}</p><p><strong>Mobile:</strong> ${esc(order.customer_mobile)}</p><p><strong>Total:</strong> ${total}</p><p><strong>Payment:</strong> Paid</p><table style="width:100%;border-collapse:collapse">${rows}</table><p><strong>Shipping:</strong> ${esc(order.shipping_address_line1 || "")}, ${esc(order.shipping_city || "")}, ${esc(order.shipping_state || "")} ${esc(order.shipping_postal_code || "")}</p></div>`;

  const customerEmail = String(order.customer_email || "").trim();
  const adminEmails = String(Deno.env.get("ADMIN_ORDER_EMAIL") || "")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
  const results = { customer: false, admin: false };
  const resendSuffix = force ? `/${Date.now()}` : "";
  const errors: string[] = [];

  if (customerEmail && (force || !order.confirmation_email_sent_at)) {
    const claimed = await claimEmail(orderId, "customer");
    if (claimed) {
      try {
        await sendEmail({
          to: customerEmail,
          subject: `House of Sukoon — Order ${order.order_number} confirmed`,
          html: customerHtml,
          idempotencyKey: `order-confirmation/customer/${orderId}${resendSuffix}`,
        });
        await completeEmail(orderId, "customer");
        await supabase.from("orders").update({ confirmation_email_sent_at: new Date().toISOString() }).eq("id", orderId);
        results.customer = true;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await failEmail(orderId, "customer", message);
        errors.push(`customer: ${message}`);
      }
    }
  }

  if (adminEmails.length && (force || !order.admin_email_sent_at)) {
    const claimed = await claimEmail(orderId, "admin");
    if (claimed) {
      try {
        await sendEmail({
          to: adminEmails,
          subject: `New House of Sukoon order — ${order.order_number}`,
          html: adminHtml,
          idempotencyKey: `order-confirmation/admin/${orderId}${resendSuffix}`,
        });
        await completeEmail(orderId, "admin");
        await supabase.from("orders").update({ admin_email_sent_at: new Date().toISOString() }).eq("id", orderId);
        results.admin = true;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await failEmail(orderId, "admin", message);
        errors.push(`admin: ${message}`);
      }
    }
  }

  return { ...results, errors };
}
