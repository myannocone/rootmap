export default async function handler(req, res) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.statusCode = 401;
    res.setHeader('Content-Type', 'application/json');
    return res.end(JSON.stringify({ error: 'Missing or malformed Authorization token' }));
  }

  const token = authHeader.split(' ')[1];

  try {
    // Primary query using game_codes=nfl
    let leaguesUrl = 'https://fantasysports.yahooapis.com/fantasy/v2/users;use_login=1/games;game_codes=nfl/leagues?format=json';
    let leaguesRes = await fetch(leaguesUrl, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/json'
      }
    });

    let rawText = await leaguesRes.text();

    // If game_codes returned empty or error, fallback to general fantasy games query
    if (!leaguesRes.ok || rawText.includes('"count":0') || rawText.includes('"count": 0')) {
      const fallbackUrl = 'https://fantasysports.yahooapis.com/fantasy/v2/users;use_login=1/games/leagues?format=json';
      const fallbackRes = await fetch(fallbackUrl, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Accept': 'application/json'
        }
      });
      if (fallbackRes.ok) {
        rawText = await fallbackRes.text();
      }
    }

    let data;
    try {
      data = JSON.parse(rawText);
    } catch (e) {
      res.statusCode = 502;
      res.setHeader('Content-Type', 'application/json');
      return res.end(JSON.stringify({ error: 'Invalid JSON from Yahoo', details: rawText }));
    }

    const leaguesList = [];

    // Deep recursive extractor for any object containing league metadata
    function extractLeagues(node) {
      if (!node || typeof node !== 'object') return;

      if (node.league_key && node.name) {
        leaguesList.push({
          id: String(node.league_key),
          name: String(node.name),
          season: node.season ? String(node.season) : '2026',
          numTeams: node.num_teams || 10,
          platform: 'Yahoo',
          starters: []
        });
        return;
      }

      if (Array.isArray(node)) {
        for (const item of node) {
          extractLeagues(item);
        }
      } else {
        for (const key of Object.keys(node)) {
          extractLeagues(node[key]);
        }
      }
    }

    extractLeagues(data);

    // Filter duplicates by league ID
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
    return res.end(JSON.stringify({ error: 'Server error parsing Yahoo rosters', message: err.message }));
  }
}
