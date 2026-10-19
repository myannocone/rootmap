export default async function handler(req, res) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.statusCode = 401;
    res.setHeader('Content-Type', 'application/json');
    return res.end(JSON.stringify({ error: 'Missing or malformed Authorization token' }));
  }

  const token = authHeader.split(' ')[1];

  try {
    // Query teams and user leagues without restrictive nfl key filters
    const endpoints = [
      'https://fantasysports.yahooapis.com/fantasy/v2/users;use_login=1/games/teams?format=json',
      'https://fantasysports.yahooapis.com/fantasy/v2/users;use_login=1/games;game_keys=nfl/leagues?format=json',
      'https://fantasysports.yahooapis.com/fantasy/v2/users;use_login=1/leagues?format=json'
    ];

    let combinedData = [];

    for (const url of endpoints) {
      try {
        const response = await fetch(url, {
          headers: {
            'Authorization': `Bearer ${token}`,
            'Accept': 'application/json'
          }
        });
        if (response.ok) {
          const json = await response.json();
          combinedData.push(json);
        }
      } catch (e) {
        // Continue to fallback endpoints
      }
    }

    const leaguesList = [];

    // Helper to recursively parse Yahoo's nested JSON responses
    function findLeaguesAndTeams(obj) {
      if (!obj || typeof obj !== 'object') return;

      // Match league objects
      if (obj.league_key && (obj.name || obj.league_id)) {
        leaguesList.push({
          id: String(obj.league_key),
          name: String(obj.name || `League ${obj.league_key}`),
          season: String(obj.season || '2026'),
          numTeams: parseInt(obj.num_teams || 12, 10),
          platform: 'Yahoo',
          starters: []
        });
      }

      // Match team objects that contain league metadata
      if (obj.team_key && typeof obj.team_key === 'string') {
        const parts = obj.team_key.split('.t.');
        if (parts.length === 2) {
          const leagueKey = parts[0];
          const teamName = Array.isArray(obj.name) ? obj.name[0] : (obj.name || 'My Team');
          leaguesList.push({
            id: leagueKey,
            name: String(teamName),
            season: '2026',
            numTeams: 12,
            platform: 'Yahoo',
            starters: []
          });
        }
      }

      if (Array.isArray(obj)) {
        for (const item of obj) findLeaguesAndTeams(item);
      } else {
        for (const key of Object.keys(obj)) findLeaguesAndTeams(obj[key]);
      }
    }

    for (const payload of combinedData) {
      findLeaguesAndTeams(payload);
    }

    // Deduplicate leagues by unique key
    const uniqueLeagues = [];
    const seen = new Set();
    for (const lg of leaguesList) {
      if (!seen.has(lg.id)) {
        seen.add(lg.id);
        uniqueLeagues.push(lg);
      }
    }

    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json');
    return res.end(JSON.stringify({ 
      success: true, 
      count: uniqueLeagues.length, 
      leagues: uniqueLeagues,
      debugEndpointCount: combinedData.length
    }));
  } catch (err) {
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json');
    return res.end(JSON.stringify({ error: 'Server error parsing Yahoo response', message: err.message }));
  }
}
