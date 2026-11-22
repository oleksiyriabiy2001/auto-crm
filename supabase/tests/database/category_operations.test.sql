-- public.push applies the category operations: admin only, the parent must be
-- a live category of the shop, and a move can never create a cycle.
begin;
create extension if not exists pgtap with schema extensions;
select plan(29);

-- ---------------------------------------------------------------------------
-- Fixtures: shop A with an admin and a staff member. The tests build this tree:
-- C1 Оливи
-- └─ C2 Моторні
--    └─ C3 Синтетика

create schema tests;
grant usage on schema tests to authenticated;

create function tests.outcome(p_operation jsonb) returns text language sql as $$
  select coalesce(r ->> 'reason', r ->> 'status')
  from (select public.push(jsonb_build_array(p_operation)) -> 'results' -> 0 as r) result
$$;

create function tests.op(p_type text, p_payload jsonb, p_base_version integer default null) returns jsonb language sql as $$
  select jsonb_build_object(
    'id', gen_random_uuid(),
    'type', p_type,
    'payload', p_payload,
    'clientTimestamp', '2026-11-22T10:00:00Z',
    'deviceId', 'dddddddd-0000-4000-8000-000000000001'
  ) || case when p_base_version is null then '{}'::jsonb else jsonb_build_object('baseVersion', p_base_version) end
$$;

create function tests.category(p_id uuid, p_name text, p_parent_id uuid default null) returns jsonb language sql as $$
  select jsonb_build_object('id', p_id, 'name', p_name, 'parentId', p_parent_id)
$$;

create function tests.move(p_id uuid, p_parent_id uuid) returns jsonb language sql as $$
  select jsonb_build_object('id', p_id, 'changes', jsonb_build_object('parentId', p_parent_id))
$$;

insert into public.tenants (id, name) values ('aaaaaaaa-0000-4000-8000-000000000000', 'Shop A');

insert into public.profiles (id, display_name) values
  ('aaaaaaaa-0000-4000-8000-00000000a001', 'A admin'),
  ('aaaaaaaa-0000-4000-8000-00000000a002', 'A staff');

insert into public.memberships (tenant_id, user_id, role) values
  ('aaaaaaaa-0000-4000-8000-000000000000', 'aaaaaaaa-0000-4000-8000-00000000a001', 'admin'),
  ('aaaaaaaa-0000-4000-8000-000000000000', 'aaaaaaaa-0000-4000-8000-00000000a002', 'staff');

set local role authenticated;

-- ---------------------------------------------------------------------------
-- Admin builds the tree.

set local request.jwt.claim.sub = 'aaaaaaaa-0000-4000-8000-00000000a001';

select is(tests.outcome(tests.op('category.create', tests.category('aaaaaaaa-0000-4000-8000-0000000000c1', 'Оливи'))),
  'accepted', 'admin can create a top-level category');
select is(tests.outcome(tests.op('category.create',
  tests.category('aaaaaaaa-0000-4000-8000-0000000000c2', 'Моторні', 'aaaaaaaa-0000-4000-8000-0000000000c1'))),
  'accepted', 'admin can create a subcategory');
select is(tests.outcome(tests.op('category.create',
  tests.category('aaaaaaaa-0000-4000-8000-0000000000c3', 'Синтетика', 'aaaaaaaa-0000-4000-8000-0000000000c2'))),
  'accepted', 'admin can nest a category two levels deep');
select is(tests.outcome(tests.op('category.create',
  tests.category(gen_random_uuid(), 'Сироти', 'aaaaaaaa-0000-4000-8000-0000000000c9'))),
  'notFound', 'a category under an unknown parent is rejected');
select is(tests.outcome(tests.op('category.create', tests.category(gen_random_uuid(), ' '))),
  'invalidPayload', 'a category needs a name');
select is(tests.outcome(tests.op('category.create', tests.category('aaaaaaaa-0000-4000-8000-0000000000c1', 'Ще раз'))),
  'invalidPayload', 'a category id cannot be reused');

-- ---------------------------------------------------------------------------
-- Staff: categories are admin only, but staff can file a product under one.

set local request.jwt.claim.sub = 'aaaaaaaa-0000-4000-8000-00000000a002';

select is(tests.outcome(tests.op('category.create', tests.category(gen_random_uuid(), 'Фільтри'))),
  'forbidden', 'staff cannot create a category');
select is(tests.outcome(tests.op('category.update',
  '{"id": "aaaaaaaa-0000-4000-8000-0000000000c1", "changes": {"name": "X"}}', 1)),
  'forbidden', 'staff cannot rename a category');
select is(tests.outcome(tests.op('category.delete', '{"id": "aaaaaaaa-0000-4000-8000-0000000000c1"}', 1)),
  'forbidden', 'staff cannot delete a category');
select is(tests.outcome(tests.op('product.create', jsonb_build_object(
  'id', gen_random_uuid(), 'sku', null, 'name', 'Олива 5W-30', 'description', null,
  'categoryId', 'aaaaaaaa-0000-4000-8000-0000000000c3', 'unit', 'l', 'costPriceMinor', null,
  'salePriceMinor', null, 'currency', 'UAH', 'minStock', null, 'locationNote', null,
  'isActive', true, 'barcodes', '[]'::jsonb))),
  'accepted', 'staff can file a new product under a category');

-- ---------------------------------------------------------------------------
-- Admin: edits and moves.

set local request.jwt.claim.sub = 'aaaaaaaa-0000-4000-8000-00000000a001';

select is(tests.outcome(tests.op('category.update',
  '{"id": "aaaaaaaa-0000-4000-8000-0000000000c1", "changes": {"name": "Мастила"}}', 1)),
  'accepted', 'admin can rename a category');
select results_eq(
  $$select name, version from public.categories where id = 'aaaaaaaa-0000-4000-8000-0000000000c1'$$,
  $$values ('Мастила'::text, 2)$$,
  'the rename is applied and the version goes up');
select is(tests.outcome(tests.op('category.update',
  tests.move('aaaaaaaa-0000-4000-8000-0000000000c1', 'aaaaaaaa-0000-4000-8000-0000000000c3'), 2)),
  'categoryCycle', 'a category cannot move under its own descendant');
select is(tests.outcome(tests.op('category.update',
  tests.move('aaaaaaaa-0000-4000-8000-0000000000c1', 'aaaaaaaa-0000-4000-8000-0000000000c1'), 2)),
  'categoryCycle', 'a category cannot be its own parent');
select is(tests.outcome(tests.op('category.update',
  tests.move('aaaaaaaa-0000-4000-8000-0000000000c3', null), 1)),
  'accepted', 'admin can move a category to the top level');
select is((select parent_id from public.categories where id = 'aaaaaaaa-0000-4000-8000-0000000000c3'),
  null, 'the moved category has no parent');
select is(tests.outcome(tests.op('category.update',
  '{"id": "aaaaaaaa-0000-4000-8000-0000000000c1", "changes": {"name": "X"}}')),
  'invalidPayload', 'an edit needs a base version');
select is(tests.outcome(tests.op('category.update',
  '{"id": "aaaaaaaa-0000-4000-8000-0000000000c1", "changes": {}}', 2)),
  'invalidPayload', 'an edit must change something');
select is(tests.outcome(tests.op('category.update',
  '{"id": "aaaaaaaa-0000-4000-8000-0000000000c1", "changes": {"name": null}}', 2)),
  'invalidPayload', 'a name cannot be cleared');
select is(tests.outcome(tests.op('category.update',
  '{"id": "aaaaaaaa-0000-4000-8000-0000000000c9", "changes": {"name": "X"}}', 1)),
  'notFound', 'editing an unknown category is rejected');

-- ---------------------------------------------------------------------------
-- Delete and restore. C3 is top-level now, C2 is under C1.

select is(tests.outcome(tests.op('category.delete', '{"id": "aaaaaaaa-0000-4000-8000-0000000000c2"}', 1)),
  'accepted', 'admin can delete a category');
select isnt((select deleted_at from public.categories where id = 'aaaaaaaa-0000-4000-8000-0000000000c2'),
  null, 'the category is soft deleted');
select is(tests.outcome(tests.op('category.create',
  tests.category(gen_random_uuid(), 'Напівсинтетика', 'aaaaaaaa-0000-4000-8000-0000000000c2'))),
  'notFound', 'a category cannot be created under a deleted one');
select is(tests.outcome(tests.op('category.update',
  tests.move('aaaaaaaa-0000-4000-8000-0000000000c3', 'aaaaaaaa-0000-4000-8000-0000000000c2'), 2)),
  'notFound', 'a category cannot move under a deleted one');
select is(tests.outcome(tests.op('category.delete', '{"id": "aaaaaaaa-0000-4000-8000-0000000000c2"}', 2)),
  'accepted', 'deleting a deleted category is accepted');
select is((select version from public.categories where id = 'aaaaaaaa-0000-4000-8000-0000000000c2'),
  2, 'deleting it again changes nothing');
select is(tests.outcome(tests.op('category.restore', '{"id": "aaaaaaaa-0000-4000-8000-0000000000c2"}', 2)),
  'accepted', 'admin can restore a category');
select results_eq(
  $$select parent_id, deleted_at from public.categories where id = 'aaaaaaaa-0000-4000-8000-0000000000c2'$$,
  $$values ('aaaaaaaa-0000-4000-8000-0000000000c1'::uuid, null::timestamptz)$$,
  'the restored category is live again, in its old place');
select is(tests.outcome(tests.op('category.delete', '{"id": "aaaaaaaa-0000-4000-8000-0000000000c9"}', 1)),
  'notFound', 'deleting an unknown category is rejected');

select * from finish();
rollback;
