export default async function handler(req, res) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.statusCode = 401;
    res.setHeader('Content-Type', 'application/json');
    return res.end(JSON.stringify({ error: 'Missing or malformed Authorization token' }));
  }

  const token = authHeader.split(' ')[1];

  try {
    // Primary: fetch leagues directly via game_keys=nfl
    const targetUrl = 'https://fantasysports.yahooapis.com/fantasy/v2/users;use_login=1/games;game_keys=nfl/leagues?format=json';
    
    let response = await fetch(targetUrl, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/json'
      }
    });

    let rawText = await response.text();
    let status = response.status;
    let usedUrl = targetUrl;

    // Fallback if use_login=1 games returned 403: query teams directly
    if (status === 403) {
      const fallbackUrl = 'https://fantasysports.yahooapis.com/fantasy/v2/users;use_login=1/teams?format=json';
      const fallbackRes = await fetch(fallbackUrl, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Accept': 'application/json'
        }
      });
      if (fallbackRes.ok) {
        status = fallbackRes.status;
        rawText = await fallbackRes.text();
        usedUrl = fallbackUrl;
      }
    }

    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json');
    return res.end(JSON.stringify({
      debug: true,
      httpStatus: status,
      targetUrl: usedUrl,
      rawLength: rawText.length,
      rawPayload: rawText
    }));
  } catch (err) {
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json');
    return res.end(JSON.stringify({ error: 'Endpoint failure', message: err.message }));
  }
}
