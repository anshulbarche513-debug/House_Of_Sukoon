# House of Sukoon — Production Storefront

Static premium fragrance storefront backed by Supabase, with:

- Supabase-backed products, prices, stock and images.
- Guest checkout.
- Razorpay Standard Checkout.
- Server-side Razorpay order creation.
- Server-side HMAC payment verification.
- Razorpay captured/failed webhooks.
- Atomic paid-order stock deduction.
- Resend customer + owner order emails.
- Guest order tracking.
- Admin product and order management.
- Admin email resend.
- The Ritual guide.

## Main customer pages

- `index.html`
- `collection.html`
- `product.html`
- `philosophy.html`
- `ritual.html`
- `about.html`
- `contact.html`
- `shipping.html`
- `checkout.html`
- `order-confirmation.html`
- `track-order.html`

## Admin

- `admin/login.html`
- `admin/dashboard.html`

## Supabase Edge Functions

- `create-razorpay-order`
- `verify-razorpay-payment`
- `razorpay-webhook`
- `track-order`
- `resend-order-emails`

## Before deployment

1. Run `supabase-fix.sql` in the remote Supabase SQL Editor.
2. Configure Supabase secrets.
3. Deploy all Edge Functions.
4. Configure Razorpay Live webhook.
5. Verify Resend sending domain and sender.
6. Set `PUBLIC_SITE_URL` to the real HTTPS website.
7. Run a successful and failed payment test.

See `RAZORPAY-EMAIL-SETUP.md` and `DEPLOYMENT.md` for the exact commands.
