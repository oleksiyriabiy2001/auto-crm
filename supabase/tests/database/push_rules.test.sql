-- public.push enforces the permission table and the business rules from
-- packages/core, and public.pull pages through changes by cursor.
begin;
create extension if not exists pgtap with schema extensions;
select plan(44);

-- ---------------------------------------------------------------------------
-- Fixtures: shop A (admin, staff, a deactivated user) and a suspended shop S.
-- Product F1 has SKU "SKU-1" and barcode "111".

create schema tests;
grant usage on schema tests to authenticated;

create function tests.outcome(p_operation jsonb) returns text language sql as $$
  select coalesce(r ->> 'reason', r ->> 'status')
  from (select public.push(jsonb_build_array(p_operation)) -> 'results' -> 0 as r) result
$$;

create function tests.op(
  p_type text,
  p_payload jsonb,
  p_base_version integer default null,
  p_id uuid default gen_random_uuid()
) returns jsonb language sql as $$
  select jsonb_build_object(
    'id', p_id,
    'type', p_type,
    'payload', p_payload,
    'clientTimestamp', '2026-11-21T10:00:00Z',
    'deviceId', 'dddddddd-0000-4000-8000-000000000001'
  ) || case when p_base_version is null then '{}'::jsonb else jsonb_build_object('baseVersion', p_base_version) end
$$;

create function tests.product(p_id uuid, p_sku text default null, p_barcodes jsonb default '[]') returns jsonb language sql as $$
  select jsonb_build_object(
    'id', p_id, 'sku', p_sku, 'name', 'Фільтр масляний', 'description', null, 'categoryId', null,
    'unit', 'pcs', 'costPriceMinor', 18000, 'salePriceMinor', 25000, 'currency', 'UAH',
    'minStock', null, 'locationNote', null, 'isActive', true, 'barcodes', p_barcodes
  )
$$;

create function tests.barcode(p_barcode text) returns jsonb language sql as $$
  select jsonb_build_object('id', gen_random_uuid(), 'barcode', p_barcode, 'symbology', null)
$$;

create function tests.movement(p_product_id uuid, p_type text, p_quantity numeric, p_note text default null) returns jsonb language sql as $$
  select jsonb_build_object(
    'id', gen_random_uuid(), 'productId', p_product_id, 'type', p_type, 'quantityDelta', p_quantity,
    'unitCostMinor', 18000, 'unitPriceMinor', 25000, 'currency', 'UAH', 'note', p_note,
    'occurredAt', '2026-11-21T10:00:00Z'
  )
$$;

insert into public.tenants (id, name, status) values
  ('aaaaaaaa-0000-4000-8000-000000000000', 'Shop A', 'active'),
  ('eeeeeeee-0000-4000-8000-000000000000', 'Shop S', 'suspended');

insert into public.profiles (id, display_name) values
  ('aaaaaaaa-0000-4000-8000-00000000a001', 'A admin'),
  ('aaaaaaaa-0000-4000-8000-00000000a002', 'A staff'),
  ('aaaaaaaa-0000-4000-8000-00000000a003', 'A former staff'),
  ('eeeeeeee-0000-4000-8000-00000000e001', 'S admin');

insert into public.memberships (tenant_id, user_id, role, is_active) values
  ('aaaaaaaa-0000-4000-8000-000000000000', 'aaaaaaaa-0000-4000-8000-00000000a001', 'admin', true),
  ('aaaaaaaa-0000-4000-8000-000000000000', 'aaaaaaaa-0000-4000-8000-00000000a002', 'staff', true),
  ('aaaaaaaa-0000-4000-8000-000000000000', 'aaaaaaaa-0000-4000-8000-00000000a003', 'staff', false),
  ('eeeeeeee-0000-4000-8000-000000000000', 'eeeeeeee-0000-4000-8000-00000000e001', 'admin', true);

insert into public.products (id, tenant_id, sku, name, unit) values
  ('aaaaaaaa-0000-4000-8000-0000000000f1', 'aaaaaaaa-0000-4000-8000-000000000000', 'SKU-1', 'Олива 5W-30', 'l'),
  ('eeeeeeee-0000-4000-8000-0000000000f1', 'eeeeeeee-0000-4000-8000-000000000000', null, 'Product S', 'pcs');

insert into public.product_barcodes (id, tenant_id, product_id, barcode) values
  ('aaaaaaaa-0000-4000-8000-0000000000b1', 'aaaaaaaa-0000-4000-8000-000000000000', 'aaaaaaaa-0000-4000-8000-0000000000f1', '111');

-- ---------------------------------------------------------------------------
-- Staff: the permission table from SPEC.md.

set local role authenticated;
set local request.jwt.claim.sub = 'aaaaaaaa-0000-4000-8000-00000000a002';

select is(tests.outcome(tests.op('product.create',
  tests.product('aaaaaaaa-0000-4000-8000-0000000000f2', null, jsonb_build_array(tests.barcode('333'))))),
  'accepted', 'staff can create a product with a barcode');
select is(tests.outcome(tests.op('barcode.add', jsonb_build_object(
  'id', gen_random_uuid(), 'productId', 'aaaaaaaa-0000-4000-8000-0000000000f1', 'barcode', '444', 'symbology', 'ean13'))),
  'accepted', 'staff can add a barcode to an existing product');
select is(tests.outcome(tests.op('stock.move', tests.movement('aaaaaaaa-0000-4000-8000-0000000000f1', 'sale', -1.5))),
  'accepted', 'staff can record a sale');
select is(tests.outcome(tests.op('stock.move', tests.movement('aaaaaaaa-0000-4000-8000-0000000000f1', 'receive', 10))),
  'accepted', 'staff can record a receive');
select is(tests.outcome(tests.op('product.update',
  '{"id": "aaaaaaaa-0000-4000-8000-0000000000f1", "changes": {"name": "X"}}', 1)),
  'forbidden', 'staff cannot edit a product');
select is(tests.outcome(tests.op('barcode.remove', '{"id": "aaaaaaaa-0000-4000-8000-0000000000b1"}')),
  'forbidden', 'staff cannot remove a barcode');
select is(tests.outcome(tests.op('product.delete', '{"id": "aaaaaaaa-0000-4000-8000-0000000000f1"}', 1)),
  'forbidden', 'staff cannot delete a product');
select is(tests.outcome(tests.op('stock.move', tests.movement('aaaaaaaa-0000-4000-8000-0000000000f1', 'adjustment', 1, 'Перерахунок'))),
  'forbidden', 'staff cannot record an adjustment');
select is(tests.outcome(tests.op('stock.move', tests.movement('aaaaaaaa-0000-4000-8000-0000000000f1', 'write_off', -1))),
  'forbidden', 'staff cannot record a write-off');
select is(tests.outcome(tests.op('stock.move', tests.movement('aaaaaaaa-0000-4000-8000-0000000000f1', 'initial', 5))),
  'forbidden', 'staff cannot record an initial count');

-- ---------------------------------------------------------------------------
-- Admin: edits, the audit log and the movement rules.

set local request.jwt.claim.sub = 'aaaaaaaa-0000-4000-8000-00000000a001';

select is(tests.outcome(tests.op('product.update',
  '{"id": "aaaaaaaa-0000-4000-8000-0000000000f1", "changes": {"name": "Олива 5W-40", "salePriceMinor": 45000}}', 1)),
  'accepted', 'admin can edit a product');
select results_eq(
  $$select name, sale_price_minor, version from public.products where id = 'aaaaaaaa-0000-4000-8000-0000000000f1'$$,
  $$values ('Олива 5W-40'::text, 45000::bigint, 2)$$,
  'the edit is applied and the version goes up');
select is(
  (select changes -> 'name' from public.audit_log where entity_id = 'aaaaaaaa-0000-4000-8000-0000000000f1' and action = 'update'),
  '{"old": "Олива 5W-30", "new": "Олива 5W-40"}'::jsonb,
  'the audit log keeps the overwritten value');
select is(tests.outcome(tests.op('product.update',
  '{"id": "aaaaaaaa-0000-4000-8000-0000000000f1", "changes": {"name": "X"}}')),
  'invalidPayload', 'an edit needs a base version');
select is(tests.outcome(tests.op('product.update',
  '{"id": "aaaaaaaa-0000-4000-8000-0000000000f1", "changes": {}}', 2)),
  'invalidPayload', 'an edit must change something');
select is(tests.outcome(tests.op('product.update',
  '{"id": "aaaaaaaa-0000-4000-8000-0000000000f9", "changes": {"name": "X"}}', 1)),
  'notFound', 'editing an unknown product is rejected');

select is(tests.outcome(tests.op('stock.move', tests.movement('aaaaaaaa-0000-4000-8000-0000000000f1', 'adjustment', -20, 'Брак'))),
  'accepted', 'admin can record an adjustment with a note');
select is(
  (select count(*) from public.audit_log where entity = 'stock_movement' and action = 'adjustment'),
  1::bigint, 'the adjustment is in the audit log');
select is(tests.outcome(tests.op('stock.move', tests.movement('aaaaaaaa-0000-4000-8000-0000000000f1', 'adjustment', 1))),
  'invalidPayload', 'an adjustment needs a note');
select is(tests.outcome(tests.op('stock.move', tests.movement('aaaaaaaa-0000-4000-8000-0000000000f1', 'adjustment', 1, '  '))),
  'invalidPayload', 'a blank note does not count');
select is(tests.outcome(tests.op('stock.move', tests.movement('aaaaaaaa-0000-4000-8000-0000000000f1', 'receive', -1))),
  'invalidPayload', 'a receive cannot be negative');
select is(tests.outcome(tests.op('stock.move', tests.movement('aaaaaaaa-0000-4000-8000-0000000000f1', 'sale', 1))),
  'invalidPayload', 'a sale cannot be positive');
select is(tests.outcome(tests.op('stock.move', tests.movement('aaaaaaaa-0000-4000-8000-0000000000f1', 'receive', 0))),
  'invalidPayload', 'a movement cannot be zero');
select is(tests.outcome(tests.op('stock.move', tests.movement('aaaaaaaa-0000-4000-8000-0000000000f1', 'receive', 1.0005))),
  'invalidPayload', 'a quantity cannot have more than three decimals');
select is(tests.outcome(tests.op('stock.move', tests.movement('aaaaaaaa-0000-4000-8000-0000000000f1', 'transfer', 1))),
  'invalidPayload', 'an unknown movement type is rejected');

-- Negative stock is allowed: 10 received, 1.5 sold, 20 adjusted away.
select is((select quantity from public.stock_levels where product_id = 'aaaaaaaa-0000-4000-8000-0000000000f1'),
  -11.500, 'negative stock is accepted, not rejected');

-- ---------------------------------------------------------------------------
-- Conflicts, duplicates and malformed operations.

select is(tests.outcome(tests.op('product.create',
  tests.product('aaaaaaaa-0000-4000-8000-0000000000f3', null, jsonb_build_array(tests.barcode('111'))))),
  'barcodeConflict', 'a barcode already in use is rejected');
select is((select count(*) from public.products where id = 'aaaaaaaa-0000-4000-8000-0000000000f3'),
  0::bigint, 'a rejected create leaves no product behind');
select is(tests.outcome(tests.op('product.create', tests.product('aaaaaaaa-0000-4000-8000-0000000000f4', 'SKU-1'))),
  'skuConflict', 'a SKU already in use is rejected');
select is(tests.outcome(tests.op('product.create', tests.product(gen_random_uuid()) || '{"unit": "box"}')),
  'invalidPayload', 'an unknown unit is rejected');
select is(tests.outcome(tests.op('product.merge', '{"id": "aaaaaaaa-0000-4000-8000-0000000000f1"}')),
  'invalidPayload', 'an unknown operation type is rejected');

select is(tests.outcome(tests.op('stock.move', tests.movement('aaaaaaaa-0000-4000-8000-0000000000f2', 'receive', 1), null,
  'aaaaaaaa-0000-4000-8000-0000000000d1')),
  'accepted', 'a new operation is accepted');
select is(tests.outcome(tests.op('stock.move', tests.movement('aaaaaaaa-0000-4000-8000-0000000000f2', 'receive', 1), null,
  'aaaaaaaa-0000-4000-8000-0000000000d1')),
  'duplicate', 'the same operation id again is a duplicate');
select is((select count(*) from public.stock_movements where product_id = 'aaaaaaaa-0000-4000-8000-0000000000f2'),
  1::bigint, 'a duplicate is not applied twice');

-- A removed barcode can be reused.
select is(tests.outcome(tests.op('barcode.remove', '{"id": "aaaaaaaa-0000-4000-8000-0000000000b1"}')),
  'accepted', 'admin can remove a barcode');
select is(tests.outcome(tests.op('barcode.add', jsonb_build_object(
  'id', gen_random_uuid(), 'productId', 'aaaaaaaa-0000-4000-8000-0000000000f2', 'barcode', '111', 'symbology', null))),
  'accepted', 'a removed barcode can be attached to another product');

-- Delete, a sale of the deleted product, then restore.
select is(tests.outcome(tests.op('product.delete', '{"id": "aaaaaaaa-0000-4000-8000-0000000000f2"}', 1)),
  'accepted', 'admin can delete a product');
select is(tests.outcome(tests.op('stock.move', tests.movement('aaaaaaaa-0000-4000-8000-0000000000f2', 'sale', -1))),
  'accepted', 'a sale of a deleted product is still recorded');
select is(tests.outcome(tests.op('product.restore', '{"id": "aaaaaaaa-0000-4000-8000-0000000000f2"}', 2)),
  'accepted', 'admin can restore a product');
select is((select deleted_at from public.products where id = 'aaaaaaaa-0000-4000-8000-0000000000f2'),
  null, 'the restored product is live again');

-- One push applies its operations in order, each on its own.
select is(
  (select jsonb_agg(coalesce(r ->> 'reason', r ->> 'status'))
   from jsonb_array_elements(public.push(jsonb_build_array(
     tests.op('stock.move', tests.movement('aaaaaaaa-0000-4000-8000-0000000000f1', 'receive', 1)),
     tests.op('stock.move', tests.movement('aaaaaaaa-0000-4000-8000-0000000000f1', 'receive', -1)),
     tests.op('stock.move', tests.movement('aaaaaaaa-0000-4000-8000-0000000000f1', 'receive', 2))
   )) -> 'results') r),
  '["accepted", "invalidPayload", "accepted"]'::jsonb,
  'a rejected operation does not stop the rest of the push');

-- ---------------------------------------------------------------------------
-- Suspended shops and deactivated users.

set local request.jwt.claim.sub = 'eeeeeeee-0000-4000-8000-00000000e001';
select is(tests.outcome(tests.op('stock.move', tests.movement('eeeeeeee-0000-4000-8000-0000000000f1', 'receive', 1))),
  'tenantSuspended', 'a suspended shop cannot push');
select throws_ok($$select public.pull(null)$$, '42501', null, 'a suspended shop cannot pull');

set local request.jwt.claim.sub = 'aaaaaaaa-0000-4000-8000-00000000a003';
select is(tests.outcome(tests.op('stock.move', tests.movement('aaaaaaaa-0000-4000-8000-0000000000f1', 'sale', -1))),
  'forbidden', 'a deactivated user''s operations are rejected');

select * from finish();
rollback;
