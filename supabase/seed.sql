-- Local development data, loaded by `supabase start` and `supabase db reset`.
-- Never run against a cloud project: the passwords below are public.
--
-- Demo shop "Автосервіс Демо" with one account per role, all with the
-- password `password123`:
--   owner@example.com  super_admin
--   admin@example.com  admin
--   staff@example.com  staff

-- ---------------------------------------------------------------------------
-- Accounts. Inserted straight into Supabase Auth's tables, which is fine for a
-- local seed; real accounts are created through the Auth admin API.

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change
)
select
  '00000000-0000-0000-0000-000000000000', id, 'authenticated', 'authenticated', email,
  extensions.crypt('password123', extensions.gen_salt('bf')), now(),
  '{"provider": "email", "providers": ["email"]}', '{}', now(), now(),
  '', '', '', ''
from (values
  ('0190a5d0-0000-7000-8000-000000000101'::uuid, 'owner@example.com'),
  ('0190a5d0-0000-7000-8000-000000000102'::uuid, 'admin@example.com'),
  ('0190a5d0-0000-7000-8000-000000000103'::uuid, 'staff@example.com')
) as account (id, email);

insert into auth.identities (provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
select id::text, id, jsonb_build_object('sub', id::text, 'email', email, 'email_verified', true), 'email', now(), now(), now()
from auth.users
where id in (
  '0190a5d0-0000-7000-8000-000000000101',
  '0190a5d0-0000-7000-8000-000000000102',
  '0190a5d0-0000-7000-8000-000000000103'
);

-- ---------------------------------------------------------------------------
-- The shop and its people.

insert into public.tenants (id, name) values
  ('0190a5d0-0000-7000-8000-000000000001', 'Автосервіс Демо');

insert into public.profiles (id, display_name) values
  ('0190a5d0-0000-7000-8000-000000000101', 'Олена Власник'),
  ('0190a5d0-0000-7000-8000-000000000102', 'Андрій Адмін'),
  ('0190a5d0-0000-7000-8000-000000000103', 'Сергій Механік');

insert into public.memberships (tenant_id, user_id, role) values
  ('0190a5d0-0000-7000-8000-000000000001', '0190a5d0-0000-7000-8000-000000000101', 'super_admin'),
  ('0190a5d0-0000-7000-8000-000000000001', '0190a5d0-0000-7000-8000-000000000102', 'admin'),
  ('0190a5d0-0000-7000-8000-000000000001', '0190a5d0-0000-7000-8000-000000000103', 'staff');

-- ---------------------------------------------------------------------------
-- Catalog and stock.

insert into public.categories (id, tenant_id, name) values
  ('0190a5d0-0000-7000-8000-000000000201', '0190a5d0-0000-7000-8000-000000000001', 'Оливи та рідини'),
  ('0190a5d0-0000-7000-8000-000000000202', '0190a5d0-0000-7000-8000-000000000001', 'Фільтри'),
  ('0190a5d0-0000-7000-8000-000000000203', '0190a5d0-0000-7000-8000-000000000001', 'Гальмівна система');

insert into public.products (
  id, tenant_id, sku, name, category_id, unit, cost_price_minor, sale_price_minor, min_stock, location_note
) values
  ('0190a5d0-0000-7000-8000-000000000301', '0190a5d0-0000-7000-8000-000000000001', 'OIL-5W30-4', 'Олива моторна 5W-30, 4 л', '0190a5d0-0000-7000-8000-000000000201', 'pcs', 98000, 129000, 3, 'Стелаж 1'),
  ('0190a5d0-0000-7000-8000-000000000302', '0190a5d0-0000-7000-8000-000000000001', 'OIL-5W30-L', 'Олива моторна 5W-30, на розлив', '0190a5d0-0000-7000-8000-000000000201', 'l', 26000, 36000, 10, 'Бочка біля входу'),
  ('0190a5d0-0000-7000-8000-000000000303', '0190a5d0-0000-7000-8000-000000000001', 'AF-G40', 'Антифриз G12+, 1 л', '0190a5d0-0000-7000-8000-000000000201', 'pcs', 14000, 19500, 5, 'Стелаж 1'),
  ('0190a5d0-0000-7000-8000-000000000304', '0190a5d0-0000-7000-8000-000000000001', 'FLT-OIL-W712', 'Фільтр масляний W 712/95', '0190a5d0-0000-7000-8000-000000000202', 'pcs', 21000, 29000, 4, 'Стелаж 2'),
  ('0190a5d0-0000-7000-8000-000000000305', '0190a5d0-0000-7000-8000-000000000001', 'FLT-AIR-C30', 'Фільтр повітряний C 30 005', '0190a5d0-0000-7000-8000-000000000202', 'pcs', 32000, 44000, 2, 'Стелаж 2'),
  ('0190a5d0-0000-7000-8000-000000000306', '0190a5d0-0000-7000-8000-000000000001', 'BRK-PAD-F', 'Колодки гальмівні передні', '0190a5d0-0000-7000-8000-000000000203', 'set', 115000, 159000, 2, 'Стелаж 3'),
  ('0190a5d0-0000-7000-8000-000000000307', '0190a5d0-0000-7000-8000-000000000001', 'BRK-FLUID-DOT4', 'Гальмівна рідина DOT 4, 0,5 л', '0190a5d0-0000-7000-8000-000000000203', 'pcs', 9000, 13500, 6, 'Стелаж 3'),
  ('0190a5d0-0000-7000-8000-000000000308', '0190a5d0-0000-7000-8000-000000000001', null, 'Хомут металевий 16-25 мм', null, 'pcs', null, 2500, null, null);

insert into public.product_barcodes (id, tenant_id, product_id, barcode, symbology) values
  ('0190a5d0-0000-7000-8000-000000000401', '0190a5d0-0000-7000-8000-000000000001', '0190a5d0-0000-7000-8000-000000000301', '4820000000017', 'ean13'),
  ('0190a5d0-0000-7000-8000-000000000402', '0190a5d0-0000-7000-8000-000000000001', '0190a5d0-0000-7000-8000-000000000303', '4820000000024', 'ean13'),
  ('0190a5d0-0000-7000-8000-000000000403', '0190a5d0-0000-7000-8000-000000000001', '0190a5d0-0000-7000-8000-000000000304', '4011558000000', 'ean13'),
  -- The shop's own label next to the manufacturer's code.
  ('0190a5d0-0000-7000-8000-000000000404', '0190a5d0-0000-7000-8000-000000000001', '0190a5d0-0000-7000-8000-000000000304', 'SHOP-0004', 'code128'),
  ('0190a5d0-0000-7000-8000-000000000405', '0190a5d0-0000-7000-8000-000000000001', '0190a5d0-0000-7000-8000-000000000305', '4011558000017', 'ean13'),
  ('0190a5d0-0000-7000-8000-000000000406', '0190a5d0-0000-7000-8000-000000000001', '0190a5d0-0000-7000-8000-000000000306', '4006633000005', 'ean13'),
  ('0190a5d0-0000-7000-8000-000000000407', '0190a5d0-0000-7000-8000-000000000001', '0190a5d0-0000-7000-8000-000000000307', '4820000000031', 'ean13');

-- Initial counts, a delivery and a few sales. Brake pads end at 0 and the
-- clamps go negative, so low and negative stock both show up.
insert into public.stock_movements (
  id, tenant_id, product_id, type, quantity_delta, unit_cost_minor, unit_price_minor, note, occurred_at, created_by, device_id
)
select
  id, '0190a5d0-0000-7000-8000-000000000001', product_id, type, quantity_delta, unit_cost_minor, unit_price_minor, note,
  occurred_at, created_by, '0190a5d0-0000-7000-8000-000000000901'
from (values
  ('0190a5d0-0000-7000-8000-000000000501'::uuid, '0190a5d0-0000-7000-8000-000000000301'::uuid, 'initial', 6.000, 98000, 129000, null, now() - interval '30 days', '0190a5d0-0000-7000-8000-000000000102'::uuid),
  ('0190a5d0-0000-7000-8000-000000000502'::uuid, '0190a5d0-0000-7000-8000-000000000302'::uuid, 'initial', 60.000, 26000, 36000, null, now() - interval '30 days', '0190a5d0-0000-7000-8000-000000000102'::uuid),
  ('0190a5d0-0000-7000-8000-000000000503'::uuid, '0190a5d0-0000-7000-8000-000000000303'::uuid, 'initial', 12.000, 14000, 19500, null, now() - interval '30 days', '0190a5d0-0000-7000-8000-000000000102'::uuid),
  ('0190a5d0-0000-7000-8000-000000000504'::uuid, '0190a5d0-0000-7000-8000-000000000304'::uuid, 'initial', 8.000, 21000, 29000, null, now() - interval '30 days', '0190a5d0-0000-7000-8000-000000000102'::uuid),
  ('0190a5d0-0000-7000-8000-000000000505'::uuid, '0190a5d0-0000-7000-8000-000000000305'::uuid, 'initial', 3.000, 32000, 44000, null, now() - interval '30 days', '0190a5d0-0000-7000-8000-000000000102'::uuid),
  ('0190a5d0-0000-7000-8000-000000000506'::uuid, '0190a5d0-0000-7000-8000-000000000306'::uuid, 'initial', 2.000, 115000, 159000, null, now() - interval '30 days', '0190a5d0-0000-7000-8000-000000000102'::uuid),
  ('0190a5d0-0000-7000-8000-000000000507'::uuid, '0190a5d0-0000-7000-8000-000000000307'::uuid, 'initial', 10.000, 9000, 13500, null, now() - interval '30 days', '0190a5d0-0000-7000-8000-000000000102'::uuid),
  ('0190a5d0-0000-7000-8000-000000000508'::uuid, '0190a5d0-0000-7000-8000-000000000304'::uuid, 'receive', 10.000, 21000, 29000, null, now() - interval '10 days', '0190a5d0-0000-7000-8000-000000000103'::uuid),
  ('0190a5d0-0000-7000-8000-000000000509'::uuid, '0190a5d0-0000-7000-8000-000000000302'::uuid, 'consume', -4.500, 26000, 36000, null, now() - interval '7 days', '0190a5d0-0000-7000-8000-000000000103'::uuid),
  ('0190a5d0-0000-7000-8000-000000000510'::uuid, '0190a5d0-0000-7000-8000-000000000304'::uuid, 'consume', -1.000, 21000, 29000, null, now() - interval '7 days', '0190a5d0-0000-7000-8000-000000000103'::uuid),
  ('0190a5d0-0000-7000-8000-000000000511'::uuid, '0190a5d0-0000-7000-8000-000000000301'::uuid, 'sale', -2.000, 98000, 129000, null, now() - interval '3 days', '0190a5d0-0000-7000-8000-000000000103'::uuid),
  ('0190a5d0-0000-7000-8000-000000000512'::uuid, '0190a5d0-0000-7000-8000-000000000306'::uuid, 'sale', -2.000, 115000, 159000, null, now() - interval '2 days', '0190a5d0-0000-7000-8000-000000000103'::uuid),
  ('0190a5d0-0000-7000-8000-000000000513'::uuid, '0190a5d0-0000-7000-8000-000000000308'::uuid, 'sale', -3.000, null, 2500, null, now() - interval '1 day', '0190a5d0-0000-7000-8000-000000000103'::uuid),
  ('0190a5d0-0000-7000-8000-000000000514'::uuid, '0190a5d0-0000-7000-8000-000000000303'::uuid, 'write_off', -1.000, 14000, 19500, null, now() - interval '1 day', '0190a5d0-0000-7000-8000-000000000102'::uuid)
) as movement (id, product_id, type, quantity_delta, unit_cost_minor, unit_price_minor, note, occurred_at, created_by);
