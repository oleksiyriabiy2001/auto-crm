-- Category operations (INV-6): category.create, category.update,
-- category.delete and category.restore, admin and super admin only
-- (manageCategories in packages/core/src/roles.ts). Redefines role_can and
-- apply_operation from the sync API migration; everything else is unchanged.

create or replace function private.role_can(p_role text, p_capability text)
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
    when 'manageCategories' then p_role in ('admin', 'super_admin')
    else false
  end
$$;

create or replace function private.apply_operation(
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
  v_parent_id uuid;
begin
  if exists (select 1 from private.sync_operations where id = p_operation_id) then
    return private.push_result(p_operation_id, 'duplicate');
  end if;

  if jsonb_typeof(v_payload) is distinct from 'object' then
    return private.push_result(p_operation_id, 'rejected', 'invalidPayload');
  end if;

  v_capability := case v_type
    when 'category.create' then 'manageCategories'
    when 'category.update' then 'manageCategories'
    when 'category.delete' then 'manageCategories'
    when 'category.restore' then 'manageCategories'
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
    if v_type in (
      'category.update', 'category.delete', 'category.restore',
      'product.update', 'product.delete', 'product.restore'
    )
      and (p_operation ->> 'baseVersion')::integer is null then
      return private.push_result(p_operation_id, 'rejected', 'invalidPayload');
    end if;

    case v_type
      when 'category.create' then
        -- A new subcategory goes under a live category of the same shop.
        v_parent_id := (v_payload ->> 'parentId')::uuid;
        if v_parent_id is not null and not exists (
          select 1 from public.categories
          where id = v_parent_id and tenant_id = p_tenant_id and deleted_at is null
        ) then
          return private.push_result(p_operation_id, 'rejected', 'notFound');
        end if;

        insert into public.categories (id, tenant_id, name, parent_id)
        values (v_id, p_tenant_id, v_payload ->> 'name', v_parent_id);

      when 'category.update' then
        v_changes := v_payload -> 'changes';
        if jsonb_typeof(v_changes) is distinct from 'object' or v_changes = '{}'::jsonb then
          return private.push_result(p_operation_id, 'rejected', 'invalidPayload');
        end if;

        if not exists (select 1 from public.categories where id = v_id and tenant_id = p_tenant_id) then
          return private.push_result(p_operation_id, 'rejected', 'notFound');
        end if;

        v_parent_id := (v_changes ->> 'parentId')::uuid;
        if v_parent_id is not null then
          if not exists (
            select 1 from public.categories
            where id = v_parent_id and tenant_id = p_tenant_id and deleted_at is null
          ) then
            return private.push_result(p_operation_id, 'rejected', 'notFound');
          end if;

          -- createsCategoryCycle: the new parent must not be the category or
          -- one of its descendants. Pushes are serialised per shop, so two
          -- offline moves cannot both pass this check. UNION stops on a loop.
          if exists (
            with recursive ancestors (id, parent_id) as (
              select c.id, c.parent_id from public.categories c
              where c.id = v_parent_id and c.tenant_id = p_tenant_id
              union
              select c.id, c.parent_id from public.categories c
              join ancestors a on c.id = a.parent_id
              where c.tenant_id = p_tenant_id
            )
            select 1 from ancestors where id = v_id
          ) then
            return private.push_result(p_operation_id, 'rejected', 'categoryCycle');
          end if;
        end if;

        -- Last write wins, as for products.
        update public.categories set
          name = case when v_changes ? 'name' then v_changes ->> 'name' else name end,
          parent_id = case when v_changes ? 'parentId' then v_parent_id else parent_id end,
          version = version + 1
        where id = v_id and tenant_id = p_tenant_id;

      when 'category.delete', 'category.restore' then
        if not exists (select 1 from public.categories where id = v_id and tenant_id = p_tenant_id) then
          return private.push_result(p_operation_id, 'rejected', 'notFound');
        end if;

        -- Products and subcategories keep their reference, so a restore brings
        -- the tree back. Deleting a deleted category is a no-op, as for products.
        update public.categories set
          deleted_at = case when v_type = 'category.delete' then now() end,
          version = version + 1
        where id = v_id
          and tenant_id = p_tenant_id
          and (deleted_at is null) = (v_type = 'category.delete');

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
