export default async function handler(req, res) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.statusCode = 401;
    res.setHeader('Content-Type', 'application/json');
    return res.end(JSON.stringify({ error: 'Missing or malformed Authorization token' }));
  }

  const token = authHeader.split(' ')[1];

  const customHeaders = {
    'Authorization': `Bearer ${token}`,
    'Accept': 'application/json',
    'User-Agent': 'RootMapFantasy/1.0.0 (Windows NT 10.0; Win64; x64)'
  };

  try {
    // 1. Try fetching current NFL metadata & games
    const testEndpoints = [
      'https://fantasysports.yahooapis.com/fantasy/v2/users;use_login=1/games;game_keys=nfl/leagues?format=json',
      'https://fantasysports.yahooapis.com/fantasy/v2/users;use_login=1/games;game_keys=nfl/teams?format=json',
      'https://fantasysports.yahooapis.com/fantasy/v2/game/nfl?format=json'
    ];

    let result = null;
    let successfulUrl = '';

    for (const url of testEndpoints) {
      try {
        const r = await fetch(url, { headers: customHeaders });
        const text = await r.text();
        if (r.ok) {
          result = { status: r.status, url, body: text };
          successfulUrl = url;
          break;
        } else if (!result) {
          // Store first error for diagnostic review if all fail
          result = { status: r.status, url, body: text };
        }
      } catch (err) {
        // Continue to fallback endpoint
      }
    }

    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json');
    return res.end(JSON.stringify({
      debug: true,
      httpStatus: result?.status || 500,
      targetUrl: successfulUrl || result?.url,
      rawLength: result?.body?.length || 0,
      rawPayload: result?.body || 'No response body'
    }));
  } catch (err) {
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json');
    return res.end(JSON.stringify({ error: 'Endpoint failure', message: err.message }));
  }
}
