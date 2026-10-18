export default function handler(req, res) {
    const clientId = process.env.YAHOO_CLIENT_ID;
    const redirectUri = encodeURIComponent(`${process.env.APP_URL || 'https://rootmap.vercel.app'}/api/auth/yahoo/callback`);
  
    if (!clientId) {
      return res.status(500).json({ error: 'Missing YAHOO_CLIENT_ID' });
    }
  
    const yahooAuthUrl = `https://api.login.yahoo.com/oauth2/request_auth?client_id=${clientId}&redirect_uri=${redirectUri}&response_type=code&language=en-us`;
  
    res.redirect(302, yahooAuthUrl);
  }