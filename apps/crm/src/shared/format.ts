import type { Currency } from '@auto-crm/core'

// Formats values for display with Intl, in the app's only locale.
const LOCALE = 'uk-UA'

const dateTimeFormat = new Intl.DateTimeFormat(LOCALE, { dateStyle: 'short', timeStyle: 'short' })
const quantityFormat = new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 3 })
const moneyFormats = new Map<Currency, Intl.NumberFormat>()

export const formatDateTime = (utc: string): string => dateTimeFormat.format(new Date(utc))

// Money is stored in minor units (kopiykas).
export const formatMoney = (minor: number, currency: Currency): string => {
  let format = moneyFormats.get(currency)
  if (!format) {
    format = new Intl.NumberFormat(LOCALE, { style: 'currency', currency })
    moneyFormats.set(currency, format)
  }
  return format.format(minor / 100)
}

export const formatQuantity = (quantity: number): string => quantityFormat.format(quantity)
