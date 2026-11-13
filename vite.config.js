import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'
import espnHandler from './api/espn.js'
import { completeYahooOAuth, startYahooLogin } from './lib/yahooFantasy.js'

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

function yahooAuthDev() {
  const attach = (server) => {
    const env = loadEnv(server.config.mode, server.config.root || process.cwd(), '')
    for (const key of ['YAHOO_CLIENT_ID', 'YAHOO_CLIENT_SECRET', 'YAHOO_REDIRECT_URI', 'APP_URL']) {
      if (!process.env[key] && env[key]) process.env[key] = env[key]
    }
    server.middlewares.use(async (req, res, next) => {
      const url = new URL(req.url || '/', 'http://localhost')
      const path = url.pathname
      const login = path === '/api/auth/yahoo/login' || path === '/api/auth/yahoo'
      const callback = path === '/api/auth/callback' || path === '/api/auth/yahoo/callback'
      if (!login && !callback) return next()
      req.query = Object.fromEntries(url.searchParams.entries())
      try {
        if (login) return startYahooLogin(req, res)
        return await completeYahooOAuth(req, res)
      } catch (err) {
        return next(err)
      }
    })
  }
  return {
    name: 'yahoo-auth-dev',
    configureServer: attach,
    configurePreviewServer: attach
  }
}

function espnDiscoverDev() {
  const attach = (server) => {
    server.middlewares.use(async (req, res, next) => {
      const url = new URL(req.url || '/', 'http://localhost')
      if (url.pathname !== '/api/discover-espn') return next()
      req.query = Object.fromEntries(url.searchParams.entries())
      req.query.discover = '1'
      try {
        return await espnHandler(req, res)
      } catch (err) {
        return next(err)
      }
    })
  }
  return {
    name: 'espn-discover-dev',
    configureServer: attach,
    configurePreviewServer: attach
  }
}

function devNetworkHint() {
  const attach = (server) => {
    server.middlewares.use((req, res, next) => {
      const path = String(req.url || '').split('?')[0]
      if (path !== '/api/dev-network') return next()
      const origins = server.resolvedUrls?.network || []
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify({ origins }))
    })
  }
  return {
    name: 'dev-network-hint',
    configureServer: attach,
    configurePreviewServer: attach
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
  plugins: [yahooAuthDev(), espnDiscoverDev(), devNetworkHint(), react(), tailwindcss(), privacyRoute()],
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
