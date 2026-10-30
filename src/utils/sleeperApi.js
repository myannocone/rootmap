import { resolveNflTeam } from './leagueParser.js';

const SLEEPER_BASE = 'https://api.sleeper.app/v1';
const PLAYERS_CACHE_KEY = 'sleeper_nfl_players';
const SLEEPER_SEASON = '2026';
const BENCH_SLOTS = new Set(['BN', 'IR', 'TAXI']);

let playerDirectoryCache = null;
let playerDirectoryPromise = null;

async function sleeperGet(path) {
  const response = await fetch(`${SLEEPER_BASE}${path}`);
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`Sleeper request failed (${response.status})`);
  return response.json();
}

export async function lookupSleeperUser(username) {
  const handle = String(username || '').trim();
  if (!handle) throw new Error('Enter a Sleeper username.');
  const user = await sleeperGet(`/user/${encodeURIComponent(handle)}`);
  if (!user?.user_id) throw new Error('No Sleeper user found for that username.');
  return user;
}

export async function fetchUserSleeperLeagues(userId, season = SLEEPER_SEASON) {
  const leagues = await sleeperGet(`/user/${userId}/leagues/nfl/${season}`);
  if (!Array.isArray(leagues)) return [];
  return leagues.map((league) => ({
    id: String(league.league_id),
    name: String(league.name || 'Sleeper League').trim() || 'Sleeper League',
    rosterPositions: league.roster_positions || [],
    scoringSettings: league.scoring_settings || null,
    status: league.status || ''
  }));
}

const POINT_KEYS = ['pts_ppr', 'pts_half_ppr', 'pts_std'];

export function sleeperScoringKey(settings) {
  const rec = Number(settings?.rec);
  if (!Number.isFinite(rec)) return 'pts_ppr';
  if (rec >= 1) return 'pts_ppr';
  if (rec >= 0.5) return 'pts_half_ppr';
  return 'pts_std';
}

function packPointLine(line) {
  if (!line || typeof line !== 'object') return null;
  const packed = {};
  POINT_KEYS.forEach((key) => {
    const value = Number(line[key]);
    if (Number.isFinite(value)) packed[key] = value;
  });
  return Object.keys(packed).length ? packed : null;
}

function pickPoint(packed, scoringKey) {
  if (!packed) return null;
  const value = packed[scoringKey] ?? packed.pts_ppr ?? packed.pts_half_ppr ?? packed.pts_std;
  return value == null ? null : Number(value);
}

const NON_PLAY_STAT_KEYS = new Set([
  'gms_active',
  'gp',
  'pos_rank_std',
  'pos_rank_ppr',
  'pos_rank_half_ppr',
  ...POINT_KEYS
]);

export function sleeperLineStarted(line) {
  if (!line || typeof line !== 'object') return false;
  const points = Number(line.pts_ppr ?? line.pts_std ?? line.pts_half_ppr);
  if (Number.isFinite(points) && points > 0) return true;
  return Object.entries(line).some(([key, value]) => (
    !NON_PLAY_STAT_KEYS.has(key) && Number(value) > 0
  ));
}

function normalizePlayerName(name) {
  return String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function sleeperTeam(value) {
  const key = String(value || '').trim().toUpperCase();
  if (key === 'WSH' || key === 'WAS') return 'WAS';
  if (key === 'JAC') return 'JAX';
  if (key === 'LA') return 'LAR';
  return key;
}

export function buildSleeperLiveIndex(stats, projections, players = {}, onlyIds = null) {
  const byId = {};
  const byName = {};
  const ids = Array.isArray(onlyIds)
    ? onlyIds.map(String)
    : Object.keys(stats || {});
  ids.forEach((id) => {
    const actual = packPointLine(stats?.[id]);
    const proj = packPointLine(projections?.[id]);
    if (!actual && !proj) return;
    const meta = players?.[id] || {};
    const record = {
      started: sleeperLineStarted(stats?.[id]),
      actual,
      proj,
      team: resolveNflTeam(meta.team) || sleeperTeam(meta.team)
    };
    byId[String(id)] = record;
    const name = meta.full_name || [meta.first_name, meta.last_name].filter(Boolean).join(' ');
    const key = normalizePlayerName(name);
    if (!key) return;
    const teamKey = record.team ? `${key}|${record.team}` : '';
    if (teamKey) byName[teamKey] = record;
    const existing = byName[key];
    if (!existing || (record.started && !existing.started)) byName[key] = record;
  });
  return { byId, byName };
}

export function sleeperScoreSignature(bundle) {
  return Object.keys(bundle?.byId || {}).sort().map((id) => {
    const row = bundle.byId[id];
    const actual = row?.actual || {};
    const proj = row?.proj || {};
    return [
      id,
      row?.started ? 1 : 0,
      actual.pts_ppr ?? '',
      actual.pts_half_ppr ?? '',
      actual.pts_std ?? '',
      proj.pts_ppr ?? '',
      proj.pts_half_ppr ?? '',
      proj.pts_std ?? ''
    ].join(':');
  }).join('|');
}

export async function fetchSleeperLiveScores({ season = SLEEPER_SEASON, week = 8, ids = null } = {}) {
  const weekNumber = Number(week);
  const onlyIds = Array.isArray(ids) ? ids.map(String).filter(Boolean) : null;
  if (onlyIds && !onlyIds.length) return { byId: {}, byName: {} };
  const [stats, projections, players] = await Promise.all([
    sleeperGet(`/stats/nfl/regular/${season}/${weekNumber}`).catch(() => ({})),
    sleeperGet(`/projections/nfl/regular/${season}/${weekNumber}`).catch(() => ({})),
    onlyIds ? Promise.resolve({}) : prefetchSleeperPlayers().catch(() => ({}))
  ]);
  return buildSleeperLiveIndex(stats || {}, projections || {}, players || {}, onlyIds);
}

export function sleeperLiveNumbers(player, bundle) {
  if (!player || !bundle) return null;
  const byId = player.sleeperId ? bundle.byId?.[String(player.sleeperId)] : null;
  const nameKey = normalizePlayerName(player.name);
  const team = resolveNflTeam(player.nflTeam || player.team) || sleeperTeam(player.nflTeam || player.team);
  const byName = (team && bundle.byName?.[`${nameKey}|${team}`])
    || bundle.byName?.[nameKey];
  const live = byId || byName;
  if (!live) return null;
  const key = player.scoringKey || 'pts_ppr';
  return {
    started: Boolean(live.started),
    actual: pickPoint(live.actual, key),
    proj: pickPoint(live.proj, key)
  };
}

export function prefetchSleeperPlayers() {
  if (playerDirectoryCache) return Promise.resolve(playerDirectoryCache);
  if (!playerDirectoryPromise) playerDirectoryPromise = loadSleeperPlayers();
  return playerDirectoryPromise;
}

async function loadSleeperPlayers() {
  if (playerDirectoryCache) return playerDirectoryCache;
  try {
    const cached = sessionStorage.getItem(PLAYERS_CACHE_KEY);
    if (cached) {
      playerDirectoryCache = JSON.parse(cached);
      return playerDirectoryCache;
    }
  } catch {
    // session cache is optional
  }

  const players = await sleeperGet('/players/nfl');
  playerDirectoryCache = players && typeof players === 'object' ? players : {};
  try {
    sessionStorage.setItem(PLAYERS_CACHE_KEY, JSON.stringify(playerDirectoryCache));
  } catch {
    // the directory is large; memory cache still covers this session
  }
  return playerDirectoryCache;
}

export async function fetchSleeperMatchupBundle(leagueId, week) {
  const [rosters, users, matchups] = await Promise.all([
    sleeperGet(`/league/${leagueId}/rosters`),
    sleeperGet(`/league/${leagueId}/users`),
    sleeperGet(`/league/${leagueId}/matchups/${week}`)
  ]);
  return {
    rosters: Array.isArray(rosters) ? rosters : [],
    users: Array.isArray(users) ? users : [],
    matchups: Array.isArray(matchups) ? matchups : []
  };
}

function teamLabel(user) {
  const named = String(user?.metadata?.team_name || '').trim();
  if (named) return named;
  return user?.display_name || 'Sleeper Team';
}

function startingSlots(rosterPositions) {
  return (rosterPositions || []).filter((slot) => !BENCH_SLOTS.has(String(slot || '').toUpperCase()));
}

function isDefense(playerId, meta, slot) {
  const position = String(meta?.position || slot || '').toUpperCase();
  if (position === 'DEF' || position === 'DST' || position === 'D/ST') return true;
  return /^[A-Za-z]{2,3}$/.test(String(playerId || '')) && !meta?.full_name;
}

function matchupPlayerPoints(matchup, playerId, index) {
  const id = String(playerId);
  const fromPlayers = matchup?.players_points?.[id] ?? matchup?.players_points?.[playerId];
  if (fromPlayers != null && fromPlayers !== '') return Number(fromPlayers);
  const fromStarter = matchup?.starters_points?.[index];
  if (fromStarter != null && fromStarter !== '') return Number(fromStarter);
  return null;
}

function matchupHasLiveScore(matchup) {
  if (Number(matchup?.points) > 0) return true;
  return matchup?.custom_points != null && matchup.custom_points !== '' && Number(matchup.custom_points) !== 0;
}

function scoreForStarter(playerId, index, matchup, stats, projections, scoringKey) {
  const id = String(playerId);
  const statLine = stats?.[id];
  const actual = pickPoint(packPointLine(statLine), scoringKey);
  const projected = pickPoint(packPointLine(projections?.[id]), scoringKey);
  const matchupPoints = matchupPlayerPoints(matchup, playerId, index);
  const started = sleeperLineStarted(statLine) || (matchupHasLiveScore(matchup) && Number.isFinite(matchupPoints) && matchupPoints > 0);
  const actualPoints = started
    ? (sleeperLineStarted(statLine) && actual != null ? actual : (Number.isFinite(matchupPoints) ? matchupPoints : actual))
    : null;
  const points = actualPoints != null
    ? actualPoints
    : (projected ?? (Number.isFinite(matchupPoints) ? matchupPoints : 0));
  return {
    points: Number.isFinite(Number(points)) ? Number(points) : 0,
    projPoints: projected,
    actualPoints,
    isLive: Boolean(started),
    scoringKey
  };
}

function starterFromId(playerId, slotHint, score, players) {
  if (playerId == null || playerId === '' || String(playerId) === '0') return null;
  const meta = players?.[playerId] || players?.[String(playerId)] || {};
  const defense = isDefense(playerId, meta, slotHint);
  const slot = defense ? 'D/ST' : (slotHint || meta.position || 'FLEX');
  const position = defense ? 'D/ST' : (meta.position || slot);
  const nflTeam = meta.team || (defense ? String(playerId).toUpperCase() : '');
  const person = meta.full_name || [meta.first_name, meta.last_name].filter(Boolean).join(' ').trim();
  const name = defense
    ? `${meta.last_name || meta.first_name || nflTeam || playerId} D/ST`
    : (person || `Player ${playerId}`);
  return {
    name,
    sleeperId: String(playerId),
    slot,
    position,
    nflTeam,
    team: nflTeam,
    points: score.points,
    projPoints: score.projPoints,
    actualPoints: score.actualPoints,
    isLive: score.isLive,
    scoringKey: score.scoringKey,
    inRedZone: false,
    gameClock: 'Scheduled',
    bigPlay: null,
    isStarter: true
  };
}

function lineupFrom(ids, slots, matchup, players, stats, projections, scoringKey) {
  return (ids || [])
    .map((id, index) => starterFromId(
      id,
      slots[index],
      scoreForStarter(id, index, matchup, stats, projections, scoringKey),
      players
    ))
    .filter(Boolean);
}

export function mapSleeperLeague({
  league,
  userId,
  week,
  rosters,
  users,
  matchups,
  players,
  weekStats = {},
  weekProjections = {}
}) {
  const roster = (rosters || []).find((entry) => entry.owner_id === userId);
  const user = (users || []).find((entry) => entry.user_id === userId);
  const userTeamName = teamLabel(user);
  const slots = startingSlots(league?.rosterPositions);
  const weekMatchup = roster
    ? (matchups || []).find((entry) => entry.roster_id === roster.roster_id)
    : null;
  const opponents = weekMatchup?.matchup_id == null
    ? []
    : (matchups || []).filter((entry) => (
      entry.matchup_id === weekMatchup.matchup_id && entry.roster_id !== roster.roster_id
    ));

  const scoringKey = sleeperScoringKey(league?.scoringSettings || league?.scoring_settings);
  const myIds = weekMatchup?.starters?.length ? weekMatchup.starters : (roster?.starters || []);
  const mine = lineupFrom(myIds, slots, weekMatchup, players, weekStats, weekProjections, scoringKey).map((player) => ({
    ...player,
    ownership: 1,
    isThreat: false,
    gameClock: `Week ${week}`
  }));

  const oppStarters = [];
  const seen = new Set();
  opponents.forEach((opponent) => {
    lineupFrom(opponent.starters, slots, opponent, players, weekStats, weekProjections, scoringKey).forEach((player) => {
      if (seen.has(player.sleeperId)) return;
      seen.add(player.sleeperId);
      oppStarters.push({
        ...player,
        ownership: 0,
        isThreat: true,
        gameClock: `Week ${week}`
      });
    });
  });

  const oppNames = opponents.map((opponent) => {
    const oppRoster = (rosters || []).find((entry) => entry.roster_id === opponent.roster_id);
    const oppUser = (users || []).find((entry) => entry.user_id === oppRoster?.owner_id);
    return teamLabel(oppUser);
  }).filter(Boolean);
  const oppTeamName = oppNames.length ? oppNames.join(' & ') : 'No matchup';

  return {
    id: `sleeper-${league.id}`,
    name: league.name,
    platform: 'Sleeper',
    season: SLEEPER_SEASON,
    myScore: Number(weekMatchup?.custom_points ?? weekMatchup?.points) || 0,
    oppScore: opponents.reduce((sum, opponent) => sum + (Number(opponent.custom_points ?? opponent.points) || 0), 0),
    myTeamName: userTeamName,
    oppTeamName,
    opponent: oppTeamName,
    userTeam: { name: userTeamName, starters: mine },
    oppTeam: { name: oppTeamName, starters: oppStarters },
    portfolio: mine,
    threats: oppStarters
  };
}

export async function syncSleeperLeagues({ userId, leagues, week }) {
  const selected = (leagues || []).filter(Boolean);
  if (!selected.length) throw new Error('Select at least one league.');
  const weekNumber = Number(week);
  if (!Number.isInteger(weekNumber) || weekNumber < 1 || weekNumber > 18) {
    throw new Error('Enter an NFL week from 1 to 18.');
  }
  const [players, weekStats, weekProjections] = await Promise.all([
    prefetchSleeperPlayers(),
    sleeperGet(`/stats/nfl/regular/${SLEEPER_SEASON}/${weekNumber}`).catch(() => ({})),
    sleeperGet(`/projections/nfl/regular/${SLEEPER_SEASON}/${weekNumber}`).catch(() => ({}))
  ]);
  const mapped = [];
  for (const league of selected) {
    const bundle = await fetchSleeperMatchupBundle(league.id, weekNumber);
    mapped.push(mapSleeperLeague({
      league,
      userId,
      week: weekNumber,
      players,
      weekStats: weekStats || {},
      weekProjections: weekProjections || {},
      ...bundle
    }));
  }
  return mapped;
}
