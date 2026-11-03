import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

function headerValue(req, name) {
  const value = req.headers[name]
  if (Array.isArray(value)) return value[0] || ''
  return value || ''
}

function decodeOnce(value) {
  const text = String(value || '')
  if (!text.includes('%')) return text
  try {
    return decodeURIComponent(text)
  } catch {
    return text
  }
}

function privacyRoute() {
  const sendPrivacy = (req, _res, next) => {
    const path = String(req.url || '').split('?')[0]
    if (path === '/privacy' || path === '/privacy/') req.url = '/privacy.html'
    next()
  }
  return {
    name: 'privacy-route',
    configureServer(server) {
      server.middlewares.use(sendPrivacy)
    },
    configurePreviewServer(server) {
      server.middlewares.use(sendPrivacy)
    }
  }
}

export default defineConfig({
  plugins: [react(), tailwindcss(), privacyRoute()],
  server: {
    host: true,
    port: 5173,
    proxy: {
      '/api/espn': {
        target: 'https://lm-api-reads.fantasy.espn.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/espn/, ''),
        configure: (proxy) => {
          proxy.on('proxyReq', (proxyReq, req) => {
            const swid = decodeOnce(headerValue(req, 'x-swid'))
            const espnS2 = decodeOnce(headerValue(req, 'x-espn-s2'))
            if (swid && espnS2) {
              proxyReq.setHeader('Cookie', `SWID=${swid}; espn_s2=${espnS2};`)
            } else if (req.headers.cookie) {
              proxyReq.setHeader('Cookie', req.headers.cookie)
            }
            proxyReq.removeHeader('x-swid')
            proxyReq.removeHeader('x-espn-s2')
          })
        }
      }
    }
  }
})
