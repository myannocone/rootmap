export default async function handler(req, res) {
  const { code, error } = req.query;

  if (error) {
    return res.redirect(`/?auth_error=${encodeURIComponent(error)}`);
  }

  if (!code) {
    return res.redirect('/?auth_error=missing_code');
  }

  const clientId = (process.env.YAHOO_CLIENT_ID || '').trim();
  const clientSecret = (process.env.YAHOO_CLIENT_SECRET || '').trim();
  const appUrl = (process.env.APP_URL || 'https://rootmap-wine.vercel.app').trim().replace(/\/+$/, '');
  const redirectUri = `${appUrl}/api/auth/yahoo/callback`;

  try {
    const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');

    const tokenParams = new URLSearchParams();
    tokenParams.append('grant_type', 'authorization_code');
    tokenParams.append('redirect_uri', redirectUri);
    tokenParams.append('code', code);

    const tokenRes = await fetch('https://api.login.yahoo.com/oauth2/get_token', {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${basicAuth}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: tokenParams.toString()
    });

    const tokenData = await tokenRes.json();

    if (!tokenRes.ok || !tokenData.access_token) {
      const errMsg = tokenData.error_description || tokenData.error || 'Token exchange failed';
      return res.redirect(`/?auth_error=${encodeURIComponent(errMsg)}`);
    }

    // Forward the valid token back to the app
    return res.redirect(`/?yahoo_token=${encodeURIComponent(tokenData.access_token)}`);
  } catch (err) {
    return res.redirect(`/?auth_error=${encodeURIComponent(err.message)}`);
  }
}
