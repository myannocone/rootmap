export default function handler(req, res) {
  const rawClientId = process.env.YAHOO_CLIENT_ID || '';
  const clientId = rawClientId.trim();
  const rawRedirectUri = process.env.YAHOO_REDIRECT_URI || '';
  const redirectUri = rawRedirectUri.trim() || 'https://rootmap-wine.vercel.app/api/auth/callback';

  if (!clientId) {
    return res.status(500).json({ error: 'YAHOO_CLIENT_ID environment variable not set' });
  }

  const yahooAuthUrl = `https://api.login.yahoo.com/oauth2/request_auth?client_id=${encodeURIComponent(
    clientId
  )}&redirect_uri=${encodeURIComponent(
    redirectUri
  )}&response_type=code&language=en-us`;

  res.redirect(302, yahooAuthUrl);
}
