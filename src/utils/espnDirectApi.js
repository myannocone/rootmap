import { Capacitor } from '@capacitor/core';
import { activeOrProjected, isActiveEspnSlot } from './activeLineup';
import { SITE_ORIGIN } from './siteOrigin';

const ESPN_ORIGIN = 'https://lm-api-reads.fantasy.espn.com';

const POSITION_BY_ID = {
  1: 'QB',
  2: 'RB',
  3: 'WR',
  4: 'TE',
  5: 'K',
  8: 'DT',
  9: 'DE',
  10: 'LB',
  11: 'CB',
  12: 'S',
  13: 'DL',
  14: 'DB',
  16: 'D/ST'
};

const SLOT_BY_ID = {
  0: 'QB',
  2: 'RB',
  3: 'RB/WR',
  4: 'WR',
  5: 'WR/TE',
  6: 'TE',
  7: 'OP',
  8: 'DT',
  9: 'DE',
  10: 'LB',
  11: 'DL',
  12: 'CB',
  13: 'S',
  14: 'DB',
  15: 'DP',
  16: 'D/ST',
  17: 'K',
  23: 'FLEX'
};

const PRO_TEAM_BY_ID = {
  1: 'ATL',
  2: 'BUF',
  3: 'CHI',
  4: 'CIN',
  5: 'CLE',
  6: 'DAL',
  7: 'DEN',
  8: 'DET',
  9: 'GB',
  10: 'TEN',
  11: 'IND',
  12: 'KC',
  13: 'LV',
  14: 'LAR',
  15: 'MIA',
  16: 'MIN',
  17: 'NE',
  18: 'NO',
  19: 'NYG',
  20: 'NYJ',
  21: 'PHI',
  22: 'ARI',
  23: 'PIT',
  24: 'LAC',
  25: 'SF',
  26: 'SEA',
  27: 'TB',
  28: 'WAS',
  29: 'CAR',
  30: 'JAX',
  33: 'BAL',
  34: 'HOU'
};

const PRIVATE_LEAGUE_ERROR = "This ESPN league is private. Ask your commissioner to set 'Viewable to Public' or use the Desktop Extension.";

function espnViewQuery(week) {
  const params = new URLSearchParams();
  ['mMatchup', 'mRoster', 'mTeam', 'mSettings'].forEach((view) => params.append('view', view));
  params.set('scoringPeriodId', String(week));
  params.set('matchupPeriodId', String(week));
  return params.toString();
}

export function espnLeagueUrl({ season, leagueId, week }) {
  return `${ESPN_ORIGIN}/apis/v3/games/ffl/seasons/${season}/segments/0/leagues/${leagueId}?${espnViewQuery(week)}`;
}

function clientEspnUrl({ season, leagueId, week }) {
  if (import.meta.env.DEV) {
    return `/api/espn/apis/v3/games/ffl/seasons/${season}/segments/0/leagues/${leagueId}?${espnViewQuery(week)}`;
  }
  const params = new URLSearchParams({
    leagueId: String(leagueId),
    season: String(season),
    week: String(week)
  });
  const path = `/api/espn?${params.toString()}`;
  return Capacitor.isNativePlatform() ? `${SITE_ORIGIN}${path}` : path;
}

function assertSeasonAndWeek(season, week) {
  const year = Number(season);
  const weekNumber = Number(week);
  if (!Number.isInteger(year) || year < 2018 || year > 2035) {
    throw new Error('Enter a season year like 2026.');
  }
  if (!Number.isInteger(weekNumber) || weekNumber < 1 || weekNumber > 18) {
    throw new Error('Enter an NFL week from 1 to 18.');
  }
  return { year, weekNumber };
}

function cleanCookieValue(value, name) {
  let text = String(value || '').trim().replace(new RegExp(`^${name}=`, 'i'), '').trim();
  text = text.replace(/^["']|["']$/g, '');
  if (text.includes('%')) {
    try {
      text = decodeURIComponent(text);
    } catch {
      // keep the pasted value
    }
  }
  return text;
}

export function espnSessionCookies(swid, espnS2) {
  const swidValue = cleanCookieValue(swid, 'SWID');
  const s2Value = cleanCookieValue(espnS2, 'espn_s2');
  if (!swidValue && !s2Value) return null;
  if (!swidValue || !s2Value) {
    throw new Error('Enter both SWID and espn_s2, or leave both blank.');
  }
  return { swid: swidValue, espnS2: s2Value };
}

export async function fetchEspnFanLeagues({ swid = '', espnS2 = '' } = {}) {
  let session = null;
  try {
    session = espnSessionCookies(swid, espnS2);
  } catch {
    return [];
  }
  if (!session) return [];
  const path = '/api/discover-espn';
  const url = import.meta.env.DEV || !Capacitor.isNativePlatform()
    ? path
    : `${SITE_ORIGIN}${path}`;
  let response;
  try {
    response = await fetch(url, {
      headers: {
        Accept: 'application/json',
        'X-SWID': encodeURIComponent(session.swid),
        'X-ESPN-S2': encodeURIComponent(session.espnS2)
      }
    });
  } catch {
    return [];
  }
  if (!response.ok) return [];
  const body = await response.json().catch(() => null);
  const leagues = Array.isArray(body?.leagues) ? body.leagues : [];
  return leagues
    .map((league) => ({
      id: String(league?.id || '').trim(),
      name: String(league?.name || '').trim()
    }))
    .filter((league) => /^\d+$/.test(league.id));
}

export function espnCookieHeader(swid, espnS2) {
  return `SWID=${swid}; espn_s2=${espnS2};`;
}

export async function fetchEspnLeague({ leagueId, season = 2026, week = 9, swid = '', espnS2 = '' }) {
  const id = String(leagueId || '').trim();
  if (!/^\d+$/.test(id)) throw new Error('Enter an ESPN league ID.');
  const { year, weekNumber } = assertSeasonAndWeek(season, week);
  const session = espnSessionCookies(swid, espnS2);
  const url = clientEspnUrl({ season: year, leagueId: id, week: weekNumber });
  const headers = { Accept: 'application/json' };
  if (session) {
    headers['X-SWID'] = encodeURIComponent(session.swid);
    headers['X-ESPN-S2'] = encodeURIComponent(session.espnS2);
  }
  let response;
  try {
    response = await fetch(url, { headers });
  } catch {
    throw new Error('Could not reach ESPN.');
  }
  if (response.status === 401 || response.status === 403) {
    throw new Error(session
      ? 'ESPN rejected that SWID and espn_s2. Copy both cookies again from espn.com.'
      : PRIVATE_LEAGUE_ERROR);
  }
  if (response.status === 404) throw new Error('League ID not found.');
  if (!response.ok) throw new Error(`ESPN request failed (${response.status}).`);
  const league = await response.json();
  if (!league || typeof league !== 'object' || !Array.isArray(league.teams)) {
    throw new Error('League ID not found.');
  }
  return league;
}

export function espnTeamName(team) {
  const location = String(team?.location || '').trim();
  const nickname = String(team?.nickname || '').trim();
  const combined = [location, nickname].filter(Boolean).join(' ');
  return combined || String(team?.name || '').trim() || team?.abbrev || `Team ${team?.id ?? ''}`.trim();
}

export function listEspnTeams(league) {
  return (league?.teams || [])
    .map((team) => ({ id: String(team.id), name: espnTeamName(team) }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function sideTeamId(side) {
  if (side == null) return null;
  if (typeof side === 'number' || typeof side === 'string') return String(side);
  if (side.teamId == null) return null;
  return String(side.teamId);
}

function finiteNumber(value) {
  if (value == null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function matchupGame(league, team, weekNumber) {
  const games = [
    ...(Array.isArray(team?.schedule) ? team.schedule : []),
    ...(Array.isArray(league?.schedule) ? league.schedule : [])
  ];
  const mine = String(team?.id ?? '');
  return games.find((entry) => entry && Number(entry.matchupPeriodId) === weekNumber && (
    sideTeamId(entry.home) === mine || sideTeamId(entry.away) === mine
  )) || null;
}

function opponentIdFor(league, team, weekNumber) {
  const game = matchupGame(league, team, weekNumber);
  if (!game) return null;
  const mine = String(team?.id ?? '');
  const home = sideTeamId(game.home);
  const away = sideTeamId(game.away);
  if (home === mine) return away;
  if (away === mine) return home;
  return null;
}

function sideWeeklyPoints(side) {
  if (!side || typeof side !== 'object' || Array.isArray(side)) return null;
  const live = finiteNumber(side.totalPointsLive);
  if (live != null) return live;
  const total = finiteNumber(side.totalPoints);
  if (total != null) return total;
  return finiteNumber(side.rosterForCurrentScoringPeriod?.appliedStatTotal);
}

function weeklyMatchupScore(game, teamId, starters) {
  const fallback = (starters || []).reduce((sum, player) => {
    const number = Number(player?.actualPoints);
    return sum + (Number.isFinite(number) ? number : 0);
  }, 0);
  if (teamId == null || teamId === '') return fallback;
  const mine = String(teamId);
  const side = game && sideTeamId(game.home) === mine ? game.home : (game && sideTeamId(game.away) === mine ? game.away : null);
  const live = sideWeeklyPoints(side);
  return live != null ? live : fallback;
}

function playerName(player, defense, nflTeam) {
  const full = String(player?.fullName || '').trim();
  if (full) return full;
  const joined = [player?.firstName, player?.lastName].filter(Boolean).join(' ').trim();
  if (joined) return defense ? `${joined} D/ST` : joined;
  if (defense) return `${nflTeam || 'Team'} D/ST`;
  return '';
}

function statTotal(stat) {
  if (!stat || typeof stat !== 'object') return null;
  const raw = stat.appliedStatTotal != null ? stat.appliedStatTotal : stat.appliedTotal;
  if (raw == null || raw === '') return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

function findWeekStat(stats, weekNumber, sourceId) {
  const matches = (Array.isArray(stats) ? stats : []).filter((stat) => (
    stat
    && Number(stat.statSourceId) === sourceId
    && Number(stat.scoringPeriodId) === weekNumber
  ));
  return matches.find((stat) => Number(stat.statSplitTypeId) === 1) || matches[0] || null;
}

function statLineStarted(stat) {
  if (!stat) return false;
  const total = statTotal(stat);
  if (total != null && total > 0) return true;
  const raw = stat.stats;
  return Boolean(raw && typeof raw === 'object' && Object.keys(raw).length);
}

function espnScore(player, pool, weekNumber) {
  const actualStat = findWeekStat(player?.stats, weekNumber, 0);
  const projStat = findWeekStat(player?.stats, weekNumber, 1);
  const actual = statTotal(actualStat);
  const projected = statTotal(projStat);
  const poolTotal = Number(pool?.appliedStatTotal);
  const poolPoints = Number.isFinite(poolTotal) ? poolTotal : null;
  const started = statLineStarted(actualStat);
  const actualPoints = started ? (actual ?? 0) : null;
  const points = actualPoints != null ? actualPoints : (projected ?? poolPoints ?? 0);
  return {
    points,
    projPoints: projected ?? (actualPoints == null ? points : null),
    actualPoints,
    isLive: Boolean(started && (actualPoints > 0 || statLineStarted(actualStat)))
  };
}

function starterFromEntry(entry, weekNumber) {
  if (!entry || typeof entry !== 'object') return null;
  const slotId = Number(entry.lineupSlotId);
  const isStarter = isActiveEspnSlot(slotId);
  const pool = entry.playerPoolEntry;
  const player = pool && typeof pool === 'object' ? pool.player : null;
  if (!player || typeof player !== 'object') return null;
  const positionId = Number(player.defaultPositionId);
  const slotLabel = SLOT_BY_ID[slotId] || '';
  const position = POSITION_BY_ID[positionId] || slotLabel || 'FLEX';
  const defense = position === 'D/ST' || slotId === 16;
  const slot = defense ? 'D/ST' : (slotLabel || position);
  const nflTeam = PRO_TEAM_BY_ID[Number(player.proTeamId)] || '';
  const name = playerName(player, defense, nflTeam);
  if (!name) return null;
  const score = espnScore(player, pool, weekNumber);
  return {
    name,
    slot,
    position: defense ? 'D/ST' : position,
    nflTeam,
    team: nflTeam,
    points: score.points,
    projPoints: score.projPoints,
    actualPoints: score.actualPoints,
    isLive: score.isLive,
    inRedZone: false,
    gameClock: `Week ${weekNumber}`,
    bigPlay: null,
    isStarter
  };
}

function startersFor(team, weekNumber, side) {
  const entries = Array.isArray(team?.roster?.entries) ? team.roster.entries : [];
  return entries
    .map((entry) => starterFromEntry(entry, weekNumber))
    .filter(Boolean)
    .map((player) => ({
      ...player,
      ownership: side === 'mine' ? 1 : 0,
      isThreat: side !== 'mine'
    }));
}

export function mapEspnLeague({ league, leagueId, teamId, week, season = 2026 }) {
  const { weekNumber } = assertSeasonAndWeek(season, week);
  const teams = league?.teams || [];
  const team = teams.find((entry) => String(entry.id) === String(teamId));
  if (!team) throw new Error('Select your team.');
  const game = matchupGame(league, team, weekNumber);
  const opponentKey = opponentIdFor(league, team, weekNumber);
  const opponent = opponentKey == null
    ? null
    : teams.find((entry) => String(entry.id) === String(opponentKey));
  const userTeamName = espnTeamName(team);
  const oppTeamName = opponent ? espnTeamName(opponent) : 'No matchup';
  const espnSide = (entry) => {
    const overall = entry?.record?.overall || {};
    const wins = Number(overall.wins);
    const losses = Number(overall.losses);
    if (!Number.isFinite(wins) || !Number.isFinite(losses)) return { record: null, rank: null };
    const rank = Number(entry.playoffSeed || entry.rankCalculatedFinal || entry.currentProjectedRank);
    return {
      record: { wins, losses, ties: Number(overall.ties) || 0 },
      rank: Number.isFinite(rank) && rank > 0 ? rank : null
    };
  };
  const mineStanding = espnSide(team);
  const oppStanding = espnSide(opponent);
  const mineAll = startersFor(team, weekNumber, 'mine');
  const oppAll = opponent ? startersFor(opponent, weekNumber, 'opp') : [];
  const mine = activeOrProjected(mineAll);
  const opp = activeOrProjected(oppAll);
  const id = String(leagueId || league?.id || '').trim();
  return {
    id: `espn-${id}`,
    espnLeagueId: id,
    espnTeamId: String(teamId),
    lineupWeek: weekNumber,
    lineupProjected: mine.some((player) => player.projectedStart) || opp.some((player) => player.projectedStart),
    name: String(league?.settings?.name || '').trim() || `ESPN ${id}`,
    platform: 'ESPN',
    season: String(season),
    myScore: weeklyMatchupScore(game, team.id, mine),
    oppScore: weeklyMatchupScore(game, opponent?.id, opp),
    myTeamName: userTeamName,
    oppTeamName,
    opponent: oppTeamName,
    myRecord: mineStanding.record,
    oppRecord: oppStanding.record,
    myRank: mineStanding.rank,
    oppRank: oppStanding.rank,
    userTeam: { name: userTeamName, starters: mine },
    oppTeam: { name: oppTeamName, starters: opp },
    portfolio: mine,
    threats: opp
  };
}
