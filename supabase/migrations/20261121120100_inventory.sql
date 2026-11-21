-- Inventory: the synced tables, the stock view and the audit log.
--
-- Every synced table has id (client-generated UUID), tenant_id, created_at,
-- updated_at, deleted_at, version and server_seq. Child rows reference their
-- parent through (tenant_id, id), so a row can never point into another shop.

create table public.categories (
  id uuid primary key,
  tenant_id uuid not null references public.tenants (id),
  name text not null check (btrim(name) <> ''),
  parent_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  version integer not null default 1 check (version > 0),
  server_seq bigint not null,
  constraint categories_tenant_id_id_key unique (tenant_id, id),
  foreign key (tenant_id, parent_id) references public.categories (tenant_id, id)
);
create index categories_tenant_id_parent_id_idx on public.categories (tenant_id, parent_id);
create index categories_tenant_id_server_seq_idx on public.categories (tenant_id, server_seq);

create table public.products (
  id uuid primary key,
  tenant_id uuid not null references public.tenants (id),
  sku text check (btrim(sku) <> ''),
  name text not null check (btrim(name) <> ''),
  description text check (btrim(description) <> ''),
  category_id uuid,
  unit text not null check (unit in ('pcs', 'l', 'kg', 'set', 'm')),
  cost_price_minor bigint check (cost_price_minor >= 0),
  sale_price_minor bigint check (sale_price_minor >= 0),
  currency text not null default 'UAH' check (currency in ('UAH')),
  min_stock numeric(12, 3) check (min_stock >= 0),
  location_note text check (btrim(location_note) <> ''),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  version integer not null default 1 check (version > 0),
  server_seq bigint not null,
  constraint products_tenant_id_id_key unique (tenant_id, id),
  -- Includes deleted products, so a restore can never collide. NULLs are
  -- distinct, so any number of products may have no SKU.
  constraint products_sku_key unique (tenant_id, sku),
  foreign key (tenant_id, category_id) references public.categories (tenant_id, id)
);
create index products_tenant_id_category_id_idx on public.products (tenant_id, category_id);
create index products_tenant_id_server_seq_idx on public.products (tenant_id, server_seq);

create table public.product_barcodes (
  id uuid primary key,
  tenant_id uuid not null references public.tenants (id),
  product_id uuid not null,
  barcode text not null check (btrim(barcode) <> ''),
  symbology text check (symbology in ('ean13', 'ean8', 'upca', 'code128')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  version integer not null default 1 check (version > 0),
  server_seq bigint not null,
  foreign key (tenant_id, product_id) references public.products (tenant_id, id)
);
-- A barcode points to one product per shop. Removed barcodes can be reused.
create unique index product_barcodes_barcode_key
  on public.product_barcodes (tenant_id, barcode) where deleted_at is null;
create index product_barcodes_tenant_id_product_id_idx on public.product_barcodes (tenant_id, product_id);
create index product_barcodes_tenant_id_server_seq_idx on public.product_barcodes (tenant_id, server_seq);

-- Append-only ledger: rows are never updated or deleted, and no role is
-- granted either. Sign and note rules are enforced by public.push.
create table public.stock_movements (
  id uuid primary key,
  tenant_id uuid not null references public.tenants (id),
  product_id uuid not null,
  type text not null check (type in ('initial', 'receive', 'sale', 'consume', 'adjustment', 'write_off')),
  quantity_delta numeric(12, 3) not null,
  unit_cost_minor bigint check (unit_cost_minor >= 0),
  unit_price_minor bigint check (unit_price_minor >= 0),
  currency text not null default 'UAH' check (currency in ('UAH')),
  note text check (btrim(note) <> ''),
  occurred_at timestamptz not null,
  created_by uuid not null references public.profiles (id),
  device_id uuid not null,
  -- Empty in v1. Later a work order points its consumed parts here.
  source_type text,
  source_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  version integer not null default 1 check (version > 0),
  server_seq bigint not null,
  foreign key (tenant_id, product_id) references public.products (tenant_id, id)
);
create index stock_movements_tenant_id_product_id_idx on public.stock_movements (tenant_id, product_id);
create index stock_movements_tenant_id_server_seq_idx on public.stock_movements (tenant_id, server_seq);
create index stock_movements_created_by_idx on public.stock_movements (created_by);

-- Current stock is always derived from the ledger.
create view public.stock_levels
with (security_invoker = true)
as
select tenant_id, product_id, sum(quantity_delta) as quantity
from public.stock_movements
group by tenant_id, product_id;

-- server_seq and updated_at triggers on every synced table.
create trigger set_server_seq before insert or update on public.categories
  for each row execute function private.set_server_seq();
create trigger set_server_seq before insert or update on public.products
  for each row execute function private.set_server_seq();
create trigger set_server_seq before insert or update on public.product_barcodes
  for each row execute function private.set_server_seq();
create trigger set_server_seq before insert or update on public.stock_movements
  for each row execute function private.set_server_seq();

create trigger set_updated_at before update on public.categories
  for each row execute function private.set_updated_at();
create trigger set_updated_at before update on public.products
  for each row execute function private.set_updated_at();
create trigger set_updated_at before update on public.product_barcodes
  for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------------
-- Audit log (AUD-1): product edits, deletes and restores, and adjustments.
-- Written by triggers only. For an edit it keeps the old and new value of each
-- changed field, so an edit overwritten by last-write-wins is never lost.

create table public.audit_log (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id),
  actor_id uuid not null,
  entity text not null,
  entity_id uuid not null,
  action text not null,
  changes jsonb not null,
  at timestamptz not null default now()
);
create index audit_log_tenant_id_at_idx on public.audit_log (tenant_id, at);

create function private.audit_product_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_changes jsonb;
begin
  select jsonb_object_agg(n.key, jsonb_build_object('old', o.value, 'new', n.value))
  into v_changes
  from jsonb_each(to_jsonb(new)) n
  join jsonb_each(to_jsonb(old)) o using (key)
  where n.value is distinct from o.value
    and n.key not in ('updated_at', 'version', 'server_seq');

  if v_changes is null then
    return null;
  end if;

  insert into public.audit_log (tenant_id, actor_id, entity, entity_id, action, changes)
  values (
    new.tenant_id,
    private.current_user_id(),
    'product',
    new.id,
    case
      when old.deleted_at is null and new.deleted_at is not null then 'delete'
      when old.deleted_at is not null and new.deleted_at is null then 'restore'
      else 'update'
    end,
    v_changes
  );
  return null;
end;
$$;

create function private.audit_adjustment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.audit_log (tenant_id, actor_id, entity, entity_id, action, changes)
  values (
    new.tenant_id,
    new.created_by,
    'stock_movement',
    new.id,
    'adjustment',
    jsonb_build_object('productId', new.product_id, 'quantityDelta', new.quantity_delta, 'note', new.note)
  );
  return null;
end;
$$;

revoke execute on function private.audit_product_update() from public;
revoke execute on function private.audit_adjustment() from public;

create trigger audit_update after update on public.products
  for each row execute function private.audit_product_update();
create trigger audit_adjustment after insert on public.stock_movements
  for each row when (new.type = 'adjustment') execute function private.audit_adjustment();

-- ---------------------------------------------------------------------------
-- Operations the server has accepted, so a repeated push answers "duplicate".
-- Rejected operations are not stored: a retry from "needs attention" is
-- evaluated again.

create table private.sync_operations (
  id uuid primary key,
  tenant_id uuid not null references public.tenants (id),
  user_id uuid not null,
  type text not null,
  received_at timestamptz not null default now()
);
create index sync_operations_tenant_id_idx on private.sync_operations (tenant_id);

-- ---------------------------------------------------------------------------
-- Access: members read their own shop's rows; only admins read the audit log.
-- No client role may write.

alter table public.categories enable row level security;
alter table public.products enable row level security;
alter table public.product_barcodes enable row level security;
alter table public.stock_movements enable row level security;
alter table public.audit_log enable row level security;
alter table private.sync_operations enable row level security;

revoke all on
  public.categories, public.products, public.product_barcodes,
  public.stock_movements, public.stock_levels, public.audit_log
from anon, authenticated;
grant select on
  public.categories, public.products, public.product_barcodes,
  public.stock_movements, public.stock_levels, public.audit_log
to authenticated;

create policy "Members read their shop's categories"
  on public.categories for select to authenticated
  using (tenant_id = (select private.current_tenant_id()));

create policy "Members read their shop's products"
  on public.products for select to authenticated
  using (tenant_id = (select private.current_tenant_id()));

create policy "Members read their shop's barcodes"
  on public.product_barcodes for select to authenticated
  using (tenant_id = (select private.current_tenant_id()));

create policy "Members read their shop's movements"
  on public.stock_movements for select to authenticated
  using (tenant_id = (select private.current_tenant_id()));

create policy "Admins read their shop's audit log"
  on public.audit_log for select to authenticated
  using (
    tenant_id = (select private.current_tenant_id())
    and (select private.current_user_is_admin())
  );
