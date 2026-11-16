import {
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

function wantsInspectYahoo(req) {
  const value = req.query?.inspectYahoo ?? req.query?.inspect;
  return value === '1' || value === 'true' || value === 'yes';
}

function weekFrom(req) {
  const week = Number(req.query?.week);
  return week >= 1 && week <= 18 ? week : undefined;
}

export default async function handler(req, res) {
  const clientId = process.env.YAHOO_CLIENT_ID || 'NOT_SET';
  const redirectUri = process.env.YAHOO_REDIRECT_URI || 'NOT_SET';

  // Mask the middle of the ID for privacy but show prefix/suffix/length
  const preview = clientId.length > 8
    ? `${clientId.substring(0, 6)}...${clientId.substring(clientId.length - 4)} (length: ${clientId.length})`
    : clientId;

  const base = {
    hasClientId: clientId !== 'NOT_SET',
    clientPreview: preview,
    redirectUri
  };

  if (!wantsInspectYahoo(req)) {
    return res.status(200).json(base);
  }

  const secure = requestIsSecure(req);
  const bearer = bearerFrom(req);
  const week = weekFrom(req);

  try {
    let accessToken = bearer;
    let refreshed = null;
    if (!accessToken) {
      const resolved = await resolveYahooAccessToken(req, { forceRefresh: true });
      accessToken = resolved.accessToken;
      refreshed = resolved.tokenData;
    } else {
      try {
        const resolved = await resolveYahooAccessToken(req, { forceRefresh: true });
        if (resolved?.accessToken) {
          accessToken = resolved.accessToken;
          refreshed = resolved.tokenData;
        }
      } catch {
        // keep bearer
      }
    }

    if (!accessToken) {
      return res.status(401).json({
        ...base,
        error: 'Missing Yahoo access token. Connect Yahoo again, then retry /api/debug?inspectYahoo=1'
      });
    }

    const inspect = await inspectYahooPayload(accessToken, { week });
    if (refreshed?.access_token) {
      res.setHeader('Set-Cookie', yahooTokenSetCookieHeaders(secure, refreshed));
    }
    return res.status(200).json({
      ...base,
      inspectYahoo: true,
      ...inspect
    });
  } catch (err) {
    const status = err?.status && Number.isFinite(Number(err.status)) ? Number(err.status) : 500;
    return res.status(status).json({
      ...base,
      error: err?.message || 'Yahoo inspect failed',
      details: err?.message
    });
  }
}
