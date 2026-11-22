import type { Currency } from '@auto-crm/core'

// Formats values for display with Intl, in the app's only locale.
const LOCALE = 'uk-UA'

const dateTimeFormat = new Intl.DateTimeFormat(LOCALE, { dateStyle: 'short', timeStyle: 'short' })
const quantityFormat = new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 3 })
const moneyFormats = new Map<Currency, Intl.NumberFormat>()

const moneyFormat = (currency: Currency): Intl.NumberFormat => {
  let format = moneyFormats.get(currency)
  if (!format) {
    format = new Intl.NumberFormat(LOCALE, { style: 'currency', currency })
    moneyFormats.set(currency, format)
  }
  return format
}

export const useFormat = () => ({
  dateTime: (utc: string): string => dateTimeFormat.format(new Date(utc)),
  // Money is stored in minor units (kopiykas).
  money: (minor: number, currency: Currency): string => moneyFormat(currency).format(minor / 100),
  quantity: (quantity: number): string => quantityFormat.format(quantity),
})
