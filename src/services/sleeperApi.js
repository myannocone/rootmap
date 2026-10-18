/**
 * Sleeper API Service
 * Fetches user leagues, rosters, NFL player directory, and derives active player roots.
 */

const SLEEPER_BASE_URL = 'https://api.sleeper.app/v1';

/**
 * Returns the Sleeper CDN headshot image URL for any NFL player ID
 */
export function getPlayerHeadshotUrl(playerId) {
  if (!playerId) return null;
  return `https://sleepercdn.com/content/nfl/players/thumb/${playerId}.jpg`;
}

/**
 * Fetches the entire NFL player directory from Sleeper (cached in sessionStorage)
 */
export async function getSleeperPlayerDirectory() {
  try {
    const cached = sessionStorage.getItem('sleeper_nfl_players');
    if (cached) {
      return JSON.parse(cached);
    }

    const res = await fetch(`${SLEEPER_BASE_URL}/players/nfl`);
    if (!res.ok) throw new Error('Failed to fetch Sleeper players');
    const players = await res.json();

    try {
      sessionStorage.setItem('sleeper_nfl_players', JSON.stringify(players));
    } catch (e) {
      // Storage quota fallback
    }

    return players;
  } catch (err) {
    console.error('Error fetching Sleeper player directory:', err);
    return {};
  }
}

/**
 * Fetches all user leagues and active rosters for a given Sleeper username
 */
export async function fetchUserLeagues(username, season = '2024') {
  try {
    const userRes = await fetch(`${SLEEPER_BASE_URL}/user/${username}`);
    if (!userRes.ok) throw new Error('Sleeper user not found');
    const userData = await userRes.json();
    const userId = userData.user_id;

    const leaguesRes = await fetch(`${SLEEPER_BASE_URL}/user/${userId}/leagues/nfl/${season}`);
    if (!leaguesRes.ok) throw new Error('Could not fetch leagues');
    const leagues = await leaguesRes.json();

    const leaguePromises = leagues.slice(0, 10).map(async (lg) => {
      try {
        const rostersRes = await fetch(`${SLEEPER_BASE_URL}/league/${lg.league_id}/rosters`);
        const rosters = await rostersRes.json();
        const userRoster = rosters.find(r => r.owner_id === userId);

        return {
          id: lg.league_id,
          name: lg.name,
          platform: 'Sleeper',
          starters: userRoster?.starters || [],
          players: userRoster?.players || [],
          userPoints: userRoster?.settings?.fpts || 0,
          oppPoints: 0,
          opponentName: 'League Opponent'
        };
      } catch {
        return {
          id: lg.league_id,
          name: lg.name,
          platform: 'Sleeper',
          starters: [],
          players: [],
          userPoints: 0,
          oppPoints: 0,
          opponentName: 'League Opponent'
        };
      }
    });

    return await Promise.all(leaguePromises);
  } catch (err) {
    console.error('fetchUserLeagues error:', err);
    throw err;
  }
}

/**
 * Alias exported for ConnectModal compatibility
 */
export const importSleeperPortfolio = fetchUserLeagues;

/**
 * Derives aggregated player roots and shares across multiple Sleeper leagues
 */
export function buildRootsFromSleeper(sleeperLeagues, playerDirectory = {}) {
  const playerMap = new Map();

  sleeperLeagues.forEach(league => {
    (league.starters || []).forEach(playerId => {
      if (!playerId || playerId === '0') return;

      const playerMeta = playerDirectory[playerId] || {};
      const fullName = playerMeta.full_name || `${playerMeta.first_name || ''} ${playerMeta.last_name || ''}`.trim() || `Player ${playerId}`;

      if (!playerMap.has(playerId)) {
        playerMap.set(playerId, {
          id: playerId,
          name: fullName,
          position: playerMeta.position || 'FB',
          nflTeam: playerMeta.team || 'NFL',
          shares: 0,
          leagues: []
        });
      }

      const p = playerMap.get(playerId);
      p.shares += 1;
      p.leagues.push({
        leagueName: league.name,
        type: 'ROSTERED',
        weight: 1.0
      });
    });
  });

  return Array.from(playerMap.values());
}