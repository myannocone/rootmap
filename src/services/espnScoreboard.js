import { byeTeamsForGames, canonTeam, getActiveSlate, getSlateByWeek } from '../data/nflSchedule';

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
    homeName: homeTeam?.team?.shortDisplayName || homeTeam?.team?.displayName || home,
    awayName: awayTeam?.team?.shortDisplayName || awayTeam?.team?.displayName || away,
    kickoff: evt?.date || null,
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

function gamesFromEspnEvents(events, week) {
  return (events || []).map((evt) => {
    const parsed = parseEspnEvent(evt);
    if (!parsed) return null;
    return {
      id: parsed.id,
      week,
      away: parsed.away,
      home: parsed.home,
      awayName: parsed.awayName,
      homeName: parsed.homeName,
      kickoff: parsed.kickoff,
      time: parsed.time,
      status: parsed.status,
      homeScore: parsed.homeScore,
      awayScore: parsed.awayScore,
      state: parsed.state,
      completed: parsed.completed,
      isRedZone: parsed.isRedZone,
      possession: parsed.possession,
      players: []
    };
  }).filter(Boolean);
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

export async function fetchLiveNFLSlate(now = new Date(), week = null) {
  const active = getActiveSlate(now);
  const requested = Number(week) || active?.week || 9;
  const slate = getSlateByWeek(requested) || {
    week: requested,
    season: active?.season || 2026,
    label: `Week ${requested}`,
    range: '',
    byes: [],
    opensAt: null,
    games: []
  };
  let events = [];
  try {
    const url = `https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?dates=${slate.season}&seasontype=2&week=${slate.week}`;
    const res = await fetch(url);
    if (res.ok) {
      const data = await res.json();
      events = data?.events || [];
    }
  } catch (err) {
    console.error('ESPN fetch fallback triggered:', err);
  }

  const espnGames = gamesFromEspnEvents(events, slate.week);
  let games = slate.games.length ? mergeEspnIntoSlate(slate.games, events) : espnGames;
  if (slate.games.length && espnGames.length) {
    const known = new Set(games.map((game) => pairKey(game.away, game.home)));
    espnGames.forEach((game) => {
      if (!known.has(pairKey(game.away, game.home))) games.push(game);
    });
  }

  return {
    week: slate.week,
    season: slate.season,
    label: slate.label,
    range: slate.range,
    byes: byeTeamsForGames(games, slate.byes),
    opensAt: slate.opensAt,
    games: games.map((game) => withPhase(game, now))
  };
}
