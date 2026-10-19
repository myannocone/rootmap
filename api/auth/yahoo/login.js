export default function handler(req, res) {
  try {
    const clientId = process.env.YAHOO_CLIENT_ID;
    const appUrl = process.env.APP_URL || 'https://rootmap-wine.vercel.app';
    const redirectUri = encodeURIComponent(`${appUrl}/api/auth/yahoo/callback`);

    if (!clientId) {
      res.statusCode = 500;
      res.setHeader('Content-Type', 'application/json');
      return res.end(JSON.stringify({ error: 'Missing YAHOO_CLIENT_ID in Vercel environment variables' }));
    }

    const yahooAuthUrl = `https://api.login.yahoo.com/oauth2/request_auth?client_id=${clientId}&redirect_uri=${redirectUri}&response_type=code&language=en-us`;

    res.writeHead(302, { Location: yahooAuthUrl });
    return res.end();
  } catch (err) {
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json');
    return res.end(JSON.stringify({ error: 'OAuth initialization error', details: err.message }));
  }
}
