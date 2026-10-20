export default async function handler(req, res) {
  const authHeader = req.headers.authorization;

  if (!authHeader) {
    return res.status(401).json({ error: 'Missing Authorization header' });
  }

  try {
    const leaguesRes = await fetch(
      'https://fantasysports.yahooapis.com/fantasy/v2/users;use_login=1/games;game_keys=nfl/leagues?format=json',
      {
        headers: { Authorization: authHeader }
      }
    );

    if (!leaguesRes.ok) {
      const errText = await leaguesRes.text();
      return res.status(leaguesRes.status).json({ error: 'Yahoo API Error', details: errText });
    }

    const leaguesData = await leaguesRes.json();
    return res.status(200).json(leaguesData);
  } catch (err) {
    console.error('Sync error:', err);
    return res.status(500).json({ error: 'Failed to fetch league data from Yahoo' });
  }
}
