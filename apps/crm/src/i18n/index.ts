import { createI18n } from 'vue-i18n'

import uk from './locales/uk.json'

// Ukrainian is the only locale in v1. To add one, create locales/<code>.json
// with the same keys and register it below.
export type MessageSchema = typeof uk

declare module 'vue-i18n' {
  // Gives t('...') key autocomplete from uk.json. t() still accepts any string,
  // so missing keys are caught by ESLint (@intlify/vue-i18n/no-missing-keys).
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type -- module augmentation
  export interface DefineLocaleMessage extends MessageSchema {}
}

export const i18n = createI18n<[MessageSchema], 'uk'>({
  // Required in v11: the default is still the Legacy API. Delete in v12,
  // where Composition API is the only mode.
  // eslint-disable-next-line @typescript-eslint/no-deprecated -- see above
  legacy: false,
  locale: 'uk',
  fallbackLocale: 'uk',
  messages: { uk },
})
