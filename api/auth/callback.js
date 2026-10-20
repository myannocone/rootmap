export default async function handler(req, res) {
  const { code } = req.query;

  if (!code) {
    return res.status(400).send('Authorization code missing from Yahoo callback.');
  }

  const clientId = process.env.YAHOO_CLIENT_ID;
  const clientSecret = process.env.YAHOO_CLIENT_SECRET;
  const redirectUri = process.env.YAHOO_REDIRECT_URI || 'https://rootmap-wine.vercel.app/api/auth/callback';

  const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');

  const params = new URLSearchParams({
    grant_type: 'authorization_code',
    redirect_uri: redirectUri,
    code: code
  });

  try {
    const tokenResponse = await fetch('https://api.login.yahoo.com/oauth2/get_token', {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${basicAuth}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: params.toString()
    });

    const data = await tokenResponse.json();

    if (data.error) {
      console.error('Yahoo Token Error:', data);
      return res.status(400).send(`Yahoo Token Error: ${data.error_description || data.error}`);
    }

    const htmlResponse = `
      <!DOCTYPE html>
      <html>
        <head><title>RootMap Yahoo Auth Complete</title></head>
        <body style="background:#020617;color:#f8fafc;font-family:sans-serif;text-align:center;padding:50px;">
          <h2>Syncing Yahoo Leagues...</h2>
          <script>
            window.opener.postMessage({
              type: 'YAHOO_AUTH_SUCCESS',
              accessToken: "${data.access_token}",
              refreshToken: "${data.refresh_token}",
              expiresIn: ${data.expires_in}
            }, window.location.origin);
            window.close();
          </script>
        </body>
      </html>
    `;

    res.setHeader('Content-Type', 'text/html');
    return res.status(200).send(htmlResponse);
  } catch (err) {
    console.error('Callback error:', err);
    return res.status(500).send('Internal server error exchanging Yahoo token.');
  }
}
