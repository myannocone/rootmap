const REDIRECT_URI = 'https://rootmap-wine.vercel.app/api/auth/callback';

export default function handler(req, res) {
  const rawClientId = process.env.YAHOO_CLIENT_ID || '';
  const clientId = rawClientId.trim();

  if (!clientId) {
    return res.status(500).json({ error: 'YAHOO_CLIENT_ID environment variable not set' });
  }

  // Request fspt-r scope so token is authorized to read Fantasy Sports data
  const yahooAuthUrl = `https://api.login.yahoo.com/oauth2/request_auth?client_id=${encodeURIComponent(
    clientId
  )}&redirect_uri=${encodeURIComponent(
    REDIRECT_URI
  )}&response_type=code&scope=fspt-r&language=en-us`;

  res.redirect(302, yahooAuthUrl);
}
