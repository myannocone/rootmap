import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'

const savedTheme = localStorage.getItem('rootmap_theme')
const theme = savedTheme === 'light' || savedTheme === 'dark' ? savedTheme : 'dark'
document.documentElement.classList.add(theme)
document.body.classList.add(theme)
document.documentElement.style.colorScheme = theme

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
