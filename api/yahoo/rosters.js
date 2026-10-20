export default async function handler(req, res) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.statusCode = 401;
    res.setHeader('Content-Type', 'application/json');
    return res.end(JSON.stringify({ error: 'Missing or malformed Authorization token' }));
  }

  const token = authHeader.split(' ')[1];

  try {
    // Primary query to get user teams and active fantasy leagues
    const targetUrl = 'https://fantasysports.yahooapis.com/fantasy/v2/users;use_login=1/games;game_keys=nfl/teams?format=json';
    
    const response = await fetch(targetUrl, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/json'
      }
    });

    const status = response.status;
    const contentType = response.headers.get('content-type') || 'unknown';
    const rawText = await response.text();

    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json');
    return res.end(JSON.stringify({
      debug: true,
      httpStatus: status,
      contentType: contentType,
      targetUrl: targetUrl,
      rawLength: rawText.length,
      rawPayload: rawText
    }));
  } catch (err) {
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json');
    return res.end(JSON.stringify({ error: 'Endpoint failure', message: err.message }));
  }
}
