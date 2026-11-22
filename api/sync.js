import {
  importYahooLeagues,
  inspectYahooPayload,
  resolveYahooAccessToken,
  requestIsSecure,
  yahooTokenSetCookieHeaders
} from '../lib/yahooFantasy.js';

function bearerFrom(req) {
  const header = String(req.headers?.authorization || '');
  if (!header) return '';
  return header.replace(/^Bearer\s+/i, '').trim();
}

function wantsInspect(req) {
  const value = req.query?.inspectYahoo ?? req.query?.inspect;
  return value === '1' || value === 'true' || value === 'yes';
}

function weekFrom(req) {
  const week = Number(req.query?.week);
  return week >= 1 && week <= 18 ? week : undefined;
}

async function resolveAccess(req, bearer) {
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

  return { accessToken, refreshed };
}

function wantsForceRefresh(req) {
  const value = req.query?.forceRefresh;
  return value === '1' || value === 'true' || value === 'yes';
}

export default async function handler(req, res) {
  const secure = requestIsSecure(req);
  const bearer = bearerFrom(req);
  const week = weekFrom(req);
  if (wantsForceRefresh(req)) {
    res.setHeader('Cache-Control', 'no-store, max-age=0');
    res.setHeader('Pragma', 'no-cache');
  }

  try {
    const { accessToken, refreshed } = await resolveAccess(req, bearer);

    if (!accessToken) {
      return res.status(401).json({ error: 'Missing Yahoo access token. Connect Yahoo again.' });
    }

    if (wantsInspect(req)) {
      const inspect = await inspectYahooPayload(accessToken, { week });
      if (refreshed?.access_token) {
        res.setHeader('Set-Cookie', yahooTokenSetCookieHeaders(secure, refreshed));
      }
      return res.status(200).json({ inspectYahoo: true, ...inspect });
    }

    // Yahoo-native weekly sync: scoreboard team_points + roster player_points/projections.
    // Parsing uses findYahooKey (lib/yahooFantasy.js) — never hardcoded player[N][M] paths.
    // Sleeper pts_ppr is NOT used here — the client may fall back only when yahooStatsOk is false.
    const leagues = await importYahooLeagues(accessToken, { week });
    if (refreshed?.access_token) {
      res.setHeader('Set-Cookie', yahooTokenSetCookieHeaders(secure, refreshed));
    }

    return res.status(200).json({
      leagues,
      count: leagues.length,
      week: week || leagues[0]?.lineupWeek || null,
      scoringSource: 'yahoo'
    });
  } catch (err) {
    console.error('Sync failure:', err);
    const status = err?.status && Number.isFinite(Number(err.status)) ? Number(err.status) : 500;
    return res.status(status).json({
      error: err?.message || 'Internal sync failure',
      details: err?.message
    });
  }
}
