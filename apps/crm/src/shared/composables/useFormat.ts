// Formats values for display with Intl, in the app's only locale.
const LOCALE = 'uk-UA'

const dateTimeFormat = new Intl.DateTimeFormat(LOCALE, { dateStyle: 'short', timeStyle: 'short' })

export const useFormat = () => ({
  dateTime: (utc: string): string => dateTimeFormat.format(new Date(utc)),
})
