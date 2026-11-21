-- public.pull pages through changes by cursor and returns the contract's JSON.
begin;
create extension if not exists pgtap with schema extensions;
select plan(11);

create schema tests;
grant usage on schema tests to authenticated;

-- Pulls until hasMore is false and returns the last cursor.
create function tests.final_cursor() returns text language plpgsql as $$
declare
  v_response jsonb := public.pull(null);
begin
  while (v_response ->> 'hasMore')::boolean loop
    v_response := public.pull(v_response ->> 'cursor');
  end loop;
  return v_response ->> 'cursor';
end;
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

insert into public.tenants (id, name) values ('aaaaaaaa-0000-4000-8000-000000000000', 'Shop A');
insert into public.profiles (id, display_name) values ('aaaaaaaa-0000-4000-8000-00000000a001', 'A admin');
insert into public.memberships (tenant_id, user_id, role) values
  ('aaaaaaaa-0000-4000-8000-000000000000', 'aaaaaaaa-0000-4000-8000-00000000a001', 'admin');

-- One more row than a batch holds.
insert into public.categories (id, tenant_id, name)
select gen_random_uuid(), 'aaaaaaaa-0000-4000-8000-000000000000', 'Категорія ' || n
from generate_series(1, 1001) n;

set local role authenticated;
set local request.jwt.claim.sub = 'aaaaaaaa-0000-4000-8000-00000000a001';

-- Paging
select is(jsonb_array_length(public.pull(null) -> 'changes' -> 'categories'), 1000, 'the first pull returns a full batch');
select is(public.pull(null) ->> 'hasMore', 'true', 'the first pull says there is more');
select is(jsonb_array_length(public.pull(public.pull(null) ->> 'cursor') -> 'changes' -> 'categories'), 1, 'the next pull returns the rest');
select is(public.pull(public.pull(null) ->> 'cursor') ->> 'hasMore', 'false', 'the next pull says it is done');

select set_config('tests.cursor', tests.final_cursor(), true);
select is(
  public.pull(current_setting('tests.cursor')),
  jsonb_build_object(
    'changes', '{"categories": [], "products": [], "productBarcodes": [], "stockMovements": []}'::jsonb,
    'cursor', current_setting('tests.cursor'),
    'hasMore', false
  ),
  'a pull with nothing new returns empty lists and the same cursor');

-- Changes after the cursor
select public.push(jsonb_build_array(tests.op('product.create', jsonb_build_object(
  'id', 'aaaaaaaa-0000-4000-8000-0000000000f1', 'sku', null, 'name', 'Олива 5W-30', 'description', null,
  'categoryId', null, 'unit', 'l', 'costPriceMinor', 32000, 'salePriceMinor', 41500, 'currency', 'UAH',
  'minStock', 4.5, 'locationNote', null, 'isActive', true, 'barcodes', '[]'::jsonb))));

select is(
  (public.pull(current_setting('tests.cursor')) -> 'changes' -> 'products' -> 0) - 'createdAt' - 'updatedAt',
  '{"id": "aaaaaaaa-0000-4000-8000-0000000000f1", "tenantId": "aaaaaaaa-0000-4000-8000-000000000000",
    "sku": null, "name": "Олива 5W-30", "description": null, "categoryId": null, "unit": "l",
    "costPriceMinor": 32000, "salePriceMinor": 41500, "currency": "UAH", "minStock": 4.5,
    "locationNote": null, "isActive": true, "deletedAt": null, "version": 1}'::jsonb,
  'a new product arrives in the contract''s shape');
select matches(
  public.pull(current_setting('tests.cursor')) -> 'changes' -> 'products' -> 0 ->> 'updatedAt',
  '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$',
  'timestamps are UTC ending in Z');

select public.push(jsonb_build_array(tests.op('product.delete', '{"id": "aaaaaaaa-0000-4000-8000-0000000000f1"}', 1)));

select is(jsonb_array_length(public.pull(current_setting('tests.cursor')) -> 'changes' -> 'products'), 1,
  'a changed row arrives once, in its latest state');
select isnt(public.pull(current_setting('tests.cursor')) -> 'changes' -> 'products' -> 0 ->> 'deletedAt', null,
  'a deleted product arrives as a tombstone');
select is(jsonb_array_length(public.pull(current_setting('tests.cursor')) -> 'changes' -> 'categories'), 0,
  'unchanged rows are not sent again');

select throws_ok($$select public.pull('not-a-cursor')$$, '22P02', null, 'a malformed cursor is rejected');

select * from finish();
rollback;
