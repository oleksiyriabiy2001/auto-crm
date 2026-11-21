-- The sync API: bootstrap, push and pull. These three functions are the whole
-- backend surface for the app. They take and return exactly the JSON shapes
-- of the zod schemas in packages/core/src/sync.ts (camelCase keys, UTC
-- timestamps ending in Z), so the adapter passes them through unchanged.

-- ---------------------------------------------------------------------------
-- Helpers

-- Timestamps in the contract's format: ISO 8601, UTC, trailing Z.
create function private.iso(value timestamptz)
returns text
language sql
immutable
set search_path = ''
as $$
  select to_char(value at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
$$;

-- Parses a quantity, rejecting more than three decimals instead of letting
-- numeric(12,3) round it silently.
create function private.to_quantity(value text)
returns numeric
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_quantity numeric := value::numeric;
begin
  if v_quantity is distinct from round(v_quantity, 3) then
    raise exception 'quantity has more than three decimals' using errcode = '22023';
  end if;
  return v_quantity;
end;
$$;

-- Mirrors can() in packages/core/src/roles.ts for the capabilities push checks.
create function private.role_can(p_role text, p_capability text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select case p_capability
    when 'createProduct' then true
    when 'addBarcode' then true
    when 'recordMovement' then true
    when 'editProduct' then p_role in ('admin', 'super_admin')
    when 'deleteProduct' then p_role in ('admin', 'super_admin')
    when 'adjustStock' then p_role in ('admin', 'super_admin')
    else false
  end
$$;

create function private.push_result(p_operation_id uuid, p_status text, p_reason text default null)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_strip_nulls(jsonb_build_object('operationId', p_operation_id, 'status', p_status, 'reason', p_reason))
$$;

-- ---------------------------------------------------------------------------
-- Applying one operation. Business rules from packages/core are re-checked
-- here: the role (requiredCapability), movement signs and notes
-- (validateMovement) and the quantity format. Each call runs in its own
-- subtransaction, so a rejected operation leaves nothing behind.

create function private.apply_operation(
  p_operation jsonb,
  p_operation_id uuid,
  p_user_id uuid,
  p_tenant_id uuid,
  p_role text
)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_type text := p_operation ->> 'type';
  v_payload jsonb := p_operation -> 'payload';
  v_id uuid;
  v_capability text;
  v_changes jsonb;
  v_quantity numeric;
  v_constraint text;
  v_barcode jsonb;
begin
  if exists (select 1 from private.sync_operations where id = p_operation_id) then
    return private.push_result(p_operation_id, 'duplicate');
  end if;

  if jsonb_typeof(v_payload) is distinct from 'object' then
    return private.push_result(p_operation_id, 'rejected', 'invalidPayload');
  end if;

  v_capability := case v_type
    when 'product.create' then 'createProduct'
    when 'product.update' then 'editProduct'
    when 'product.delete' then 'deleteProduct'
    when 'product.restore' then 'deleteProduct'
    when 'barcode.add' then 'addBarcode'
    when 'barcode.remove' then 'editProduct'
    when 'stock.move' then
      case v_payload ->> 'type'
        when 'receive' then 'recordMovement'
        when 'sale' then 'recordMovement'
        when 'consume' then 'recordMovement'
        when 'initial' then 'adjustStock'
        when 'adjustment' then 'adjustStock'
        when 'write_off' then 'adjustStock'
      end
  end;

  if v_capability is null then
    return private.push_result(p_operation_id, 'rejected', 'invalidPayload');
  end if;

  if not private.role_can(p_role, v_capability) then
    return private.push_result(p_operation_id, 'rejected', 'forbidden');
  end if;

  -- Every rejection inside this block must come before the first write, or
  -- return through an exception: a plain return keeps the writes.
  begin
    v_id := (v_payload ->> 'id')::uuid;
    if v_id is null then
      return private.push_result(p_operation_id, 'rejected', 'invalidPayload');
    end if;

    -- Edits, deletes and restores carry the version they were based on.
    if v_type in ('product.update', 'product.delete', 'product.restore')
      and (p_operation ->> 'baseVersion')::integer is null then
      return private.push_result(p_operation_id, 'rejected', 'invalidPayload');
    end if;

    case v_type
      when 'product.create' then
        if jsonb_typeof(v_payload -> 'barcodes') is distinct from 'array' then
          return private.push_result(p_operation_id, 'rejected', 'invalidPayload');
        end if;

        insert into public.products (
          id, tenant_id, sku, name, description, category_id, unit,
          cost_price_minor, sale_price_minor, currency, min_stock, location_note, is_active
        ) values (
          v_id,
          p_tenant_id,
          v_payload ->> 'sku',
          v_payload ->> 'name',
          v_payload ->> 'description',
          (v_payload ->> 'categoryId')::uuid,
          v_payload ->> 'unit',
          (v_payload ->> 'costPriceMinor')::bigint,
          (v_payload ->> 'salePriceMinor')::bigint,
          v_payload ->> 'currency',
          private.to_quantity(v_payload ->> 'minStock'),
          v_payload ->> 'locationNote',
          (v_payload ->> 'isActive')::boolean
        );

        for v_barcode in select value from jsonb_array_elements(v_payload -> 'barcodes') loop
          insert into public.product_barcodes (id, tenant_id, product_id, barcode, symbology)
          values (
            (v_barcode ->> 'id')::uuid,
            p_tenant_id,
            v_id,
            v_barcode ->> 'barcode',
            v_barcode ->> 'symbology'
          );
        end loop;

      when 'product.update' then
        v_changes := v_payload -> 'changes';
        if jsonb_typeof(v_changes) is distinct from 'object' or v_changes = '{}'::jsonb then
          return private.push_result(p_operation_id, 'rejected', 'invalidPayload');
        end if;

        -- Last write wins: the edit applies whatever the current version is.
        update public.products set
          sku = case when v_changes ? 'sku' then v_changes ->> 'sku' else sku end,
          name = case when v_changes ? 'name' then v_changes ->> 'name' else name end,
          description = case when v_changes ? 'description' then v_changes ->> 'description' else description end,
          category_id = case when v_changes ? 'categoryId' then (v_changes ->> 'categoryId')::uuid else category_id end,
          unit = case when v_changes ? 'unit' then v_changes ->> 'unit' else unit end,
          cost_price_minor = case when v_changes ? 'costPriceMinor' then (v_changes ->> 'costPriceMinor')::bigint else cost_price_minor end,
          sale_price_minor = case when v_changes ? 'salePriceMinor' then (v_changes ->> 'salePriceMinor')::bigint else sale_price_minor end,
          currency = case when v_changes ? 'currency' then v_changes ->> 'currency' else currency end,
          min_stock = case when v_changes ? 'minStock' then private.to_quantity(v_changes ->> 'minStock') else min_stock end,
          location_note = case when v_changes ? 'locationNote' then v_changes ->> 'locationNote' else location_note end,
          is_active = case when v_changes ? 'isActive' then (v_changes ->> 'isActive')::boolean else is_active end,
          version = version + 1
        where id = v_id and tenant_id = p_tenant_id;

        if not found then
          return private.push_result(p_operation_id, 'rejected', 'notFound');
        end if;

      when 'product.delete', 'product.restore' then
        if not exists (select 1 from public.products where id = v_id and tenant_id = p_tenant_id) then
          return private.push_result(p_operation_id, 'rejected', 'notFound');
        end if;

        -- Deleting a deleted product (or restoring a live one) is a no-op.
        update public.products set
          deleted_at = case when v_type = 'product.delete' then now() end,
          version = version + 1
        where id = v_id
          and tenant_id = p_tenant_id
          and (deleted_at is null) = (v_type = 'product.delete');

      when 'barcode.add' then
        if not exists (
          select 1 from public.products
          where id = (v_payload ->> 'productId')::uuid and tenant_id = p_tenant_id and deleted_at is null
        ) then
          return private.push_result(p_operation_id, 'rejected', 'notFound');
        end if;

        insert into public.product_barcodes (id, tenant_id, product_id, barcode, symbology)
        values (
          v_id,
          p_tenant_id,
          (v_payload ->> 'productId')::uuid,
          v_payload ->> 'barcode',
          v_payload ->> 'symbology'
        );

      when 'barcode.remove' then
        if not exists (select 1 from public.product_barcodes where id = v_id and tenant_id = p_tenant_id) then
          return private.push_result(p_operation_id, 'rejected', 'notFound');
        end if;

        update public.product_barcodes set deleted_at = now(), version = version + 1
        where id = v_id and tenant_id = p_tenant_id and deleted_at is null;

      when 'stock.move' then
        v_quantity := private.to_quantity(v_payload ->> 'quantityDelta');

        -- validateMovement: no zero, sign by type, adjustments need a note.
        if v_quantity is null
          or v_quantity = 0
          or (v_payload ->> 'type' in ('initial', 'receive') and v_quantity < 0)
          or (v_payload ->> 'type' in ('sale', 'consume', 'write_off') and v_quantity > 0)
          or (v_payload ->> 'type' = 'adjustment' and coalesce(btrim(v_payload ->> 'note'), '') = '') then
          return private.push_result(p_operation_id, 'rejected', 'invalidPayload');
        end if;

        -- A sale of a deleted product still happened, so deleted products count.
        if not exists (
          select 1 from public.products
          where id = (v_payload ->> 'productId')::uuid and tenant_id = p_tenant_id
        ) then
          return private.push_result(p_operation_id, 'rejected', 'notFound');
        end if;

        insert into public.stock_movements (
          id, tenant_id, product_id, type, quantity_delta, unit_cost_minor, unit_price_minor,
          currency, note, occurred_at, created_by, device_id
        ) values (
          v_id,
          p_tenant_id,
          (v_payload ->> 'productId')::uuid,
          v_payload ->> 'type',
          v_quantity,
          (v_payload ->> 'unitCostMinor')::bigint,
          (v_payload ->> 'unitPriceMinor')::bigint,
          v_payload ->> 'currency',
          v_payload ->> 'note',
          (v_payload ->> 'occurredAt')::timestamptz,
          p_user_id,
          (p_operation ->> 'deviceId')::uuid
        );
    end case;

    insert into private.sync_operations (id, tenant_id, user_id, type)
    values (p_operation_id, p_tenant_id, p_user_id, v_type);

    return private.push_result(p_operation_id, 'accepted');
  exception
    when unique_violation then
      get stacked diagnostics v_constraint = constraint_name;
      return private.push_result(
        p_operation_id,
        'rejected',
        case v_constraint
          when 'product_barcodes_barcode_key' then 'barcodeConflict'
          when 'products_sku_key' then 'skuConflict'
          else 'invalidPayload'
        end
      );
    -- Bad casts, out-of-range numbers, failed checks, missing required fields
    -- and references to rows outside the shop.
    when data_exception or integrity_constraint_violation then
      return private.push_result(p_operation_id, 'rejected', 'invalidPayload');
  end;
end;
$$;

-- ---------------------------------------------------------------------------
-- push(operations): applies the operations in order and returns one result
-- per operation. Security definer because clients have no write grants; the
-- tenant and role come from the caller's membership, never from the payload.

create function public.push(operations jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := private.current_user_id();
  v_tenant_id uuid;
  v_role text;
  v_status text;
  v_operation jsonb;
  v_operation_id uuid;
  v_results jsonb := '[]'::jsonb;
begin
  if v_user_id is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  if jsonb_typeof(operations) is distinct from 'array' or jsonb_array_length(operations) = 0 then
    raise exception 'operations must be a non-empty array' using errcode = '22023';
  end if;

  select m.tenant_id, m.role, t.status
  into v_tenant_id, v_role, v_status
  from public.memberships m
  join public.tenants t on t.id = m.tenant_id
  where m.user_id = v_user_id and m.is_active;

  -- Serialise pushes per shop, so server_seq order matches commit order and
  -- pull never skips a row that commits late.
  if v_tenant_id is not null then
    perform pg_advisory_xact_lock(hashtextextended(v_tenant_id::text, 0));
  end if;

  for v_operation in select value from jsonb_array_elements(operations) with ordinality order by ordinality loop
    -- Without a valid id there is nothing to report against.
    v_operation_id := (v_operation ->> 'id')::uuid;
    if v_operation_id is null then
      raise exception 'every operation needs an id' using errcode = '22023';
    end if;

    v_results := v_results || jsonb_build_array(
      case
        -- A user who lost access while offline: their operations go to
        -- "needs attention" instead of failing the whole push.
        when v_tenant_id is null then private.push_result(v_operation_id, 'rejected', 'forbidden')
        when v_status <> 'active' then private.push_result(v_operation_id, 'rejected', 'tenantSuspended')
        else private.apply_operation(v_operation, v_operation_id, v_user_id, v_tenant_id, v_role)
      end
    );
  end loop;

  return jsonb_build_object('results', v_results);
end;
$$;

-- ---------------------------------------------------------------------------
-- pull(cursor): rows changed since the cursor, tombstones included. The cursor
-- is the last server_seq the device received, as text; null starts from the
-- beginning. Security invoker, so RLS limits it to the caller's shop.

create function public.pull(cursor text)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  c_batch_size constant integer := 1000;
  v_tenant_id uuid := private.current_tenant_id();
  v_after bigint := coalesce(pull.cursor::bigint, 0);
  v_result jsonb;
begin
  if v_tenant_id is null then
    raise exception 'no active membership' using errcode = '42501';
  end if;
  if (select status from public.tenants where id = v_tenant_id) <> 'active' then
    raise exception 'tenant suspended' using errcode = '42501';
  end if;

  with batch as (
    select kind, seq, data
    from (
      select 'categories' as kind, c.server_seq as seq, jsonb_build_object(
        'id', c.id, 'tenantId', c.tenant_id, 'name', c.name, 'parentId', c.parent_id,
        'createdAt', private.iso(c.created_at), 'updatedAt', private.iso(c.updated_at),
        'deletedAt', private.iso(c.deleted_at), 'version', c.version
      ) as data
      from public.categories c
      where c.tenant_id = v_tenant_id and c.server_seq > v_after

      union all

      select 'products', p.server_seq, jsonb_build_object(
        'id', p.id, 'tenantId', p.tenant_id, 'sku', p.sku, 'name', p.name,
        'description', p.description, 'categoryId', p.category_id, 'unit', p.unit,
        'costPriceMinor', p.cost_price_minor, 'salePriceMinor', p.sale_price_minor,
        'currency', p.currency, 'minStock', p.min_stock, 'locationNote', p.location_note,
        'isActive', p.is_active,
        'createdAt', private.iso(p.created_at), 'updatedAt', private.iso(p.updated_at),
        'deletedAt', private.iso(p.deleted_at), 'version', p.version
      )
      from public.products p
      where p.tenant_id = v_tenant_id and p.server_seq > v_after

      union all

      select 'productBarcodes', b.server_seq, jsonb_build_object(
        'id', b.id, 'tenantId', b.tenant_id, 'productId', b.product_id,
        'barcode', b.barcode, 'symbology', b.symbology,
        'createdAt', private.iso(b.created_at), 'updatedAt', private.iso(b.updated_at),
        'deletedAt', private.iso(b.deleted_at), 'version', b.version
      )
      from public.product_barcodes b
      where b.tenant_id = v_tenant_id and b.server_seq > v_after

      union all

      select 'stockMovements', s.server_seq, jsonb_build_object(
        'id', s.id, 'tenantId', s.tenant_id, 'productId', s.product_id, 'type', s.type,
        'quantityDelta', s.quantity_delta, 'unitCostMinor', s.unit_cost_minor,
        'unitPriceMinor', s.unit_price_minor, 'currency', s.currency, 'note', s.note,
        'occurredAt', private.iso(s.occurred_at), 'createdBy', s.created_by,
        'deviceId', s.device_id, 'sourceType', s.source_type, 'sourceId', s.source_id,
        'createdAt', private.iso(s.created_at), 'updatedAt', private.iso(s.updated_at),
        'deletedAt', private.iso(s.deleted_at), 'version', s.version
      )
      from public.stock_movements s
      where s.tenant_id = v_tenant_id and s.server_seq > v_after
    ) changes
    order by seq
    limit c_batch_size + 1
  ),
  numbered as (
    select kind, seq, data, row_number() over (order by seq) as n
    from batch
  )
  select jsonb_build_object(
    'changes', jsonb_build_object(
      'categories', coalesce(jsonb_agg(data order by seq) filter (where kind = 'categories' and n <= c_batch_size), '[]'::jsonb),
      'products', coalesce(jsonb_agg(data order by seq) filter (where kind = 'products' and n <= c_batch_size), '[]'::jsonb),
      'productBarcodes', coalesce(jsonb_agg(data order by seq) filter (where kind = 'productBarcodes' and n <= c_batch_size), '[]'::jsonb),
      'stockMovements', coalesce(jsonb_agg(data order by seq) filter (where kind = 'stockMovements' and n <= c_batch_size), '[]'::jsonb)
    ),
    'cursor', coalesce(max(seq) filter (where n <= c_batch_size), v_after)::text,
    'hasMore', count(*) > c_batch_size
  )
  into v_result
  from numbered;

  return v_result;
end;
$$;

-- ---------------------------------------------------------------------------
-- bootstrap(): who the caller is and which shop they work in. The shop's data
-- then arrives through pull(null).

create function public.bootstrap()
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_result jsonb;
begin
  select jsonb_build_object(
    'tenant', jsonb_build_object('id', t.id, 'name', t.name, 'status', t.status),
    'profile', jsonb_build_object('id', p.id, 'displayName', p.display_name),
    'membership', jsonb_build_object(
      'id', m.id, 'tenantId', m.tenant_id, 'userId', m.user_id,
      'role', m.role, 'isActive', m.is_active
    )
  )
  into v_result
  from public.memberships m
  join public.tenants t on t.id = m.tenant_id
  join public.profiles p on p.id = m.user_id
  where m.user_id = (select private.current_user_id()) and m.is_active;

  if v_result is null then
    raise exception 'no active membership' using errcode = '42501';
  end if;
  return v_result;
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants: signed-in users call the three API functions; nothing else.

revoke execute on all functions in schema private from public;
grant execute on function private.iso(timestamptz) to authenticated;

revoke execute on function public.push(jsonb), public.pull(text), public.bootstrap() from public, anon;
grant execute on function public.push(jsonb), public.pull(text), public.bootstrap() to authenticated;
