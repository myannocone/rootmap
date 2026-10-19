export default async function handler(req, res) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.statusCode = 401;
    res.setHeader('Content-Type', 'application/json');
    return res.end(JSON.stringify({ error: 'Missing or malformed Authorization token' }));
  }

  const token = authHeader.split(' ')[1];

  try {
    const url = 'https://fantasysports.yahooapis.com/fantasy/v2/users;use_login=1/games;game_keys=nfl/teams/roster?format=json';
    const response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/json'
      }
    });

    const rawText = await response.text();
    let leaguesList = [];

    try {
      const data = JSON.parse(rawText);
      const users = data?.fantasy_content?.users?.[0]?.user;
      const games = users?.find(u => u?.games)?.games;
      const nfl = games?.[0]?.game?.[1]?.teams;

      if (nfl && typeof nfl === 'object') {
        const count = nfl.count || 0;
        for (let i = 0; i < count; i++) {
          const teamData = nfl[i]?.team;
          if (!teamData) continue;
          
          const meta = teamData[0] || [];
          const rosterBlock = teamData[1]?.roster?.[0]?.players;

          let teamName = 'My Team';
          let teamKey = '';
          for (const item of meta) {
            if (item?.name) teamName = item.name;
            if (item?.team_key) teamKey = item.team_key;
          }

          // Extract actual league key (e.g., 449.l.12345 from 449.l.12345.t.1)
          const leagueKey = teamKey.split('.t.')[0] || teamKey;

          // Parse rostered players
          const starters = [];
          if (rosterBlock && typeof rosterBlock === 'object') {
            const pCount = rosterBlock.count || 0;
            for (let p = 0; p < pCount; p++) {
              const pInfo = rosterBlock[p]?.player?.[0];
              const pPos = rosterBlock[p]?.player?.[1]?.selected_position?.[1]?.position;
              if (pInfo) {
                let pName = 'Unknown Player';
                let nflTeam = 'NFL';
                let pos = 'UTIL';
                for (const field of pInfo) {
                  if (field?.name?.full) pName = field.name.full;
                  if (field?.editorial_team_abbr) nflTeam = field.editorial_team_abbr.toUpperCase();
                  if (field?.display_position) pos = field.display_position;
                }
                starters.push({
                  name: pName,
                  nflTeam,
                  position: pos,
                  slot: pPos || pos,
                  isStarter: pPos !== 'BN' && pPos !== 'IR'
                });
              }
            }
          }

          leaguesList.push({
            id: leagueKey,
            teamKey: teamKey,
            name: teamName,
            leagueName: teamName, // will refine with league title query
            numTeams: 12,
            platform: 'Yahoo',
            starters: starters
          });
        }
      }
    } catch (e) {
      console.warn('JSON parse error:', e);
    }

    // Fallback extraction if count structure differs
    if (leaguesList.length === 0) {
      const teamMatches = rawText.matchAll(/<team_key>([^<]+)<\/team_key>[\s\S]*?<name>([^<]+)<\/name>/g);
      for (const m of teamMatches) {
        leaguesList.push({
          id: m[1].split('.t.')[0] || m[1],
          name: m[2],
          leagueName: m[2],
          numTeams: 12,
          platform: 'Yahoo',
          starters: []
        });
      }
    }

    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json');
    return res.end(JSON.stringify({ success: true, leagues: leaguesList }));
  } catch (err) {
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json');
    return res.end(JSON.stringify({ error: err.message }));
  }
}
