# House of Sukoon — Production Razorpay + Orders + Email + Admin

This build uses:

- Supabase products as the storefront source of truth.
- Supabase Edge Functions for trusted Razorpay order creation and payment verification.
- Razorpay Standard Checkout with the **handler** callback for successful payments.
- Razorpay webhooks as the server-side backup/source of truth.
- Resend for transactional order emails.
- Guest order tracking with order ID + checkout email.
- Admin order management, customer list, payment status, fulfilment status and email resend.

## 1. Run the database SQL first

Open Supabase → SQL Editor and run **all of `supabase-fix.sql`**.

It adds:

- Razorpay order/payment fields.
- Payment failure details.
- Idempotent email-delivery tracking.
- Functions used to safely claim/complete/retry email delivery.
- Admin RLS for orders and order items.

Do this before deploying the functions.

## 2. Create Razorpay credentials

In Razorpay Dashboard:

1. Switch to **Test Mode** first.
2. Generate a Test API Key.
3. Copy the Key ID (`rzp_test_...`) and Key Secret.
4. Do not put the Key Secret in any HTML/JS file.
5. After testing, switch to Live Mode and generate a separate Live Key ID/Secret.

Set them in Supabase:

```bash
supabase secrets set \
  RAZORPAY_KEY_ID='rzp_test_xxx' \
  RAZORPAY_KEY_SECRET='your_test_secret'
```

For production, replace those values with the Live credentials.

## 3. Create the Razorpay webhook

Webhook URL:

```text
https://YOUR_PROJECT_REF.supabase.co/functions/v1/razorpay-webhook
```

Create a strong random webhook secret and store the same value in Supabase:

```bash
supabase secrets set RAZORPAY_WEBHOOK_SECRET='your-long-random-webhook-secret'
```

Subscribe to at least:

- `payment.captured`
- `payment.failed`
- `order.paid`

For Live Mode, create/configure the webhook in the Live Razorpay dashboard, not only Test Mode.

## 4. Set up Resend

Create a Resend account, then:

1. Open **API Keys**.
2. Create a key with **Sending access** if possible.
3. Verify the domain you want to send from.
4. Use a sender such as `orders@yourdomain.com` only after the domain is verified.

Then set:

```bash
supabase secrets set \
  RESEND_API_KEY='re_xxx' \
  EMAIL_FROM='House of Sukoon <orders@yourdomain.com>' \
  ADMIN_ORDER_EMAIL='your-owner-email@example.com'
```

`ADMIN_ORDER_EMAIL` can contain multiple comma-separated addresses.

Important: registering a `to:` email address in Resend is **not** the same as configuring the sender. `EMAIL_FROM` must be a valid sender on a verified Resend domain.

## 5. Set the public website URL

This is **not** a Supabase secret that Resend creates for you. It is your own website URL.

For the current Netlify site, for example:

```bash
supabase secrets set PUBLIC_SITE_URL='https://houseofsukoonofficial.netlify.app'
```

If you later attach `https://houseofsukoon.com`, replace the secret with that URL.

## 6. Deploy all functions

From the project root:

```bash
supabase functions deploy create-razorpay-order
supabase functions deploy verify-razorpay-payment
supabase functions deploy razorpay-webhook
supabase functions deploy track-order
supabase functions deploy resend-order-emails
```

Docker is not required for API deployment. If necessary:

```bash
supabase functions deploy --use-api
```

## 7. Confirm secrets

Run:

```bash
supabase secrets list
```

You should see names for:

```text
RAZORPAY_KEY_ID
RAZORPAY_KEY_SECRET
RAZORPAY_WEBHOOK_SECRET
RESEND_API_KEY
EMAIL_FROM
ADMIN_ORDER_EMAIL
PUBLIC_SITE_URL
```

The CLI displays secret digests rather than the secret values. That is expected.

## 8. Razorpay capture setting

Use automatic capture in Razorpay Dashboard. The server also requests automatic capture when creating the Razorpay order.

A payment in `authorized` state is not the same as a captured payment. Fulfil the order only after capture/payment confirmation.

## 9. Checkout success flow

The corrected browser flow is:

1. Customer submits checkout form.
2. Server reads current product price/stock from Supabase.
3. Server creates the local order.
4. Server creates the Razorpay order.
5. Browser opens Razorpay Checkout with that server-created `order_id`.
6. Razorpay calls the Checkout `handler` on success.
7. Browser sends the returned payment fields to `verify-razorpay-payment`.
8. Server verifies the HMAC signature using the server-side order ID and Key Secret.
9. `mark_order_paid` atomically marks the order paid and decrements stock once.
10. Customer is sent to the order confirmation page.
11. Email sending runs in a background task.
12. Razorpay webhook independently confirms captured/failed events.

## 10. Failed payment flow

If Razorpay reports `payment.failed`:

- The checkout closes.
- The customer sees the failure message.
- A retry button reopens the same Razorpay order.
- Razorpay webhook records `payment_status=failed` and `order_status=payment_failed`.
- The failure code/description is visible to the admin.
- The store owner also receives a payment-failed email when `ADMIN_ORDER_EMAIL` is configured.

## 11. Admin

Admin dashboard now supports:

- Product pricing/image/stock/content updates.
- Product activation/deactivation.
- Orders list.
- Search orders/customers/payment IDs.
- Payment status.
- Fulfilment status.
- Full order details.
- Razorpay payment/order IDs.
- Payment failure reason.
- Email delivery status.
- Resend customer + owner confirmation email.
- Basic customer summary from guest orders.

Admin authentication still requires a Supabase Auth user whose ID exists in `admin_users`.

## 12. Guest tracking

Customer email contains the order ID and a tracking link.

The customer can also open:

```text
https://YOUR_PUBLIC_SITE/track-order.html
```

They enter:

- Order ID
- Checkout email

No customer account is required.

## 13. Go-live checklist

Before switching to Live Mode:

- [ ] Run `supabase-fix.sql`.
- [ ] Test Test Mode payment success.
- [ ] Test Test Mode payment failure.
- [ ] Confirm successful payment becomes `paid` in Supabase.
- [ ] Confirm stock decreases exactly once.
- [ ] Confirm the Razorpay payment is `captured`.
- [ ] Confirm webhook invocation is successful.
- [ ] Verify Resend domain.
- [ ] Verify `EMAIL_FROM` uses the verified domain.
- [ ] Send a test email from Resend.
- [ ] Set `ADMIN_ORDER_EMAIL`.
- [ ] Set the correct `PUBLIC_SITE_URL`.
- [ ] Deploy all five functions.
- [ ] Configure the Live Razorpay webhook URL.
- [ ] Generate Live Razorpay keys.
- [ ] Replace Test secrets with Live secrets.
- [ ] Make one small real Live transaction.
- [ ] Check Razorpay Live Payments.
- [ ] Check Supabase Orders.
- [ ] Check customer email.
- [ ] Check owner email.
- [ ] Check Admin → Orders.
- [ ] Test guest tracking.

Never put `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`, `RESEND_API_KEY`, or Supabase service-role/secret keys into frontend files.
