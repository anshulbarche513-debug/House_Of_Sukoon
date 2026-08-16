type EmailArgs = { to: string | string[]; subject: string; html: string; idempotencyKey?: string };

export async function sendEmail({ to, subject, html, idempotencyKey }: EmailArgs) {
  const apiKey = Deno.env.get("RESEND_API_KEY");
  const from = Deno.env.get("EMAIL_FROM");
  const recipients = Array.isArray(to) ? to.filter(Boolean) : [to].filter(Boolean);
  if (!apiKey || !from || !recipients.length) {
    throw new Error("Email service is not configured. Check RESEND_API_KEY, EMAIL_FROM and recipient settings.");
  }

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
    },
    body: JSON.stringify({ from, to: recipients, subject, html }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data?.message || data?.error || `Email delivery failed (${response.status}).`);
  }
  return data;
}

export function esc(value: unknown) {
  return String(value ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string),
  );
}
