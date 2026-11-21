import './styles/main.css'

import { createPinia } from 'pinia'
import { createApp } from 'vue'

import App from './App.vue'
import { i18n } from './i18n'
import router from './router'
import { useSessionStore } from './shared/stores/session.store'

const app = createApp(App)
const pinia = createPinia()

app.use(pinia)
app.use(i18n)

// The route guard needs to know who is signed in before the first navigation.
await useSessionStore(pinia).restore()

app.use(router)

document.title = i18n.global.t('app.title')

app.mount('#app')
