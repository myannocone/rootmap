const REDIRECT_URI = 'https://rootmap-wine.vercel.app/api/auth/callback';

export default function handler(req, res) {
  const rawClientId = process.env.YAHOO_CLIENT_ID || '';
  const clientId = rawClientId.trim();

  if (!clientId) {
    return res.status(500).json({ error: 'YAHOO_CLIENT_ID is not set in Vercel environment variables' });
  }

  const authUrl = `https://api.login.yahoo.com/oauth2/request_auth?client_id=${clientId}&redirect_uri=${encodeURIComponent(
    REDIRECT_URI
  )}&response_type=code&language=en-us`;

  // Return clean debug output so we can verify the link directly
  res.setHeader('Content-Type', 'text/html');
  return res.status(200).send(`
    <!DOCTYPE html>
    <html style="background:#020617;color:#f8fafc;font-family:sans-serif;padding:30px;">
      <body>
        <h3 style="color:#38bdf8;">RootMap OAuth Inspector</h3>
        <p><strong>Configured Client ID:</strong> <code>${clientId}</code></p>
        <p><strong>Configured Redirect URI:</strong> <code>${REDIRECT_URI}</code></p>
        <div style="margin-top:20px;">
          <a href="${authUrl}" style="background:#7c3aed;color:#fff;padding:12px 20px;border-radius:10px;text-decoration:none;font-weight:bold;display:inline-block;">
            Launch Yahoo Auth Directly
          </a>
        </div>
      </body>
    </html>
  `);
}
