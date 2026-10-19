export default async function handler(req, res) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.statusCode = 401;
    res.setHeader('Content-Type', 'application/json');
    return res.end(JSON.stringify({ error: 'Missing or malformed Authorization token' }));
  }

  const token = authHeader.split(' ')[1];

  try {
    // 1. Get the current active NFL game key for the user
    const gamesUrl = 'https://fantasysports.yahooapis.com/fantasy/v2/users;use_login=1/games?format=json';
    const gamesRes = await fetch(gamesUrl, {
      headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/json' }
    });

    let activeGameKeys = [];
    if (gamesRes.ok) {
      const gamesData = await gamesRes.json();
      const users = gamesData?.fantasy_content?.users;
      const userObj = users?.[0]?.user;
      const gamesList = userObj?.find(item => item?.games)?.games;
      
      if (gamesList && typeof gamesList === 'object') {
        const count = gamesList.count || 0;
        for (let i = 0; i < count; i++) {
          const g = gamesList[i]?.game?.[0];
          if (g && (g.code === 'nfl' || g.type === 'full')) {
            activeGameKeys.push(g.game_key);
          }
        }
      }
    }

    // Default to NFL code if none explicitly parsed
    if (activeGameKeys.length === 0) {
      activeGameKeys = ['nfl'];
    }

    const leaguesList = [];

    // 2. Fetch user leagues and teams for each active key
    for (const gKey of activeGameKeys) {
      const url = `https://fantasysports.yahooapis.com/fantasy/v2/users;use_login=1/games;game_keys=${gKey}/leagues/teams?format=json`;
      const r = await fetch(url, {
        headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/json' }
      });

      if (r.ok) {
        const payload = await r.json();
        
        function parsePayload(node) {
          if (!node || typeof node !== 'object') return;

          if (node.league_key && node.name) {
            leaguesList.push({
              id: String(node.league_key),
              name: String(node.name),
              season: String(node.season || '2026'),
              numTeams: parseInt(node.num_teams || 12, 10),
              platform: 'Yahoo',
              starters: []
            });
          }

          if (Array.isArray(node)) {
            for (const item of node) parsePayload(item);
          } else {
            for (const k of Object.keys(node)) parsePayload(node[k]);
          }
        }

        parsePayload(payload);
      }
    }

    // Deduplicate leagues by id
    const unique = [];
    const seen = new Set();
    for (const lg of leaguesList) {
      if (!seen.has(lg.id)) {
        seen.add(lg.id);
        unique.push(lg);
      }
    }

    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json');
    return res.end(JSON.stringify({ 
      success: true, 
      count: unique.length, 
      leagues: unique 
    }));
  } catch (err) {
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json');
    return res.end(JSON.stringify({ error: 'Server error parsing Yahoo response', message: err.message }));
  }
}
