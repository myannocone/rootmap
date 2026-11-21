import { Capacitor } from '@capacitor/core'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import { SubscriptionProvider } from './subscription/SubscriptionProvider.jsx'

if (Capacitor.isNativePlatform()) {
  import('./nativeYahooReturn.js')
}

const savedTheme = localStorage.getItem('rootmap_theme')
const theme = savedTheme === 'light' || savedTheme === 'dark' ? savedTheme : 'dark'
document.documentElement.classList.add(theme)
document.body.classList.add(theme)
document.documentElement.style.colorScheme = theme

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <SubscriptionProvider>
      <App />
    </SubscriptionProvider>
  </StrictMode>,
)
