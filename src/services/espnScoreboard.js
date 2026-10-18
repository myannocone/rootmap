/**
 * ESPN Public Scoreboard Service
 * Fetches real NFL game schedules, live scores, quarter/clock status, and team matchups.
 */

const ESPN_NFL_SCOREBOARD_URL = 'https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard';

// Default marquee fantasy stars mapped by team abbreviation for instant live preview
const DEFAULT_ROSTER_MAP = {
  HOU: [
    { id: 'hou_collins', name: 'Nico Collins', position: 'WR', nflTeam: 'HOU', shares: 3, leagues: [{ leagueName: 'Main League', type: 'ROSTERED', weight: 1.0 }, { leagueName: 'Dynasty 1', type: 'ROSTERED', weight: 1.0 }] },
    { id: 'hou_mixon', name: 'Joe Mixon', position: 'RB', nflTeam: 'HOU', shares: 2, leagues: [{ leagueName: 'High Stakes', type: 'OPPONENT', weight: -1.0 }] },
    { id: 'hou_stroud', name: 'C.J. Stroud', position: 'QB', nflTeam: 'HOU', shares: 1, leagues: [{ leagueName: 'Work League', type: 'ROSTERED', weight: 1.0 }] }
  ],
  JAX: [
    { id: 'jax_etienne', name: 'Travis Etienne Jr.', position: 'RB', nflTeam: 'JAX', shares: 2, leagues: [{ leagueName: 'Main League', type: 'ROSTERED', weight: 1.0 }] },
    { id: 'jax_lawrence', name: 'Trevor Lawrence', position: 'QB', nflTeam: 'JAX', shares: 1, leagues: [{ leagueName: 'Dynasty 1', type: 'OPPONENT', weight: -1.0 }] },
    { id: 'jax_thomas', name: 'Brian Thomas Jr.', position: 'WR', nflTeam: 'JAX', shares: 2, leagues: [{ leagueName: 'Work League', type: 'ROSTERED', weight: 1.0 }] }
  ]
};

export async function fetchLiveNFLSlate() {
  try {
    const res = await fetch(ESPN_NFL_SCOREBOARD_URL);
    if (!res.ok) throw new Error(`ESPN Scoreboard fetch failed: ${res.status}`);
    const data = await res.json();

    const events = data.events || [];

    return events.map((event) => {
      const competition = event.competitions?.[0] || {};
      const competitors = competition.competitors || [];

      const homeComp = competitors.find(c => c.homeAway === 'home') || {};
      const awayComp = competitors.find(c => c.homeAway === 'away') || {};

      const homeAbbr = homeComp.team?.abbreviation || 'HOME';
      const awayAbbr = awayComp.team?.abbreviation || 'AWAY';

      const status = event.status?.type?.shortDetail || 'Upcoming';
      const isLive = event.status?.type?.state === 'in';
      const isFinal = event.status?.type?.completed || false;

      let displayTime = status;
      if (!isLive && !isFinal && competition.startDate) {
        displayTime = new Date(competition.startDate).toLocaleTimeString([], {
          hour: 'numeric',
          minute: '2-digit'
        });
      }

      // Automatically attach marquee fantasy assets if user hasn't synced custom leagues yet
      const defaultPlayers = [
        ...(DEFAULT_ROSTER_MAP[awayAbbr] || []),
        ...(DEFAULT_ROSTER_MAP[homeAbbr] || [])
      ];

      return {
        id: event.id,
        home: homeAbbr,
        away: awayAbbr,
        homeName: homeComp.team?.shortDisplayName || 'Home',
        awayName: awayComp.team?.shortDisplayName || 'Away',
        homeScore: homeComp.score || '0',
        awayScore: awayComp.score || '0',
        status: isLive ? `LIVE • ${status}` : isFinal ? 'FINAL' : 'UPCOMING',
        time: displayTime,
        isLive,
        isFinal,
        players: defaultPlayers
      };
    });
  } catch (err) {
    console.error('Failed to load live ESPN NFL slate, falling back:', err);
    return [];
  }
}