# House of Sukoon — Deployment Notes

## Frontend

Deploy the project root to Netlify (or another static HTTPS host). Do not deploy the `supabase` service-role secrets to the browser.

## Supabase

The frontend only contains the publishable/anon key in `supabase-config.js`.

Run `supabase-fix.sql` in the remote SQL Editor, then deploy:

```bash
supabase functions deploy create-razorpay-order --use-api
supabase functions deploy verify-razorpay-payment --use-api
supabase functions deploy razorpay-webhook --use-api
supabase functions deploy track-order --use-api
supabase functions deploy resend-order-emails --use-api
```

## Secrets

```bash
supabase secrets set RAZORPAY_KEY_ID='...'
supabase secrets set RAZORPAY_KEY_SECRET='...'
supabase secrets set RAZORPAY_WEBHOOK_SECRET='...'
supabase secrets set RESEND_API_KEY='...'
supabase secrets set EMAIL_FROM='House of Sukoon <orders@yourdomain.com>'
supabase secrets set ADMIN_ORDER_EMAIL='owner@example.com'
supabase secrets set PUBLIC_SITE_URL='https://houseofsukoonofficial.netlify.app'
```

## Razorpay webhook

```text
https://YOUR_PROJECT_REF.supabase.co/functions/v1/razorpay-webhook
```

Events:

- payment.captured
- payment.failed
- order.paid

## Important production checks

1. Website must be HTTPS.
2. Razorpay Live Key ID must be used by the deployed backend/frontend response.
3. Razorpay Live Key Secret must exist only as a Supabase secret.
4. Razorpay Live webhook must use the Live webhook secret.
5. Resend `EMAIL_FROM` must use a verified domain.
6. `PUBLIC_SITE_URL` must exactly match the public site origin.
7. Test a small live payment before announcing the store.
