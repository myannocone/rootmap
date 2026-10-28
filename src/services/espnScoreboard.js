import { canonTeam, getActiveSlate } from '../data/nflSchedule';

function pairKey(away, home) {
  return [canonTeam(away), canonTeam(home)].sort().join('|');
}

function parseEspnEvent(evt) {
  const comp = evt?.competitions?.[0];
  const competitors = comp?.competitors || [];
  const homeTeam = competitors.find((c) => c.homeAway === 'home');
  const awayTeam = competitors.find((c) => c.homeAway === 'away');
  const home = canonTeam(homeTeam?.team?.abbreviation);
  const away = canonTeam(awayTeam?.team?.abbreviation);
  if (!home || !away) return null;

  const detail = evt?.status?.type?.shortDetail || 'Upcoming';
  const isLive = evt?.status?.type?.state === 'in';

  return {
    id: evt?.id || `${away}@${home}`,
    home,
    away,
    homeScore: parseInt(homeTeam?.score || '0', 10),
    awayScore: parseInt(awayTeam?.score || '0', 10),
    status: isLive ? `LIVE • ${detail}` : detail,
    time: detail
  };
}

function mergeEspnIntoSlate(scheduleGames, events) {
  const liveByPair = new Map();
  (events || []).forEach((evt) => {
    const parsed = parseEspnEvent(evt);
    if (!parsed) return;
    liveByPair.set(pairKey(parsed.away, parsed.home), parsed);
  });

  return scheduleGames.map((game) => {
    const live = liveByPair.get(pairKey(game.away, game.home));
    if (!live) return game;
    const homeIsScheduleHome = live.home === canonTeam(game.home);
    return {
      ...game,
      id: live.id || game.id,
      home: canonTeam(game.home),
      away: canonTeam(game.away),
      homeScore: homeIsScheduleHome ? live.homeScore : live.awayScore,
      awayScore: homeIsScheduleHome ? live.awayScore : live.homeScore,
      status: live.status,
      time: live.time || game.time
    };
  });
}

export async function fetchLiveNFLSlate(now = new Date()) {
  const slate = getActiveSlate(now);
  let events = [];
  try {
    const res = await fetch('https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard');
    if (res.ok) {
      const data = await res.json();
      events = data?.events || [];
    }
  } catch (err) {
    console.error('ESPN fetch fallback triggered:', err);
  }

  return {
    week: slate.week,
    season: slate.season,
    label: slate.label,
    range: slate.range,
    byes: slate.byes || [],
    opensAt: slate.opensAt,
    games: mergeEspnIntoSlate(slate.games, events)
  };
}
