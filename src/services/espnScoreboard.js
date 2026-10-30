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
  const state = evt?.status?.type?.state || '';
  const completed = Boolean(evt?.status?.type?.completed);
  const isLive = state === 'in';
  const situation = comp?.situation || {};
  const possessionId = String(situation.possession || '');
  const possessor = competitors.find((team) => String(team?.id || team?.team?.id || '') === possessionId);
  const possession = canonTeam(possessor?.team?.abbreviation);

  return {
    id: evt?.id || `${away}@${home}`,
    home,
    away,
    homeScore: parseInt(homeTeam?.score || '0', 10),
    awayScore: parseInt(awayTeam?.score || '0', 10),
    state,
    completed,
    isRedZone: Boolean(situation.isRedZone),
    possession,
    status: isLive ? `LIVE • ${detail}` : detail,
    time: detail
  };
}

export function gamePhase(game, now = new Date()) {
  const state = String(game?.state || '').toLowerCase();
  const clock = `${game?.status || ''} ${game?.time || ''}`;
  if (state === 'post' || game?.completed || /\bfinal\b/i.test(clock)) return 'FINAL';
  if (state === 'in' || /\b(Q[1-4]|1st|2nd|3rd|4th|OT|Halftime)\b/i.test(clock) || /\bLIVE\b/i.test(clock)) {
    return 'IN_PROGRESS';
  }
  if (state === 'pre') return 'UPCOMING';
  const kickoff = Date.parse(game?.kickoff || '');
  const instant = now instanceof Date ? now.getTime() : new Date(now).getTime();
  if (Number.isFinite(kickoff) && instant >= kickoff) return 'IN_PROGRESS';
  return 'UPCOMING';
}

function withPhase(game, now) {
  const phase = gamePhase(game, now);
  const status = game?.status || game?.time || '';
  const nextStatus = phase === 'IN_PROGRESS' && status && !/\bLIVE\b/i.test(status)
    ? `LIVE • ${status}`
    : status;
  return {
    ...game,
    gameStatus: phase,
    status: nextStatus || status
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
      state: live.state || game.state || '',
      completed: Boolean(live.completed),
      isRedZone: Boolean(live.isRedZone),
      possession: live.possession || '',
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
    games: mergeEspnIntoSlate(slate.games, events).map((game) => withPhase(game, now))
  };
}
