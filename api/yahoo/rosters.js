export default async function handler(req, res) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.statusCode = 401;
    res.setHeader('Content-Type', 'application/json');
    return res.end(JSON.stringify({ error: 'Missing or malformed Authorization token' }));
  }

  const token = authHeader.split(' ')[1];

  try {
    // Direct endpoint targeting user's active NFL teams
    const url = 'https://fantasysports.yahooapis.com/fantasy/v2/users;use_login=1/games;game_keys=nfl/teams?format=json';
    const response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/json'
      }
    });

    const rawText = await response.text();
    let leagues = [];

    // Attempt standard JSON parsing
    try {
      const data = JSON.parse(rawText);
      const walk = (obj) => {
        if (!obj || typeof obj !== 'object') return;
        if (obj.league_key && (obj.name || obj.league_id)) {
          leagues.push({
            id: String(obj.league_key),
            name: String(obj.name || `League ${obj.league_key}`),
            season: '2026',
            numTeams: 12,
            platform: 'Yahoo',
            starters: []
          });
        }
        if (obj.team_key && typeof obj.team_key === 'string') {
          const lKey = obj.team_key.split('.t.')[0];
          leagues.push({
            id: lKey,
            name: String(Array.isArray(obj.name) ? obj.name[0] : (obj.name || 'Yahoo Team')),
            season: '2026',
            numTeams: 12,
            platform: 'Yahoo',
            starters: []
          });
        }
        if (Array.isArray(obj)) {
          for (const item of obj) walk(item);
        } else {
          for (const k of Object.keys(obj)) walk(obj[k]);
        }
      };
      walk(data);
    } catch (parseErr) {
      // Regex extraction fallback if Yahoo returned XML or unconventional JSON strings
      const leagueMatches = rawText.matchAll(/<league_key>([^<]+)<\/league_key>[\s\S]*?<name>([^<]+)<\/name>/g);
      for (const match of leagueMatches) {
        leagues.push({
          id: match[1],
          name: match[2],
          season: '2026',
          numTeams: 12,
          platform: 'Yahoo',
          starters: []
        });
      }
    }

    // Deduplicate
    const uniqueMap = new Map();
    for (const lg of leagues) {
      if (!uniqueMap.has(lg.id)) uniqueMap.set(lg.id, lg);
    }

    const finalLeagues = Array.from(uniqueMap.values());

    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json');
    return res.end(JSON.stringify({
      success: true,
      leagues: finalLeagues,
      rawSnippet: rawText.slice(0, 300)
    }));
  } catch (err) {
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json');
    return res.end(JSON.stringify({ error: err.message }));
  }
}
