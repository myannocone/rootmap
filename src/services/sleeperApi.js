const BASE_URL = 'https://api.sleeper.app/v1';

/**
 * Fetch Sleeper User details by username
 */
export async function getSleeperUser(username) {
  const res = await fetch(`${BASE_URL}/user/${encodeURIComponent(username.trim())}`);
  if (!res.ok) throw new Error('User not found on Sleeper');
  return res.json();
}

/**
 * Fetch all leagues for a user for a given season (default: 2026)
 */
export async function getSleeperLeagues(userId, season = '2026') {
  const res = await fetch(`${BASE_URL}/user/${userId}/leagues/nfl/${season}`);
  if (!res.ok) throw new Error('Failed to fetch user leagues');
  return res.json();
}

/**
 * Fetch current NFL state (determines current active week)
 */
export async function getNflState() {
  const res = await fetch(`${BASE_URL}/state/nfl`);
  if (!res.ok) throw new Error('Failed to fetch NFL week state');
  return res.json();
}

/**
 * Fetch matchups and scores for a specific league and week
 */
export async function getLeagueMatchups(leagueId, week = 1) {
  const res = await fetch(`${BASE_URL}/league/${leagueId}/matchups/${week}`);
  if (!res.ok) throw new Error('Failed to fetch league matchups');
  return res.json();
}

/**
 * Ingests a Sleeper username, finds their leagues, and formats them for RootMap's Linked Leagues tab
 */
export async function importSleeperPortfolio(username) {
  const user = await getSleeperUser(username);
  const nflState = await getNflState().catch(() => ({ week: 1 }));
  const currentWeek = nflState.week || 1;
  const userLeagues = await getSleeperLeagues(user.user_id, '2026');

  if (!userLeagues || userLeagues.length === 0) {
    return [];
  }

  const leaguePromises = userLeagues.slice(0, 5).map(async (lg) => {
    try {
      const matchups = await getLeagueMatchups(lg.league_id, currentWeek);
      
      // Matchup objects have a roster_id and matchup_id
      // Find the user's matchup or fallback cleanly
      const myMatchup = matchups[0] || {};
      const oppMatchup = matchups.find(m => m.matchup_id === myMatchup.matchup_id && m.roster_id !== myMatchup.roster_id) || matchups[1] || {};

      return {
        id: `sleeper_${lg.league_id}`,
        name: lg.name || 'Sleeper League',
        platform: 'Sleeper',
        myTeam: user.display_name || 'My Roster',
        oppTeam: 'Opponent',
        myScore: myMatchup.points || 0.0,
        oppScore: oppMatchup.points || 0.0,
        status: `Week ${currentWeek} • Active`,
        starters: myMatchup.starters || []
      };
    } catch {
      return {
        id: `sleeper_${lg.league_id}`,
        name: lg.name || 'Sleeper League',
        platform: 'Sleeper',
        myTeam: user.display_name || 'My Roster',
        oppTeam: 'Opponent',
        myScore: 0.0,
        oppScore: 0.0,
        status: `Week ${currentWeek} • Synced`,
        starters: []
      };
    }
  });

  return Promise.all(leaguePromises);
}