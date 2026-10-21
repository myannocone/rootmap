export default async function handler(req, res) {
  const authHeader = req.headers.authorization;

  if (!authHeader) {
    return res.status(401).json({ error: 'Missing Authorization header' });
  }

  try {
    // 1. Fetch user games & leagues
    const userLeaguesRes = await fetch(
      'https://fantasysports.yahooapis.com/fantasy/v2/users;use_login=1/games;game_keys=nfl/leagues?format=json',
      { headers: { Authorization: authHeader } }
    );

    if (!userLeaguesRes.ok) {
      const errText = await userLeaguesRes.text();
      return res.status(userLeaguesRes.status).json({ error: 'Yahoo Leagues Fetch Error', details: errText });
    }

    const leaguesJson = await userLeaguesRes.json();
    const gamesData = leaguesJson?.fantasy_content?.users?.[0]?.user?.[1]?.games;
    
    if (!gamesData || gamesData.count === 0) {
      return res.status(200).json({ leagues: [] });
    }

    // Extract active NFL leagues
    const nflGame = gamesData[0]?.game;
    const rawLeagues = nflGame?.[1]?.leagues;
    const parsedLeagues = [];

    if (rawLeagues && rawLeagues.count > 0) {
      for (let i = 0; i < rawLeagues.count; i++) {
        const lObj = rawLeagues[i]?.league?.[0];
        if (lObj) {
          parsedLeagues.push({
            leagueKey: lObj.league_key,
            name: lObj.name,
            numTeams: lObj.num_teams,
            season: lObj.season
          });
        }
      }
    }

    // 2. Fetch rosters & matchups for each league
    const fullLeaguesData = await Promise.all(
      parsedLeagues.map(async (lg) => {
        try {
          const teamRes = await fetch(
            `https://fantasysports.yahooapis.com/fantasy/v2/league/${lg.leagueKey}/teams;use_login=1/roster/players?format=json`,
            { headers: { Authorization: authHeader } }
          );
          if (!teamRes.ok) return lg;
          const teamJson = await teamRes.json();

          const teamsWrapper = teamJson?.fantasy_content?.league?.[1]?.teams;
          const userTeamData = teamsWrapper?.[0]?.team;
          const teamName = userTeamData?.[0]?.[2]?.name || 'My Team';
          const rawPlayers = userTeamData?.[1]?.roster?.['0']?.players;

          const starters = [];
          if (rawPlayers && rawPlayers.count > 0) {
            for (let pIdx = 0; pIdx < rawPlayers.count; pIdx++) {
              const pData = rawPlayers[pIdx]?.player?.[0];
              const pMeta = rawPlayers[pIdx]?.player?.[1];

              const name = pData?.find(item => item?.name)?.name?.full;
              const nflTeam = pData?.find(item => item?.editorial_team_abbr)?.editorial_team_abbr?.toUpperCase();
              const position = pData?.find(item => item?.display_position)?.display_position;
              const selectedPos = pMeta?.selected_position?.[1]?.position;

              // Only include starting roster spots (ignore BN / Bench)
              if (selectedPos && selectedPos !== 'BN' && selectedPos !== 'IR') {
                starters.push({
                  name: name || 'Unknown Player',
                  nflTeam: nflTeam || 'NFL',
                  position: position || selectedPos,
                  slot: selectedPos,
                  points: 0.0,
                  isLive: false,
                  inRedZone: false,
                  gameClock: 'Scheduled',
                  bigPlay: null
                });
              }
            }
          }

          return {
            id: lg.leagueKey,
            name: lg.name,
            opponent: 'Opponent',
            platform: 'Yahoo',
            season: lg.season,
            myScore: 0.0,
            oppScore: 0.0,
            starters: starters,
            opponentStarters: []
          };
        } catch (e) {
          console.error(`Error loading roster for ${lg.leagueKey}:`, e);
          return lg;
        }
      })
    );

    return res.status(200).json({ leagues: fullLeaguesData });
  } catch (err) {
    console.error('Sync execution error:', err);
    return res.status(500).json({ error: 'Internal sync failure', details: err.message });
  }
}
