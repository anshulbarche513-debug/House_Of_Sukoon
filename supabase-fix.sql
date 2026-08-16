-- House of Sukoon storefront access fix
-- Run this in Supabase SQL Editor.
-- This allows the public storefront to read active products.
-- Legacy NULL is_active values are treated as visible.

alter table public.products enable row level security;

drop policy if exists "Public can read active products" on public.products;

create policy "Public can read active products"
on public.products
for select
to anon, authenticated
using (coalesce(is_active, true) = true);

-- Check the product rows after running the policy:
select id, name, is_active, mrp, sale_price, image_url
from public.products
order by created_at asc;

-- ============================================================
-- House of Sukoon: production checkout / guest tracking / admin
-- ============================================================

alter table public.orders
  add column if not exists razorpay_order_id text,
  add column if not exists stock_deducted_at timestamptz,
  add column if not exists confirmation_email_sent_at timestamptz,
  add column if not exists admin_email_sent_at timestamptz,
  add column if not exists payment_failure_code text,
  add column if not exists payment_failure_description text;

create unique index if not exists orders_razorpay_order_id_idx
  on public.orders(razorpay_order_id)
  where razorpay_order_id is not null;

create index if not exists orders_order_number_idx
  on public.orders(order_number);

create index if not exists orders_payment_status_idx
  on public.orders(payment_status);

create index if not exists orders_customer_email_idx
  on public.orders(customer_email);

-- Atomically mark an order paid and decrement stock exactly once.
create or replace function public.mark_order_paid(
  p_order_id uuid,
  p_payment_id text,
  p_razorpay_order_id text
)
returns table(order_id uuid, newly_paid boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders%rowtype;
  v_item record;
  v_updated integer;
begin
  select * into v_order
  from public.orders
  where id = p_order_id
  for update;

  if not found then
    raise exception 'Order not found';
  end if;

  if v_order.payment_status = 'paid' then
    return query select v_order.id, false;
    return;
  end if;

  for v_item in
    select product_id, sum(quantity)::integer as quantity
    from public.order_items
    where order_id = v_order.id
    group by product_id
  loop
    update public.products
    set stock = stock - v_item.quantity,
        updated_at = now()
    where id = v_item.product_id
      and stock >= v_item.quantity;

    get diagnostics v_updated = row_count;
    if v_updated <> 1 then
      raise exception 'Insufficient stock for product %', v_item.product_id;
    end if;
  end loop;

  update public.orders
  set payment_status = 'paid',
      order_status = 'confirmed',
      payment_method = 'razorpay',
      payment_id = p_payment_id,
      payment_failure_code = null,
      payment_failure_description = null,
      razorpay_order_id = p_razorpay_order_id,
      stock_deducted_at = now(),
      updated_at = now()
  where id = v_order.id;

  return query select v_order.id, true;
end;
$$;

revoke all on function public.mark_order_paid(uuid, text, text) from public;
grant execute on function public.mark_order_paid(uuid, text, text) to service_role;

-- Admin order access. The existing admin_users table is used by admin login.
alter table public.orders enable row level security;
alter table public.order_items enable row level security;

drop policy if exists "Admins can read orders" on public.orders;
create policy "Admins can read orders"
on public.orders for select to authenticated
using (exists (select 1 from public.admin_users au where au.id = auth.uid()));

drop policy if exists "Admins can update orders" on public.orders;
create policy "Admins can update orders"
on public.orders for update to authenticated
using (exists (select 1 from public.admin_users au where au.id = auth.uid()))
with check (exists (select 1 from public.admin_users au where au.id = auth.uid()));

drop policy if exists "Admins can read order items" on public.order_items;
create policy "Admins can read order items"
on public.order_items for select to authenticated
using (exists (
  select 1 from public.admin_users au where au.id = auth.uid()
));


-- Idempotent email delivery ledger. This prevents duplicate customer/admin
-- confirmation emails when both the browser verification and Razorpay webhook
-- reach the backend at nearly the same time.
create table if not exists public.order_email_deliveries (
  order_id uuid not null references public.orders(id) on delete cascade,
  recipient_type text not null check (recipient_type in ('customer','admin','payment_failed_admin')),
  status text not null default 'sending' check (status in ('sending','sent','failed')),
  attempts integer not null default 1,
  last_attempt_at timestamptz not null default now(),
  sent_at timestamptz,
  last_error text,
  primary key (order_id, recipient_type)
);

alter table public.order_email_deliveries enable row level security;

alter table public.order_email_deliveries drop constraint if exists order_email_deliveries_recipient_type_check;
alter table public.order_email_deliveries add constraint order_email_deliveries_recipient_type_check check (recipient_type in ('customer','admin','payment_failed_admin'));


drop policy if exists "Admins can read order email deliveries" on public.order_email_deliveries;
create policy "Admins can read order email deliveries"
on public.order_email_deliveries for select to authenticated
using (exists (select 1 from public.admin_users au where au.id = auth.uid()));

create or replace function public.claim_order_email(
  p_order_id uuid,
  p_recipient_type text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.order_email_deliveries%rowtype;
begin
  select * into v_row
  from public.order_email_deliveries
  where order_id = p_order_id and recipient_type = p_recipient_type
  for update;

  if not found then
    insert into public.order_email_deliveries(order_id, recipient_type, status, attempts, last_attempt_at)
    values (p_order_id, p_recipient_type, 'sending', 1, now());
    return true;
  end if;

  if v_row.status = 'sent' then
    return false;
  end if;

  -- Allow a failed or stale sending attempt to be retried.
  if v_row.status = 'failed' or v_row.last_attempt_at < now() - interval '10 minutes' then
    update public.order_email_deliveries
    set status = 'sending', attempts = attempts + 1, last_attempt_at = now(), last_error = null
    where order_id = p_order_id and recipient_type = p_recipient_type;
    return true;
  end if;

  return false;
end;
$$;

create or replace function public.complete_order_email(
  p_order_id uuid,
  p_recipient_type text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.order_email_deliveries
  set status = 'sent', sent_at = now(), last_error = null
  where order_id = p_order_id and recipient_type = p_recipient_type;
end;
$$;

create or replace function public.fail_order_email(
  p_order_id uuid,
  p_recipient_type text,
  p_error text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.order_email_deliveries
  set status = 'failed', last_error = left(coalesce(p_error,''), 500), last_attempt_at = now()
  where order_id = p_order_id and recipient_type = p_recipient_type;
end;
$$;

revoke all on function public.claim_order_email(uuid, text) from public;
revoke all on function public.complete_order_email(uuid, text) from public;
revoke all on function public.fail_order_email(uuid, text, text) from public;
grant execute on function public.claim_order_email(uuid, text) to service_role;
grant execute on function public.complete_order_email(uuid, text) to service_role;
grant execute on function public.fail_order_email(uuid, text, text) to service_role;
