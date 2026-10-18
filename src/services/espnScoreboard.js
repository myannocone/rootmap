/**
 * ESPN Public Scoreboard Service
 * Fetches real NFL game schedules, live scores, quarter/clock status, and team matchups.
 * Public endpoint: No API keys or authentication required.
 */

const ESPN_NFL_SCOREBOARD_URL = 'https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard';

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

      const status = event.status?.type?.shortDetail || 'Upcoming';
      const isLive = event.status?.type?.state === 'in';
      const isFinal = event.status?.type?.completed || false;

      // Format clean game time / clock
      let displayTime = status;
      if (!isLive && !isFinal && competition.startDate) {
        displayTime = new Date(competition.startDate).toLocaleTimeString([], {
          hour: 'numeric',
          minute: '2-digit'
        });
      }

      return {
        id: event.id,
        home: homeComp.team?.abbreviation || 'HOME',
        away: awayComp.team?.abbreviation || 'AWAY',
        homeName: homeComp.team?.shortDisplayName || 'Home',
        awayName: awayComp.team?.shortDisplayName || 'Away',
        homeScore: homeComp.score || '0',
        awayScore: awayComp.score || '0',
        status: isLive ? `LIVE • ${status}` : isFinal ? 'FINAL' : 'UPCOMING',
        time: displayTime,
        isLive,
        isFinal,
        players: []
      };
    });
  } catch (err) {
    console.error('Failed to load live ESPN NFL slate, falling back:', err);
    return [];
  }
}