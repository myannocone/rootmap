export default async function handler(req, res) {
  const authHeader = req.headers.authorization;

  if (!authHeader) {
    return res.status(401).json({ error: 'Missing Authorization header' });
  }

  try {
    const gamesResponse = await fetch(
      'https://fantasysports.yahooapis.com/fantasy/v2/users;use_login=1/games;game_keys=nfl?format=json',
      {
        headers: {
          'Authorization': authHeader.startsWith('Bearer ') ? authHeader : `Bearer ${authHeader}`,
          'Accept': 'application/json'
        }
      }
    );

    const gamesText = await gamesResponse.text();
    let gamesData;
    try {
      gamesData = JSON.parse(gamesText);
    } catch {
      gamesData = { rawText: gamesText };
    }

    if (!gamesResponse.ok) {
      return res.status(gamesResponse.status).json({
        error: 'Yahoo Games Fetch Error',
        status: gamesResponse.status,
        details: gamesData
      });
    }

    // Query active user leagues
    const leaguesResponse = await fetch(
      'https://fantasysports.yahooapis.com/fantasy/v2/users;use_login=1/games;game_keys=nfl/leagues?format=json',
      {
        headers: {
          'Authorization': authHeader.startsWith('Bearer ') ? authHeader : `Bearer ${authHeader}`,
          'Accept': 'application/json'
        }
      }
    );

    const leaguesText = await leaguesResponse.text();
    let leaguesData;
    try {
      leaguesData = JSON.parse(leaguesText);
    } catch {
      leaguesData = { rawText: leaguesText };
    }

    return res.status(200).json({
      games: gamesData,
      leagues: leaguesData
    });
  } catch (err) {
    console.error('Sync failure:', err);
    return res.status(500).json({ error: 'Internal sync failure', details: err.message });
  }
}
