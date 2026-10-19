export async function fetchLiveNFLSlate() {
  try {
    const res = await fetch('https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard');
    if (!res.ok) return [];
    const data = await res.json();
    const events = data?.events || [];

    return events.map(evt => {
      const comp = evt?.competitions?.[0];
      const competitors = comp?.competitors || [];
      const homeTeam = competitors.find(c => c.homeAway === 'home');
      const awayTeam = competitors.find(c => c.homeAway === 'away');

      const status = evt?.status?.type?.shortDetail || 'Upcoming';
      const isLive = evt?.status?.type?.state === 'in';

      return {
        id: evt?.id || String(Math.random()),
        home: homeTeam?.team?.abbreviation || 'NFL',
        away: awayTeam?.team?.abbreviation || 'NFL',
        homeScore: parseInt(homeTeam?.score || '0', 10),
        awayScore: parseInt(awayTeam?.score || '0', 10),
        status: isLive ? `LIVE • ${status}` : status,
        time: status,
        players: []
      };
    });
  } catch (err) {
    console.error('ESPN fetch fallback triggered:', err);
    return [];
  }
}
