import { z } from 'zod'

export const RoleSchema = z.enum(['super_admin', 'admin', 'staff'])
export type Role = z.infer<typeof RoleSchema>

// One capability per row of "Roles and permissions" in SPEC.md.
export type Capability
  = | 'viewInventory' // view products, stock and history
    | 'scan' // scan and look up
    | 'recordMovement' // record receive, sale and consume movements
    | 'createProduct' // create products, including from a scan
    | 'addBarcode' // add a barcode to an existing product
    | 'editProduct' // edit existing products and remove barcodes
    | 'deleteProduct' // delete and restore products
    | 'adjustStock' // adjustments, write-offs and initial counts
    | 'viewReports' // see cost prices, analytics and the audit log
    | 'importExport' // import and export CSV
    | 'manageUsers' // manage the shop's users

const ALL: readonly Role[] = ['staff', 'admin', 'super_admin']
const ADMINS: readonly Role[] = ['admin', 'super_admin']
const SUPER_ADMIN: readonly Role[] = ['super_admin']

const PERMISSIONS: Record<Capability, readonly Role[]> = {
  viewInventory: ALL,
  scan: ALL,
  recordMovement: ALL,
  createProduct: ALL,
  addBarcode: ALL,
  editProduct: ADMINS,
  deleteProduct: ADMINS,
  adjustStock: ADMINS,
  viewReports: ADMINS,
  importExport: ADMINS,
  manageUsers: SUPER_ADMIN,
}

export const can = (role: Role, capability: Capability): boolean =>
  PERMISSIONS[capability].includes(role)
