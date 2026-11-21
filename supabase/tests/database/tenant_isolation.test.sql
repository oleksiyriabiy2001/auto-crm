-- Phase 1 gate: no user can read or change another shop's data, and no client
-- can write any table directly.
begin;
create extension if not exists pgtap with schema extensions;
select plan(42);

-- ---------------------------------------------------------------------------
-- Fixtures: shop A (admin, staff), shop B (admin), and a user with no shop.

create schema tests;
grant usage on schema tests to anon, authenticated;

create function tests.outcome(p_operation jsonb) returns text language sql as $$
  select coalesce(r ->> 'reason', r ->> 'status')
  from (select public.push(jsonb_build_array(p_operation)) -> 'results' -> 0 as r) result
$$;

create function tests.op(p_type text, p_payload jsonb, p_base_version integer default null) returns jsonb language sql as $$
  select jsonb_build_object(
    'id', gen_random_uuid(),
    'type', p_type,
    'payload', p_payload,
    'clientTimestamp', '2026-11-21T10:00:00Z',
    'deviceId', 'dddddddd-0000-4000-8000-000000000001'
  ) || case when p_base_version is null then '{}'::jsonb else jsonb_build_object('baseVersion', p_base_version) end
$$;

insert into public.tenants (id, name) values
  ('aaaaaaaa-0000-4000-8000-000000000000', 'Shop A'),
  ('bbbbbbbb-0000-4000-8000-000000000000', 'Shop B');

insert into public.profiles (id, display_name) values
  ('aaaaaaaa-0000-4000-8000-00000000a001', 'A admin'),
  ('aaaaaaaa-0000-4000-8000-00000000a002', 'A staff'),
  ('bbbbbbbb-0000-4000-8000-00000000b001', 'B admin'),
  ('cccccccc-0000-4000-8000-00000000c001', 'Outsider');

insert into public.memberships (tenant_id, user_id, role) values
  ('aaaaaaaa-0000-4000-8000-000000000000', 'aaaaaaaa-0000-4000-8000-00000000a001', 'admin'),
  ('aaaaaaaa-0000-4000-8000-000000000000', 'aaaaaaaa-0000-4000-8000-00000000a002', 'staff'),
  ('bbbbbbbb-0000-4000-8000-000000000000', 'bbbbbbbb-0000-4000-8000-00000000b001', 'admin');

insert into public.categories (id, tenant_id, name) values
  ('aaaaaaaa-0000-4000-8000-0000000000c1', 'aaaaaaaa-0000-4000-8000-000000000000', 'Оливи'),
  ('bbbbbbbb-0000-4000-8000-0000000000c1', 'bbbbbbbb-0000-4000-8000-000000000000', 'Фільтри');

insert into public.products (id, tenant_id, name, unit, category_id) values
  ('aaaaaaaa-0000-4000-8000-0000000000f1', 'aaaaaaaa-0000-4000-8000-000000000000', 'Product A', 'pcs', 'aaaaaaaa-0000-4000-8000-0000000000c1'),
  ('bbbbbbbb-0000-4000-8000-0000000000f1', 'bbbbbbbb-0000-4000-8000-000000000000', 'Product B', 'pcs', 'bbbbbbbb-0000-4000-8000-0000000000c1');

insert into public.product_barcodes (id, tenant_id, product_id, barcode) values
  ('aaaaaaaa-0000-4000-8000-0000000000b1', 'aaaaaaaa-0000-4000-8000-000000000000', 'aaaaaaaa-0000-4000-8000-0000000000f1', '111'),
  ('bbbbbbbb-0000-4000-8000-0000000000b1', 'bbbbbbbb-0000-4000-8000-000000000000', 'bbbbbbbb-0000-4000-8000-0000000000f1', '222');

insert into public.stock_movements (id, tenant_id, product_id, type, quantity_delta, occurred_at, created_by, device_id) values
  ('aaaaaaaa-0000-4000-8000-0000000000e1', 'aaaaaaaa-0000-4000-8000-000000000000', 'aaaaaaaa-0000-4000-8000-0000000000f1', 'receive', 5, now(), 'aaaaaaaa-0000-4000-8000-00000000a001', 'dddddddd-0000-4000-8000-000000000001'),
  ('bbbbbbbb-0000-4000-8000-0000000000e1', 'bbbbbbbb-0000-4000-8000-000000000000', 'bbbbbbbb-0000-4000-8000-0000000000f1', 'receive', 7, now(), 'bbbbbbbb-0000-4000-8000-00000000b001', 'dddddddd-0000-4000-8000-000000000001');

insert into public.audit_log (tenant_id, actor_id, entity, entity_id, action, changes) values
  ('aaaaaaaa-0000-4000-8000-000000000000', 'aaaaaaaa-0000-4000-8000-00000000a001', 'product', 'aaaaaaaa-0000-4000-8000-0000000000f1', 'update', '{}'),
  ('bbbbbbbb-0000-4000-8000-000000000000', 'bbbbbbbb-0000-4000-8000-00000000b001', 'product', 'bbbbbbbb-0000-4000-8000-0000000000f1', 'update', '{}');

-- ---------------------------------------------------------------------------
-- Reads: each member sees exactly their own shop.

set local role authenticated;
set local request.jwt.claim.sub = 'aaaaaaaa-0000-4000-8000-00000000a001';

select results_eq($$select id from public.tenants$$, array['aaaaaaaa-0000-4000-8000-000000000000'::uuid], 'A admin reads only shop A');
select results_eq($$select user_id from public.memberships order by user_id$$,
  array['aaaaaaaa-0000-4000-8000-00000000a001'::uuid, 'aaaaaaaa-0000-4000-8000-00000000a002'], 'A admin reads only shop A memberships');
select results_eq($$select display_name from public.profiles order by display_name$$,
  array['A admin', 'A staff'], 'A admin reads only profiles in shop A');
select results_eq($$select id from public.categories$$, array['aaaaaaaa-0000-4000-8000-0000000000c1'::uuid], 'A admin reads only shop A categories');
select results_eq($$select id from public.products$$, array['aaaaaaaa-0000-4000-8000-0000000000f1'::uuid], 'A admin reads only shop A products');
select results_eq($$select id from public.product_barcodes$$, array['aaaaaaaa-0000-4000-8000-0000000000b1'::uuid], 'A admin reads only shop A barcodes');
select results_eq($$select id from public.stock_movements$$, array['aaaaaaaa-0000-4000-8000-0000000000e1'::uuid], 'A admin reads only shop A movements');
select results_eq($$select product_id from public.stock_levels$$, array['aaaaaaaa-0000-4000-8000-0000000000f1'::uuid], 'A admin reads only shop A stock levels');
select results_eq($$select tenant_id from public.audit_log$$, array['aaaaaaaa-0000-4000-8000-000000000000'::uuid], 'A admin reads only shop A audit log');

set local request.jwt.claim.sub = 'aaaaaaaa-0000-4000-8000-00000000a002';
select is_empty($$select * from public.audit_log$$, 'staff cannot read the audit log');

set local request.jwt.claim.sub = 'bbbbbbbb-0000-4000-8000-00000000b001';
select results_eq($$select id from public.products$$, array['bbbbbbbb-0000-4000-8000-0000000000f1'::uuid], 'B admin reads only shop B products');
select results_eq($$select id from public.stock_movements$$, array['bbbbbbbb-0000-4000-8000-0000000000e1'::uuid], 'B admin reads only shop B movements');
select results_eq($$select tenant_id from public.audit_log$$, array['bbbbbbbb-0000-4000-8000-000000000000'::uuid], 'B admin reads only shop B audit log');

-- A signed-in user with no shop sees nothing and cannot sync.
set local request.jwt.claim.sub = 'cccccccc-0000-4000-8000-00000000c001';
select is_empty($$select * from public.tenants$$, 'a user with no shop reads no shop');
select is_empty($$select * from public.products$$, 'a user with no shop reads no products');
select throws_ok($$select public.pull(null)$$, '42501', null, 'a user with no shop cannot pull');
select throws_ok($$select public.bootstrap()$$, '42501', null, 'a user with no shop cannot bootstrap');

-- ---------------------------------------------------------------------------
-- Anonymous callers hold no grants at all.

set local role anon;
select throws_ok($$select * from public.products$$, '42501', null, 'anon cannot read products');
select throws_ok($$select public.pull(null)$$, '42501', null, 'anon cannot pull');
select throws_ok($$select public.push('[]'::jsonb)$$, '42501', null, 'anon cannot push');

-- ---------------------------------------------------------------------------
-- Direct writes: refused for every client, even inside their own shop.

set local role authenticated;
set local request.jwt.claim.sub = 'aaaaaaaa-0000-4000-8000-00000000a001';

select throws_ok($$insert into public.products (id, tenant_id, name, unit) values (gen_random_uuid(), 'aaaaaaaa-0000-4000-8000-000000000000', 'X', 'pcs')$$,
  '42501', null, 'members cannot insert products directly');
select throws_ok($$update public.products set name = 'X'$$, '42501', null, 'members cannot update products directly');
select throws_ok($$delete from public.products$$, '42501', null, 'members cannot delete products directly');
select throws_ok($$update public.stock_movements set quantity_delta = 100$$, '42501', null, 'members cannot edit the ledger');
select throws_ok($$delete from public.stock_movements$$, '42501', null, 'members cannot delete from the ledger');
select throws_ok($$insert into public.audit_log (tenant_id, actor_id, entity, entity_id, action, changes) values ('aaaaaaaa-0000-4000-8000-000000000000', 'aaaaaaaa-0000-4000-8000-00000000a001', 'product', gen_random_uuid(), 'update', '{}')$$,
  '42501', null, 'members cannot write the audit log');
select throws_ok($$update public.memberships set role = 'super_admin'$$, '42501', null, 'members cannot change roles');
select throws_ok($$update public.tenants set status = 'active'$$, '42501', null, 'members cannot change their shop');
select throws_ok($$select * from private.sync_operations$$, '42501', null, 'members cannot read server-only tables');

-- ---------------------------------------------------------------------------
-- Pushes cannot reach another shop. Shop B's ids are rejected as unknown.

select is(tests.outcome(tests.op('product.update',
  '{"id": "bbbbbbbb-0000-4000-8000-0000000000f1", "changes": {"name": "Hacked"}}', 1)),
  'notFound', 'A admin cannot edit a shop B product');
select is(tests.outcome(tests.op('product.delete', '{"id": "bbbbbbbb-0000-4000-8000-0000000000f1"}', 1)),
  'notFound', 'A admin cannot delete a shop B product');
select is(tests.outcome(tests.op('barcode.add',
  '{"id": "aaaaaaaa-0000-4000-8000-0000000000b9", "productId": "bbbbbbbb-0000-4000-8000-0000000000f1", "barcode": "999", "symbology": null}')),
  'notFound', 'A admin cannot add a barcode to a shop B product');
select is(tests.outcome(tests.op('barcode.remove', '{"id": "bbbbbbbb-0000-4000-8000-0000000000b1"}')),
  'notFound', 'A admin cannot remove a shop B barcode');
select is(tests.outcome(tests.op('stock.move', jsonb_build_object(
  'id', gen_random_uuid(), 'productId', 'bbbbbbbb-0000-4000-8000-0000000000f1', 'type', 'receive',
  'quantityDelta', 1, 'unitCostMinor', null, 'unitPriceMinor', null, 'currency', 'UAH',
  'note', null, 'occurredAt', '2026-11-21T10:00:00Z'))),
  'notFound', 'A admin cannot record stock on a shop B product');
select is(tests.outcome(tests.op('product.create', jsonb_build_object(
  'id', gen_random_uuid(), 'sku', null, 'name', 'Sneaky', 'description', null,
  'categoryId', 'bbbbbbbb-0000-4000-8000-0000000000c1', 'unit', 'pcs', 'costPriceMinor', null,
  'salePriceMinor', null, 'currency', 'UAH', 'minStock', null, 'locationNote', null,
  'isActive', true, 'barcodes', '[]'::jsonb))),
  'invalidPayload', 'A admin cannot file a product under a shop B category');

-- Pull and bootstrap return only the caller's shop.
select is(
  (select jsonb_agg(p ->> 'id') from jsonb_array_elements(public.pull(null) -> 'changes' -> 'products') p),
  '["aaaaaaaa-0000-4000-8000-0000000000f1"]'::jsonb,
  'pull returns only shop A products');
select is(
  (select count(*) from jsonb_array_elements(public.pull(null) -> 'changes' -> 'stockMovements') m
   where m ->> 'tenantId' <> 'aaaaaaaa-0000-4000-8000-000000000000'),
  0::bigint,
  'pull returns no movements from other shops');

set local request.jwt.claim.sub = 'aaaaaaaa-0000-4000-8000-00000000a002';
select is(public.bootstrap() -> 'tenant' ->> 'id', 'aaaaaaaa-0000-4000-8000-000000000000', 'bootstrap returns the caller''s shop');
select is(public.bootstrap() -> 'membership' ->> 'role', 'staff', 'bootstrap returns the caller''s role');

-- ---------------------------------------------------------------------------
-- Shop B is untouched by everything above.

reset role;
select is((select name from public.products where id = 'bbbbbbbb-0000-4000-8000-0000000000f1'), 'Product B', 'shop B product is unchanged');
select is((select deleted_at from public.products where id = 'bbbbbbbb-0000-4000-8000-0000000000f1'), null, 'shop B product is not deleted');
select is((select quantity from public.stock_levels where product_id = 'bbbbbbbb-0000-4000-8000-0000000000f1'), 7.000, 'shop B stock is unchanged');

select * from finish();
rollback;
