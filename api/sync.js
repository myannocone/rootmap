export default async function handler(req, res) {
  const authHeader = req.headers.authorization;

  if (!authHeader) {
    return res.status(401).json({ error: 'Missing Authorization header' });
  }

  try {
    // Query fantasy leagues for current logged-in user
    const response = await fetch(
      'https://fantasysports.yahooapis.com/fantasy/v2/users;use_login=1/games;game_keys=nfl/leagues?format=json',
      {
        headers: {
          'Authorization': authHeader,
          'Accept': 'application/json'
        }
      }
    );

    const text = await response.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      data = { rawText: text };
    }

    if (!response.ok) {
      return res.status(response.status).json({
        error: 'Yahoo Leagues Fetch Error',
        status: response.status,
        details: data
      });
    }

    return res.status(200).json({ raw: data });
  } catch (err) {
    console.error('Sync failure:', err);
    return res.status(500).json({ error: 'Internal sync failure', details: err.message });
  }
}
