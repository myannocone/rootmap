export default function handler(req, res) {
  try {
    const rawClientId = process.env.YAHOO_CLIENT_ID || '';
    const rawAppUrl = process.env.APP_URL || 'https://rootmap-wine.vercel.app';

    const clientId = rawClientId.trim();
    const appUrl = rawAppUrl.trim().replace(/\/+$/, '');

    if (!clientId) {
      res.statusCode = 500;
      res.setHeader('Content-Type', 'application/json');
      return res.end(JSON.stringify({ error: 'Missing YAHOO_CLIENT_ID' }));
    }

    const redirectUri = `${appUrl}/api/auth/yahoo/callback`;

    const authUrl = new URL('https://api.login.yahoo.com/oauth2/request_auth');
    authUrl.searchParams.set('client_id', clientId);
    authUrl.searchParams.set('redirect_uri', redirectUri);
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set('scope', 'fspt-r');
    authUrl.searchParams.set('language', 'en-us');

    const cleanLocation = authUrl.toString().trim();

    res.writeHead(302, { Location: cleanLocation });
    return res.end();
  } catch (err) {
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json');
    return res.end(JSON.stringify({ error: 'OAuth init error', message: err.message }));
  }
}
