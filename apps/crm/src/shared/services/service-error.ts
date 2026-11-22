// Why a service refused a use case. Checked on the device before anything
// reaches the outbox; the server re-checks every operation at push time.
export type ServiceErrorCode
  = | 'notSignedIn' // no shop is open
    | 'forbidden' // the role does not allow it
    | 'notFound' // the row does not exist, or not in the state the use case needs
    | 'invalid' // the input failed validation; `cause` holds the zod error
    | 'barcodeInUse' // a live barcode with this code already exists
    | 'skuInUse' // another product, deleted ones included, has this SKU
    | 'categoryCycle' // the move would put a category under its own descendant

export class ServiceError extends Error {
  constructor(readonly code: ServiceErrorCode, options?: ErrorOptions) {
    super(code, options)
    this.name = 'ServiceError'
  }
}
