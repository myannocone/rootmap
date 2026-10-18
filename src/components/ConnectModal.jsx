/**
 * Yahoo Fantasy Sports Roster Sync Service
 * Queries Yahoo Fantasy API for active user leagues and rostered starters.
 */

export default async function handler(req, res) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing or malformed Authorization token' });
  }

  const token = authHeader.split(' ')[1];

  try {
    // 1. Fetch current user's active NFL leagues
    const leaguesUrl = 'https://fantasysports.yahooapis.com/fantasy/v2/users;use_login=1/games;game_keys=nfl/leagues?format=json';
    const leaguesRes = await fetch(leaguesUrl, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/json'
      }
    });

    if (!leaguesRes.ok) {
      const errBody = await leaguesRes.text();
      console.error('Yahoo leagues API error:', errBody);
      return res.status(leaguesRes.status).json({ error: 'Failed to fetch Yahoo leagues', details: errBody });
    }

    const data = await leaguesRes.json();
    
    // Parse Yahoo's JSON structure safely
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
            starters: [] // Populated during active game week
          });
        }
      }
    }

    return res.status(200).json({ leagues: leaguesList });
  } catch (err) {
    console.error('Error fetching Yahoo data:', err);
    return res.status(500).json({ error: 'Internal Server Error', message: err.message });
  }
}