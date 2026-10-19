export default async function handler(req, res) {
  const { code, error } = req.query || {};

  if (error || !code) {
    const errParam = encodeURIComponent(String(error || 'Missing authorization code').trim());
    res.writeHead(302, { Location: `/?auth_error=${errParam}` });
    return res.end();
  }

  const rawClientId = process.env.YAHOO_CLIENT_ID || '';
  const rawClientSecret = process.env.YAHOO_CLIENT_SECRET || '';
  const rawAppUrl = process.env.APP_URL || 'https://rootmap-wine.vercel.app';

  const clientId = rawClientId.trim();
  const clientSecret = rawClientSecret.trim();
  const appUrl = rawAppUrl.trim().replace(/\/+$/, '');
  const redirectUri = `${appUrl}/api/auth/yahoo/callback`;

  try {
    const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');

    const params = new URLSearchParams({
      grant_type: 'authorization_code',
      redirect_uri: redirectUri,
      code: String(code).trim()
    });

    const tokenRes = await fetch('https://api.login.yahoo.com/oauth2/get_token', {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${basicAuth}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: params.toString()
    });

    const tokenData = await tokenRes.json();

    if (!tokenRes.ok || !tokenData.access_token) {
      console.error('Yahoo token exchange error:', tokenData);
      res.writeHead(302, { Location: '/?auth_error=token_exchange_failed' });
      return res.end();
    }

    const token = encodeURIComponent(String(tokenData.access_token).trim());
    res.writeHead(302, { Location: `/?yahoo_token=${token}` });
    return res.end();
  } catch (err) {
    console.error('OAuth callback execution error:', err);
    res.writeHead(302, { Location: '/?auth_error=server_error' });
    return res.end();
  }
}
