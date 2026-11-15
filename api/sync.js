import {
  importYahooLeagues,
  resolveYahooAccessToken,
  requestIsSecure,
  yahooTokenSetCookieHeaders
} from '../lib/yahooFantasy.js';

function bearerFrom(req) {
  const header = String(req.headers?.authorization || '');
  if (!header) return '';
  return header.replace(/^Bearer\s+/i, '').trim();
}

export default async function handler(req, res) {
  const secure = requestIsSecure(req);
  const bearer = bearerFrom(req);

  try {
    let accessToken = bearer;
    let refreshed = null;

    if (!accessToken) {
      const resolved = await resolveYahooAccessToken(req, { forceRefresh: true });
      accessToken = resolved.accessToken;
      refreshed = resolved.tokenData;
    } else {
      // Prefer a refreshed cookie token when present so week stats never ride an expired bearer.
      try {
        const resolved = await resolveYahooAccessToken(req, { forceRefresh: true });
        if (resolved?.accessToken) {
          accessToken = resolved.accessToken;
          refreshed = resolved.tokenData;
        }
      } catch {
        // Keep the Authorization bearer when cookie refresh is unavailable.
      }
    }

    if (!accessToken) {
      return res.status(401).json({ error: 'Missing Yahoo access token. Connect Yahoo again.' });
    }

    const leagues = await importYahooLeagues(accessToken);
    if (refreshed?.access_token) {
      res.setHeader('Set-Cookie', yahooTokenSetCookieHeaders(secure, refreshed));
    }

    return res.status(200).json({ leagues, count: leagues.length });
  } catch (err) {
    console.error('Sync failure:', err);
    const status = err?.status && Number.isFinite(Number(err.status)) ? Number(err.status) : 500;
    return res.status(status).json({
      error: err?.message || 'Internal sync failure',
      details: err?.message
    });
  }
}
