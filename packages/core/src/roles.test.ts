import { describe, expect, it } from 'vitest'
import type { Capability, Role } from './roles'
import { can } from './roles'

// The "Roles and permissions" table from SPEC.md: [staff, admin, super_admin].
const TABLE: [Capability, boolean, boolean, boolean][] = [
  ['viewInventory', true, true, true],
  ['scan', true, true, true],
  ['recordMovement', true, true, true],
  ['createProduct', true, true, true],
  ['addBarcode', true, true, true],
  ['editProduct', false, true, true],
  ['deleteProduct', false, true, true],
  ['adjustStock', false, true, true],
  ['viewReports', false, true, true],
  ['importExport', false, true, true],
  ['manageUsers', false, false, true],
]

const ROLES: Role[] = ['staff', 'admin', 'super_admin']

describe('can', () => {
  it.each(TABLE)('%s: staff %s, admin %s, super admin %s', (capability, ...expected) => {
    expect(ROLES.map((role) => can(role, capability))).toStrictEqual(expected)
  })
})
