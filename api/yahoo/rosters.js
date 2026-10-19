export default async function handler(req, res) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.statusCode = 401;
    res.setHeader('Content-Type', 'application/json');
    return res.end(JSON.stringify({ error: 'Missing or malformed Authorization token' }));
  }

  const token = authHeader.split(' ')[1];

  try {
    const leaguesUrl = 'https://fantasysports.yahooapis.com/fantasy/v2/users;use_login=1/games;game_keys=nfl/leagues?format=json';
    const leaguesRes = await fetch(leaguesUrl, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/json'
      }
    });

    if (!leaguesRes.ok) {
      const errBody = await leaguesRes.text();
      res.statusCode = leaguesRes.status;
      res.setHeader('Content-Type', 'application/json');
      return res.end(JSON.stringify({ error: 'Failed to fetch Yahoo leagues', details: errBody }));
    }

    const data = await leaguesRes.json();
    const users = data?.fantasy_content?.users?.[0]?.user;
    const games = users?.find(u => u?.games)?.games;
    const nflGame = games?.[0]?.game?.[1]?.leagues;

    const leaguesList = [];

    if (nflGame && typeof nflGame === 'object') {
      const count = nflGame.count || 0;
      for (let i = 0; i < count; i++) {
        const lgData = nflGame[i]?.league?.[0];
        if (lgData) {
          leaguesList.push({
            id: lgData.league_key,
            name: lgData.name,
            season: lgData.season,
            numTeams: lgData.num_teams,
            platform: 'Yahoo',
            starters: []
          });
        }
      }
    }

    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json');
    return res.end(JSON.stringify({ leagues: leaguesList }));
  } catch (err) {
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json');
    return res.end(JSON.stringify({ error: 'Internal Server Error', message: err.message }));
  }
}
