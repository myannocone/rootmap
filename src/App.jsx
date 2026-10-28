import React, { useState, useEffect, useMemo, useRef, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import RootMapLogo from './components/Logo';
import SyncInspector from './components/SyncInspector';
import { fetchLiveNFLSlate } from './services/espnScoreboard';
import { getActiveSlate } from './data/nflSchedule';

const LEAGUES_STORAGE_KEY = 'rootmap_leagues';

const STALE_MOCK_LEAGUE_IDS = new Set(['lg_1', 'l1', 'l2', 'l3', 'l4']);
const STALE_MOCK_LEAGUE_NAMES = new Set([
  'yannaconda',
  'family league',
  'high stakes 12-man',
  'high stakes 12 man',
  'work dynasty',
  'friends ppr'
]);
const YAHOO_OPPONENT_NAME = 'Crab Cakes and Football';

const ROOTING_LEGEND = [
  { icon: '🟢', title: 'Pure Root', detail: 'Solo offensive starter across your leagues.' },
  { icon: '🟢', title: 'Double Down (+2 or more)', detail: 'Started on multiple rosters.' },
  { icon: '🔴', title: 'Major Threat (-1 or more)', detail: 'Started by opponent(s) against you.' },
  { icon: '⚖️', title: 'Hedged / Wash', detail: 'Roster conflict (started in 1 league, opposed in another).' },
  { icon: '⚔️', title: 'Friendly Fire', detail: 'Offense playing directly against your active DEF.' },
  { icon: '⚡', title: 'Crossfire', detail: 'High-impact head-to-head game slot.' }
];

const TEAM_ALIASES = {
  WSH: 'WAS',
  JAC: 'JAX',
  LA: 'LAR',
  OAK: 'LV',
  SD: 'LAC',
  ARZ: 'ARI',
  GBP: 'GB',
  GNB: 'GB',
  KAN: 'KC',
  NOR: 'NO',
  TAM: 'TB',
  SFO: 'SF',
  NWE: 'NE'
};

const OFFENSIVE_POSITIONS = new Set(['QB', 'RB', 'WR', 'TE', 'FLEX', 'K']);

const SLOT_TOKEN_RE = /^(QB|RB|WR|TE|W\/R\/T|FLEX|K|DEF|D|DB|DL|LB)$/i;
const STOP_SLOT_RE = /^(BN|IR|BENCH|IL|NA)$/i;
const TEAM_POS_RE = /^([A-Za-z]{2,3})\s*[-–]\s*([A-Za-z/]+)$/;
const DASH_RE = /^[-–—]$/;
const FLOAT_RE = /^\d+\.\d{1,2}$/;
const NAME_NOISE_SUFFIX_RE = /(?:No new player Notes|Video Forecast|New Player Note|Player Note|PUP|SUSP|IR|[QO])$/i;

function getLeaguePortfolio(lg) {
  return lg?.portfolio || lg?.starters || [];
}

function getLeagueThreats(lg) {
  return lg?.threats || lg?.opponentStarters || [];
}

function getLeagueDisplayName(lg) {
  return lg?.name || lg?.myTeamName || 'My Team';
}

function getLeagueOppName(lg) {
  return lg?.oppTeamName || lg?.opponent || YAHOO_OPPONENT_NAME;
}

function normalizeLeague(lg, index = 0) {
  if (!lg || typeof lg !== 'object') return null;
  const portfolio = getLeaguePortfolio(lg);
  const threats = getLeagueThreats(lg);
  const name = getLeagueDisplayName(lg) || `League ${index + 1}`;
  const oppTeamName = getLeagueOppName(lg);
  return {
    ...lg,
    id: lg.id || `lg_${Date.now()}_${index}`,
    name,
    myTeamName: lg.myTeamName || name,
    oppTeamName,
    opponent: lg.opponent || oppTeamName,
    platform: lg.platform || 'Yahoo',
    season: lg.season || '2026',
    myScore: lg.myScore || 0,
    oppScore: lg.oppScore || 0,
    portfolio,
    threats,
    starters: portfolio,
    opponentStarters: threats
  };
}

function leagueNameKey(lg) {
  return String(lg?.name || lg?.myTeamName || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function isStaleMockLeague(lg) {
  if (!lg || typeof lg !== 'object') return false;
  if (lg.mock === true || lg.sample === true || lg.isMock === true || lg.isSample === true) return true;
  if (STALE_MOCK_LEAGUE_IDS.has(String(lg.id || ''))) return true;
  return STALE_MOCK_LEAGUE_NAMES.has(leagueNameKey(lg));
}

function loadStoredLeagues() {
  try {
    const raw = localStorage.getItem(LEAGUES_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    const list = Array.isArray(parsed) ? parsed : (parsed && typeof parsed === 'object' ? [parsed] : []);
    return list
      .filter((lg) => !isStaleMockLeague(lg))
      .map((lg, i) => normalizeLeague(lg, i))
      .filter(Boolean);
  } catch {
    return [];
  }
}

function TrashIcon() {
  return (
    <svg viewBox="0 0 16 16" className="w-3 h-3" aria-hidden="true">
      <path fill="currentColor" d="M6.2 1.8h3.6l.4 1h2.6v1.3H3.2V2.8h2.6l.4-1zM4.1 5.2h7.8l-.55 8.1a1 1 0 0 1-1 .9H5.65a1 1 0 0 1-1-.9L4.1 5.2z" />
    </svg>
  );
}

function buildPlayerMasterIndex(leagueList, games = [], defenseLeagues = null) {
  const map = new Map();

  const getOrCreate = (name, nflTeam, position, points = 0, isLive = false, inRedZone = false, gameClock = 'Scheduled', bigPlay = null) => {
    if (!map.has(name)) {
      map.set(name, {
        name,
        nflTeam,
        position,
        points,
        isLive,
        inRedZone,
        gameClock,
        bigPlay,
        myShares: 0,
        myLeagues: [],
        oppShares: 0,
        oppLeagues: []
      });
    }
    const item = map.get(name);
    if (points) item.points = points;
    if (isLive) item.isLive = true;
    if (inRedZone) item.inRedZone = true;
    if (gameClock && gameClock !== 'Scheduled') item.gameClock = gameClock;
    if (bigPlay) item.bigPlay = bigPlay;
    return item;
  };

  (leagueList || []).forEach((lg) => {
    getLeaguePortfolio(lg).forEach((p) => {
      const item = getOrCreate(p.name, p.nflTeam, p.position, p.points, p.isLive, p.inRedZone, p.gameClock, p.bigPlay);
      item.myShares += 1;
      item.myLeagues.push({ league: getLeagueDisplayName(lg), opponent: getLeagueOppName(lg) });
      item.isStarter = true;
      item.ownership = p.ownership ?? 1.0;
      if (p.actualPoints != null) item.actualPoints = p.actualPoints;
    });
  });

  (leagueList || []).forEach((lg) => {
    getLeagueThreats(lg).forEach((p) => {
      const item = getOrCreate(p.name, p.nflTeam, p.position, p.points, p.isLive, p.inRedZone, p.gameClock, p.bigPlay);
      item.oppShares += 1;
      item.oppLeagues.push({ league: getLeagueDisplayName(lg), opponent: getLeagueOppName(lg) });
      item.isThreat = true;
      if (p.actualPoints != null) item.actualPoints = p.actualPoints;
    });
  });

  markExposureTags(map, defenseLeagues || leagueList, games);
  return map;
}

function getCombinedStance(player, column) {
  const mine = player.myShares || 0;
  const opp = player.oppShares || 0;
  if (mine > 0 && opp > 0) return { label: 'Hedged / Wash', tone: 'hedge' };
  if (column === 'mine' && mine >= 2) return { label: `Double Down (+${mine})`, tone: 'down' };
  if (column === 'mine' && mine === 1 && isOffensiveStarter(player)) return { label: 'Pure Root', tone: 'pure' };
  if (column === 'opp' && opp >= 1) return { label: `Major Threat (-${opp})`, tone: 'threat' };
  return null;
}

function canonTeam(team) {
  const key = String(team || '').toUpperCase().trim();
  return TEAM_ALIASES[key] || key;
}

function isTeamDefense(player) {
  const pos = normalizePosition(player?.position);
  const slot = normalizeSlot(player?.slot);
  return pos === 'DEF' || slot === 'DEF';
}

function isOffensiveStarter(player) {
  if (!player || isTeamDefense(player)) return false;
  const pos = normalizePosition(player.position);
  const slot = normalizeSlot(player.slot);
  return OFFENSIVE_POSITIONS.has(pos) || OFFENSIVE_POSITIONS.has(slot);
}

function defenseOpponentTeam(defTeam, games) {
  const key = canonTeam(defTeam);
  if (!key) return null;
  for (const game of games || []) {
    const home = canonTeam(game.home);
    const away = canonTeam(game.away);
    if (home === key) return away;
    if (away === key) return home;
  }
  return null;
}

function markExposureTags(playerMap, leagueList, games) {
  const defsByOpponent = new Map();
  (leagueList || []).forEach((lg) => {
    getLeaguePortfolio(lg).forEach((p) => {
      if (!isTeamDefense(p)) return;
      const defTeam = canonTeam(p.nflTeam);
      const facing = defenseOpponentTeam(defTeam, games);
      if (!defTeam || !facing) return;
      if (!defsByOpponent.has(facing)) defsByOpponent.set(facing, new Set());
      defsByOpponent.get(facing).add(defTeam);
    });
  });

  const teamHasMine = new Set();
  const teamHasOpp = new Set();
  playerMap.forEach((player) => {
    const team = canonTeam(player.nflTeam);
    if (!team) return;
    if (player.myShares > 0) teamHasMine.add(team);
    if (player.oppShares > 0) teamHasOpp.add(team);
  });

  const crossfireTeams = new Set();
  (games || []).forEach((game) => {
    const home = canonTeam(game.home);
    const away = canonTeam(game.away);
    const homeExposed = teamHasMine.has(home) || teamHasOpp.has(home);
    const awayExposed = teamHasMine.has(away) || teamHasOpp.has(away);
    if (homeExposed && awayExposed) {
      crossfireTeams.add(home);
      crossfireTeams.add(away);
    }
  });

  playerMap.forEach((player) => {
    const team = canonTeam(player.nflTeam);
    const defs = isOffensiveStarter(player) && player.myShares > 0
      ? Array.from(defsByOpponent.get(team) || [])
      : [];
    player.friendlyFire = defs.length > 0;
    player.friendlyFireDefs = defs;
    player.crossfire = Boolean(team) && crossfireTeams.has(team) && ((player.myShares || 0) > 0 || (player.oppShares || 0) > 0);
  });
}

function friendlyFireNote(player) {
  const teams = (player?.friendlyFireDefs || []).join(', ');
  if (!teams) return '';
  return `Offense vs. starting ${teams} (Cheer for offensive TD: net positive)`;
}

function ExposureFlags({ player, isLight }) {
  if (!player?.friendlyFire && !player?.crossfire) return null;
  const pill = 'inline-flex items-center px-1.5 py-0.5 rounded font-black border text-[9px] leading-tight';
  return (
    <div className="space-y-1 mb-1.5">
      <div className="flex flex-wrap gap-1">
        {player.friendlyFire && (
          <span className={`${pill} ${
            isLight ? 'bg-orange-50 text-orange-800 border-orange-300' : 'bg-orange-950/70 text-orange-300 border-orange-700'
          }`}>
            ⚔️ Friendly Fire
          </span>
        )}
        {player.crossfire && (
          <span className={`${pill} ${
            isLight ? 'bg-violet-50 text-violet-800 border-violet-300' : 'bg-violet-950/70 text-violet-300 border-violet-700'
          }`}>
            ⚡ Crossfire
          </span>
        )}
      </div>
      {player.friendlyFire && (
        <p className={`text-[9px] leading-snug font-semibold break-words ${isLight ? 'text-orange-800' : 'text-orange-200/90'}`}>
          {friendlyFireNote(player)}
        </p>
      )}
    </div>
  );
}

function normalizePosition(pos) {
  const p = String(pos || '').toUpperCase();
  if (p === 'D/ST' || p === 'DST') return 'DEF';
  if (p === 'PK') return 'K';
  return p;
}

function normalizeSlot(slot) {
  const s = String(slot || '').toUpperCase();
  if (s === 'W/R/T' || s === 'WR/TE' || s === 'W/R') return 'FLEX';
  if (s === 'D/ST' || s === 'DST') return 'DEF';
  if (s === 'D') return 'IDP';
  return s;
}

function isDash(line) {
  return DASH_RE.test(String(line || '').trim());
}

function isFloatLine(line) {
  return FLOAT_RE.test(String(line || '').trim());
}

function isGameLine(line) {
  return /^(Sun|Mon|Tue|Wed|Thu|Fri|Sat|Final|Bye)\b/i.test(String(line || '').trim());
}

function isStatLine(line) {
  return /\b(Yds|TD|Rec|Rush|INT|Sack|Tackles?|Fum|Pass)\b/i.test(String(line || '').trim());
}

function isTeamPosLine(line) {
  return TEAM_POS_RE.test(String(line || '').trim());
}

function stripNameNoise(raw) {
  let s = String(raw || '').trim();
  let prev = '';
  while (s && s !== prev) {
    prev = s;
    s = s.replace(NAME_NOISE_SUFFIX_RE, '').trim();
  }
  return s.replace(/\s+/g, ' ').trim();
}

function isNameLine(line) {
  const s = String(line || '').trim();
  if (!s || isDash(s) || isFloatLine(s) || SLOT_TOKEN_RE.test(s) || STOP_SLOT_RE.test(s) || isTeamPosLine(s)) return false;
  if (isGameLine(s) || isStatLine(s)) return false;
  const cleaned = stripNameNoise(s);
  if (cleaned.length < 2 || cleaned.length > 48) return false;
  return /[A-Za-z]/.test(cleaned);
}

function parseTeamPos(line) {
  const match = String(line || '').trim().match(TEAM_POS_RE);
  if (!match) return { nflTeam: '', position: '' };
  return {
    nflTeam: match[1].toUpperCase(),
    position: normalizePosition(match[2])
  };
}

function toStarterRecord(player, side) {
  const isMine = side === 'mine';
  const gameClock = player.gameClock || 'Scheduled';
  return {
    name: player.name,
    nflTeam: player.nflTeam,
    position: player.position,
    slot: player.slot || player.position,
    points: player.points || 0,
    projPoints: player.points || 0,
    actualPoints: player.actualPoints ?? null,
    isLive: /^(1st|2nd|3rd|4th|OT|Q)/i.test(gameClock),
    inRedZone: false,
    gameClock,
    bigPlay: null,
    isStarter: isMine,
    ownership: isMine ? 1.0 : 0,
    isThreat: !isMine,
    opponent: isMine ? null : YAHOO_OPPONENT_NAME
  };
}

function parseMySlotBlock(linesBeforeSlot, slotToken) {
  const lines = (linesBeforeSlot || []).map((l) => String(l).trim()).filter(Boolean);
  let idx = lines.length - 1;
  while (idx >= 0 && isDash(lines[idx])) idx -= 1;

  let points = 0;
  if (idx >= 0 && isFloatLine(lines[idx])) {
    points = parseFloat(lines[idx]);
    idx -= 1;
  }
  while (idx >= 0 && isDash(lines[idx])) idx -= 1;

  let gameClock = 'Scheduled';
  if (idx >= 0 && isGameLine(lines[idx])) {
    gameClock = lines[idx];
    idx -= 1;
  }

  let nflTeam = '';
  let position = normalizeSlot(slotToken);
  if (idx >= 0 && isTeamPosLine(lines[idx])) {
    const parsed = parseTeamPos(lines[idx]);
    nflTeam = parsed.nflTeam;
    position = parsed.position || position;
    idx -= 1;
  }

  let name = '';
  while (idx >= 0) {
    if (isNameLine(lines[idx])) {
      name = stripNameNoise(lines[idx]);
      break;
    }
    idx -= 1;
  }

  return {
    name,
    nflTeam,
    position,
    slot: normalizeSlot(slotToken),
    points,
    gameClock
  };
}

function parseOppSlotBlock(lines, startIndex, slotToken) {
  let i = startIndex;
  while (i < lines.length && isDash(lines[i])) i += 1;

  const nums = [];
  while (i < lines.length && (isFloatLine(lines[i]) || isDash(lines[i]))) {
    if (isFloatLine(lines[i])) nums.push(parseFloat(lines[i]));
    i += 1;
  }

  let actualPoints = null;
  let points = 0;
  if (nums.length >= 2) {
    actualPoints = nums[0];
    points = nums[1];
  } else if (nums.length === 1) {
    points = nums[0];
  }

  let name = '';
  if (i < lines.length && isNameLine(lines[i])) {
    name = stripNameNoise(lines[i]);
    i += 1;
  }

  let nflTeam = '';
  let position = normalizeSlot(slotToken);
  if (i < lines.length && isTeamPosLine(lines[i])) {
    const parsed = parseTeamPos(lines[i]);
    nflTeam = parsed.nflTeam;
    position = parsed.position || position;
    i += 1;
  }

  let gameClock = 'Scheduled';
  if (i < lines.length && isGameLine(lines[i])) {
    gameClock = lines[i];
    i += 1;
  }
  while (i < lines.length && isStatLine(lines[i])) i += 1;

  return {
    player: {
      name,
      nflTeam,
      position,
      slot: normalizeSlot(slotToken),
      points,
      actualPoints,
      gameClock
    },
    nextIndex: i
  };
}

function parseYahooMatchupText(raw) {
  const lines = String(raw || '')
    .replace(/\r/g, '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

  const myStarters = [];
  const oppStarters = [];
  let cursor = 0;

  while (cursor < lines.length) {
    if (STOP_SLOT_RE.test(lines[cursor])) break;

    const slotIdx = lines.findIndex((line, idx) => idx >= cursor && SLOT_TOKEN_RE.test(line));
    if (slotIdx === -1) break;

    const slotToken = lines[slotIdx];
    const mine = parseMySlotBlock(lines.slice(cursor, slotIdx), slotToken);
    const { player: opp, nextIndex } = parseOppSlotBlock(lines, slotIdx + 1, slotToken);

    if (mine.name) myStarters.push(toStarterRecord(mine, 'mine'));
    if (opp.name) oppStarters.push(toStarterRecord(opp, 'opp'));

    cursor = Math.max(nextIndex, slotIdx + 1);
    if (cursor <= slotIdx) cursor = slotIdx + 1;
  }

  return {
    myTeamName: 'My Team',
    oppTeamName: YAHOO_OPPONENT_NAME,
    myScore: undefined,
    oppScore: undefined,
    myStarters,
    oppStarters
  };
}

const HEADSHOT_INDEX_KEY = 'rootmap_sleeper_headshot_index_v1';
const HEADSHOT_INDEX_AT_KEY = 'rootmap_sleeper_headshot_index_at';
const HEADSHOT_INDEX_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const SLEEPER_PLAYERS_URL = 'https://api.sleeper.app/v1/players/nfl';

const NFL_TEAM_SECONDARY = {
  ARI: { bg: '#A5ACAF', fg: '#111111' },
  ATL: { bg: '#A71930', fg: '#FFFFFF' },
  BAL: { bg: '#9E7C0C', fg: '#FFFFFF' },
  BUF: { bg: '#C60C30', fg: '#FFFFFF' },
  CAR: { bg: '#BFC0BF', fg: '#0085CA' },
  CHI: { bg: '#C83803', fg: '#FFFFFF' },
  CIN: { bg: '#FB4F14', fg: '#111111' },
  CLE: { bg: '#FF3C00', fg: '#FFFFFF' },
  DAL: { bg: '#869397', fg: '#041E42' },
  DEN: { bg: '#FB4F14', fg: '#FFFFFF' },
  DET: { bg: '#B0B7BC', fg: '#0076B6' },
  GB: { bg: '#FFB612', fg: '#203731' },
  HOU: { bg: '#A71930', fg: '#FFFFFF' },
  IND: { bg: '#A2AAAD', fg: '#002C5F' },
  JAX: { bg: '#D7A22A', fg: '#111111' },
  KC: { bg: '#FFB81C', fg: '#E31837' },
  LAC: { bg: '#FFC20E', fg: '#0080C6' },
  LAR: { bg: '#FFA300', fg: '#003594' },
  LV: { bg: '#A5ACAF', fg: '#111111' },
  MIA: { bg: '#FC4C02', fg: '#FFFFFF' },
  MIN: { bg: '#FFC62F', fg: '#4F2683' },
  NE: { bg: '#C60C30', fg: '#FFFFFF' },
  NO: { bg: '#D3BC8D', fg: '#101820' },
  NYG: { bg: '#A71930', fg: '#FFFFFF' },
  NYJ: { bg: '#FFFFFF', fg: '#125740' },
  PHI: { bg: '#A5ACAF', fg: '#004C54' },
  PIT: { bg: '#FFB612', fg: '#101820' },
  SEA: { bg: '#69BE28', fg: '#002244' },
  SF: { bg: '#B3995D', fg: '#AA0000' },
  TB: { bg: '#34302B', fg: '#FF7900' },
  TEN: { bg: '#4B92DB', fg: '#0C2340' },
  WAS: { bg: '#FFB612', fg: '#5A1414' },
  WSH: { bg: '#FFB612', fg: '#5A1414' }
};

let headshotIndexMemory = null;

function normalizePlayerName(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/['’.]/g, '')
    .replace(/\b(jr|sr|ii|iii|iv|v)\b/g, '')
    .replace(/[^a-z0-9\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function getPlayerInitials(playerName) {
  const parts = String(playerName || '')
    .replace(/\b(Jr|Sr|II|III|IV)\.?/g, '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!parts.length) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

function getTeamAccent(team) {
  const key = String(team || '').toUpperCase();
  return NFL_TEAM_SECONDARY[key] || { bg: '#334155', fg: '#E2E8F0' };
}

function readCachedHeadshotIndex() {
  if (headshotIndexMemory) return headshotIndexMemory;
  try {
    const storedAt = Number(localStorage.getItem(HEADSHOT_INDEX_AT_KEY) || 0);
    if (storedAt && Date.now() - storedAt < HEADSHOT_INDEX_TTL_MS) {
      const raw = localStorage.getItem(HEADSHOT_INDEX_KEY);
      if (raw) {
        headshotIndexMemory = JSON.parse(raw);
        return headshotIndexMemory;
      }
    }
  } catch {
    // ignore cache read errors
  }
  return null;
}

function buildHeadshotIndex(directory) {
  const index = {};
  Object.entries(directory || {}).forEach(([id, player]) => {
    if (!player || player.sport && player.sport !== 'nfl') return;
    const fullName = player.full_name || `${player.first_name || ''} ${player.last_name || ''}`.trim();
    if (!fullName) return;
    const nameKey = normalizePlayerName(fullName);
    if (!nameKey) return;
    const team = String(player.team || '').toUpperCase();
    const rank = Number(player.search_rank) || 99999;
    const entry = { id, espn: player.espn_id || null, rank };

    const nameHit = index[nameKey];
    if (!nameHit || rank < nameHit.rank) index[nameKey] = entry;
    if (team) {
      const teamKey = `${nameKey}|${team}`;
      const teamHit = index[teamKey];
      if (!teamHit || rank < teamHit.rank) index[teamKey] = entry;
    }
  });
  return index;
}

async function ensureHeadshotIndex() {
  const cached = readCachedHeadshotIndex();
  if (cached) return cached;
  const res = await fetch(SLEEPER_PLAYERS_URL);
  if (!res.ok) throw new Error('Sleeper player directory unavailable');
  const directory = await res.json();
  const index = buildHeadshotIndex(directory);
  headshotIndexMemory = index;
  try {
    localStorage.setItem(HEADSHOT_INDEX_KEY, JSON.stringify(index));
    localStorage.setItem(HEADSHOT_INDEX_AT_KEY, String(Date.now()));
  } catch {
    // quota — memory cache still works this session
  }
  return index;
}

function lookupHeadshotRecord(playerName, team) {
  const index = headshotIndexMemory || readCachedHeadshotIndex();
  if (!index) return null;
  const nameKey = normalizePlayerName(playerName);
  if (!nameKey) return null;
  const teamKey = String(team || '').toUpperCase();
  return (teamKey && index[`${nameKey}|${teamKey}`]) || index[nameKey] || null;
}

function getPlayerHeadshot(playerName, team) {
  const hit = lookupHeadshotRecord(playerName, team);
  if (!hit?.id) return null;
  if (/^[A-Z]{2,3}$/.test(hit.id)) {
    return `https://sleepercdn.com/images/team_logos/nfl/${hit.id.toLowerCase()}.png`;
  }
  return `https://sleepercdn.com/content/nfl/players/thumb/${hit.id}.jpg`;
}

function getPlayerHeadshotCandidates(playerName, team) {
  const hit = lookupHeadshotRecord(playerName, team);
  const urls = [];
  const primary = getPlayerHeadshot(playerName, team);
  if (primary) urls.push(primary);
  if (hit?.id && !/^[A-Z]{2,3}$/.test(hit.id)) {
    urls.push(`https://sleepercdn.com/content/nfl/players/${hit.id}.jpg`);
  }
  if (hit?.espn) {
    urls.push(`https://a.espncdn.com/combiner/i?img=/i/headshots/nfl/players/full/${hit.espn}.png&w=96&h=96`);
  }
  return [...new Set(urls)];
}

function PlayerHeadshot({ name, team, size = 40 }) {
  const candidates = getPlayerHeadshotCandidates(name, team);
  const [urlIndex, setUrlIndex] = useState(0);
  const [failed, setFailed] = useState(false);
  const src = !failed ? candidates[urlIndex] : null;
  const initials = getPlayerInitials(name);
  const accent = getTeamAccent(team);
  const px = `${size}px`;

  useEffect(() => {
    setUrlIndex(0);
    setFailed(false);
  }, [name, team, candidates[0]]);

  if (!src || failed) {
    return (
      <div
        className="rounded-full shrink-0 flex items-center justify-center font-black select-none ring-1 ring-black/10"
        style={{
          width: px,
          height: px,
          backgroundColor: accent.bg,
          color: accent.fg,
          fontSize: size <= 40 ? 11 : 12,
          letterSpacing: '-0.02em'
        }}
        aria-hidden="true"
      >
        {initials}
      </div>
    );
  }

  return (
    <div
      className="rounded-full shrink-0 overflow-hidden bg-slate-800 ring-1 ring-black/15"
      style={{ width: px, height: px }}
    >
      <img
        src={src}
        alt=""
        width={size}
        height={size}
        loading="lazy"
        decoding="async"
        onError={() => {
          if (urlIndex < candidates.length - 1) setUrlIndex((n) => n + 1);
          else setFailed(true);
        }}
        className="w-full h-full object-cover object-top"
      />
    </div>
  );
}

export default function App() {
  const [theme, setTheme] = useState('dark');
  const [view, setView] = useState('matchups');
  const [sortMode, setSortMode] = useState('exposure');
  const [leagues, setLeagues] = useState(loadStoredLeagues);
  const [games, setGames] = useState(() => getActiveSlate().games);
  const [slateMeta, setSlateMeta] = useState(() => {
    const slate = getActiveSlate();
    return { week: slate.week, label: slate.label, range: slate.range, byes: slate.byes || [] };
  });
  const [leaguePendingDelete, setLeaguePendingDelete] = useState(null);
  const [selectedPlayer, setSelectedPlayer] = useState(null);
  const [hoveredConflictPlayer, setHoveredConflictPlayer] = useState(null);
  const [activeLeagueDrawer, setActiveLeagueDrawer] = useState(null);
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncStatus, setSyncStatus] = useState('');
  const [rawYahooDebug, setRawYahooDebug] = useState(null);
  const [showYahooIngest, setShowYahooIngest] = useState(false);
  const [yahooPaste, setYahooPaste] = useState('');
  const [yahooIngestError, setYahooIngestError] = useState('');
  const [yahooLeagueName, setYahooLeagueName] = useState('');
  const [activeLeagueTab, setActiveLeagueTab] = useState('combined');
  const [headshotTick, setHeadshotTick] = useState(0);
  const [showLegend, setShowLegend] = useState(false);
  const [showLeagueFilter, setShowLeagueFilter] = useState(false);
  const [hiddenLeagueIds, setHiddenLeagueIds] = useState(() => new Set());
  const [filterPos, setFilterPos] = useState({ top: 96, left: 12 });

  const containerRef = useRef(null);
  const filterButtonRef = useRef(null);
  const leftCardRefs = useRef({});
  const rightCardRefs = useRef({});
  const [connectors, setConnectors] = useState([]);

  const isLight = theme === 'light';

  const triggerSyncWithToken = async (accessToken) => {
    setIsSyncing(true);
    setSyncStatus('Authenticated! Querying Yahoo Fantasy API...');

    try {
      const res = await fetch('/api/sync', {
        headers: { Authorization: `Bearer ${accessToken}` }
      });
      const json = await res.json();
      setRawYahooDebug(json);
      setSyncStatus('Sync data received! Check diagnostic payload below.');
    } catch (err) {
      console.error('Sync failed:', err);
      setSyncStatus('Error communicating with Yahoo API.');
    } finally {
      setIsSyncing(false);
    }
  };

  useEffect(() => {
    // 1. Check if token was saved via direct redirect
    const savedToken = localStorage.getItem('yahoo_access_token');
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('auth') === 'yahoo_success' && savedToken) {
      triggerSyncWithToken(savedToken);
      // Clean query string
      window.history.replaceState({}, document.title, window.location.pathname);
    }

    // 2. Check if token arrived via popup message
    const handleAuthMessage = async (event) => {
      if (event.data?.type === 'YAHOO_AUTH_SUCCESS' && event.data?.accessToken) {
        localStorage.setItem('yahoo_access_token', event.data.accessToken);
        triggerSyncWithToken(event.data.accessToken);
      }
    };

    window.addEventListener('message', handleAuthMessage);
    return () => window.removeEventListener('message', handleAuthMessage);
  }, []);

  const handleConnectYahoo = () => {
    window.location.href = '/api/auth/yahoo';
  };

  const refreshLiveSlate = async () => {
    try {
      const slate = await fetchLiveNFLSlate();
      if (Array.isArray(slate?.games) && slate.games.length > 0) {
        setGames(slate.games);
        setSlateMeta({
          week: slate.week,
          label: slate.label,
          range: slate.range,
          byes: slate.byes || []
        });
      }
    } catch (err) {
      console.warn('Scoreboard fetch error:', err);
    }
  };

  useEffect(() => {
    refreshLiveSlate();
    const interval = setInterval(refreshLiveSlate, 60000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    let cancelled = false;
    ensureHeadshotIndex()
      .then(() => {
        if (!cancelled) setHeadshotTick((n) => n + 1);
      })
      .catch(() => {
        // Initials fallback remains if the directory cannot load
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(LEAGUES_STORAGE_KEY, JSON.stringify(leagues));
    } catch {
      // ignore quota / private-mode failures
    }
  }, [leagues]);

  useEffect(() => {
    if (!showLegend && !showLeagueFilter && !leaguePendingDelete) return undefined;
    const onKey = (event) => {
      if (event.key !== 'Escape') return;
      if (leaguePendingDelete) {
        setLeaguePendingDelete(null);
        return;
      }
      setShowLegend(false);
      setShowLeagueFilter(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [showLegend, showLeagueFilter, leaguePendingDelete]);

  const confirmRemoveLeague = () => {
    if (!leaguePendingDelete) return;
    const id = leaguePendingDelete.id;
    setLeagues((prev) => prev.filter((lg) => lg.id !== id));
    setHiddenLeagueIds((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
    if (activeLeagueTab === id) setActiveLeagueTab('combined');
    if (activeLeagueDrawer?.id === id) setActiveLeagueDrawer(null);
    setLeaguePendingDelete(null);
  };

  useEffect(() => {
    if (!showLeagueFilter) return undefined;
    const place = () => {
      const rect = filterButtonRef.current?.getBoundingClientRect();
      if (!rect) return;
      const width = 288;
      const left = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8));
      setFilterPos({ top: rect.bottom + 8, left });
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [showLeagueFilter]);

  const toggleLeagueFilter = () => {
    if (showLeagueFilter) {
      setShowLeagueFilter(false);
      return;
    }
    const rect = filterButtonRef.current?.getBoundingClientRect();
    if (rect) {
      const width = 288;
      const left = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8));
      setFilterPos({ top: rect.bottom + 8, left });
    }
    setShowLeagueFilter(true);
  };

  const toggleLeagueVisibility = (leagueId) => {
    setHiddenLeagueIds((prev) => {
      const next = new Set(prev);
      if (next.has(leagueId)) next.delete(leagueId);
      else next.add(leagueId);
      return next;
    });
  };

  const openYahooIngest = () => {
    setYahooIngestError('');
    setYahooLeagueName(`League ${leagues.length + 1}`);
    setShowYahooIngest(true);
  };

  const handleImportYahooMatchup = () => {
    const parsed = parseYahooMatchupText(yahooPaste);
    if (!parsed.myStarters.length && !parsed.oppStarters.length) {
      setYahooIngestError('No players found. Copy the full Yahoo Matchup page (Ctrl+A, Ctrl+C) and paste again.');
      return;
    }

    const fallbackName = parsed.myTeamName && parsed.myTeamName !== 'My Team'
      ? parsed.myTeamName
      : `League ${leagues.length + 1}`;
    const leagueName = yahooLeagueName.trim() || fallbackName;
    const imported = normalizeLeague({
      id: `lg_${Date.now()}`,
      name: leagueName,
      myTeamName: leagueName,
      oppTeamName: parsed.oppTeamName || YAHOO_OPPONENT_NAME,
      platform: 'Yahoo',
      myScore: parsed.myScore || 0,
      oppScore: parsed.oppScore || 0,
      portfolio: parsed.myStarters,
      threats: parsed.oppStarters
    }, leagues.length);

    setLeagues((prev) => [...prev, imported]);
    setActiveLeagueTab(imported.id);
    setView('matchups');
    setYahooIngestError('');
    setYahooPaste('');
    setYahooLeagueName('');
    setShowYahooIngest(false);
    setSyncStatus(`Imported ${parsed.myStarters.length} starters and ${parsed.oppStarters.length} threats into ${leagueName}.`);
  };

  const visibleLeagues = useMemo(
    () => leagues.filter((lg) => !hiddenLeagueIds.has(lg.id)),
    [leagues, hiddenLeagueIds]
  );

  const hiddenCount = leagues.length - visibleLeagues.length;

  const totalNetDelta = useMemo(() => {
    return visibleLeagues.reduce((acc, lg) => acc + ((lg.myScore || 0) - (lg.oppScore || 0)), 0);
  }, [visibleLeagues]);

  const isCombinedTab = activeLeagueTab === 'combined';

  const scopedLeagues = useMemo(() => {
    if (isCombinedTab) return visibleLeagues;
    const one = leagues.find((lg) => lg.id === activeLeagueTab);
    return one ? [one] : visibleLeagues;
  }, [leagues, activeLeagueTab, isCombinedTab, visibleLeagues]);

  const defenseLeagues = useMemo(() => {
    if (isCombinedTab) return visibleLeagues;
    const byId = new Map(visibleLeagues.map((lg) => [lg.id, lg]));
    scopedLeagues.forEach((lg) => byId.set(lg.id, lg));
    return Array.from(byId.values());
  }, [isCombinedTab, visibleLeagues, scopedLeagues]);

  const playerMasterIndex = useMemo(
    () => buildPlayerMasterIndex(scopedLeagues, games, defenseLeagues),
    [scopedLeagues, games, defenseLeagues]
  );
  const combinedPlayerIndex = useMemo(
    () => buildPlayerMasterIndex(visibleLeagues, games),
    [visibleLeagues, games]
  );

  const sortComparator = (a, b, isLeftColumn) => {
    if (sortMode === 'live') {
      if (a.isLive !== b.isLive) return a.isLive ? -1 : 1;
    }
    if (sortMode === 'redzone') {
      if (a.inRedZone !== b.inRedZone) return a.inRedZone ? -1 : 1;
      if (a.isLive !== b.isLive) return a.isLive ? -1 : 1;
    }
    if (sortMode === 'conflict') {
      const exposureConflict = (p) => (
        (p.myShares > 0 && p.oppShares > 0) || p.friendlyFire || p.crossfire
      ) ? 1 : 0;
      const aConflict = exposureConflict(a);
      const bConflict = exposureConflict(b);
      if (aConflict !== bConflict) return bConflict - aConflict;
    }
    const aShares = isLeftColumn ? a.myShares : a.oppShares;
    const bShares = isLeftColumn ? b.myShares : b.oppShares;
    return bShares - aShares;
  };

  const myPortfolio = useMemo(() => {
    return Array.from(playerMasterIndex.values())
      .filter(p => p.myShares > 0)
      .sort((a, b) => sortComparator(a, b, true));
  }, [playerMasterIndex, sortMode]);

  const oppThreats = useMemo(() => {
    return Array.from(playerMasterIndex.values())
      .filter(p => p.oppShares > 0)
      .sort((a, b) => sortComparator(a, b, false));
  }, [playerMasterIndex, sortMode]);

  const updateConnectors = () => {
    if (!containerRef.current) return;
    const containerRect = containerRef.current.getBoundingClientRect();
    const lines = [];

    myPortfolio.forEach(player => {
      if (player.oppShares > 0) {
        const leftEl = leftCardRefs.current[player.name];
        const rightEl = rightCardRefs.current[player.name];

        if (leftEl && rightEl) {
          const lRect = leftEl.getBoundingClientRect();
          const rRect = rightEl.getBoundingClientRect();

          const x1 = lRect.right - containerRect.left;
          const y1 = lRect.top + lRect.height / 2 - containerRect.top;
          const x2 = rRect.left - containerRect.left;
          const y2 = rRect.top + rRect.height / 2 - containerRect.top;

          lines.push({ name: player.name, x1, y1, x2, y2 });
        }
      }
    });

    setConnectors(lines);
  };

  useLayoutEffect(() => {
    if (view === 'matchups') {
      updateConnectors();
      const timer = setTimeout(updateConnectors, 60);
      window.addEventListener('resize', updateConnectors);
      return () => {
        clearTimeout(timer);
        window.removeEventListener('resize', updateConnectors);
      };
    }
  }, [view, sortMode, theme, myPortfolio, oppThreats, activeLeagueTab]);

  const getGamePlayers = (game) => {
    if (!game) return [];
    const home = canonTeam(game.home);
    const away = canonTeam(game.away);
    return Array.from(combinedPlayerIndex.values()).filter(
      (p) => p.myShares > 0 && (canonTeam(p.nflTeam) === away || canonTeam(p.nflTeam) === home)
    );
  };

  const renderStance = (player, column, isConflict) => {
    const stance = getCombinedStance(player, column);
    if (stance?.tone === 'hedge') {
      return <span className="text-amber-500 font-black uppercase tracking-wide text-right leading-tight">Hedged / Wash</span>;
    }
    if (stance?.tone === 'down' || stance?.tone === 'pure') {
      return (
        <span className={`font-black text-right leading-tight ${isLight ? 'text-emerald-700' : 'text-emerald-300'}`}>
          {stance.label}
        </span>
      );
    }
    if (stance?.tone === 'threat') {
      return (
        <span className={`font-black text-right leading-tight ${isLight ? 'text-rose-700' : 'text-rose-300'}`}>
          {stance.label}
        </span>
      );
    }
    if (isConflict && column === 'mine') {
      return <span className="text-amber-600 font-bold">v {player.oppShares} Opp</span>;
    }
    if (isConflict) {
      return <span className="text-amber-600 font-bold">CONFLICTED ({player.myShares}x)</span>;
    }
    return null;
  };

  return (
    <div className={`min-h-screen pb-28 font-sans select-none transition-colors duration-200 ${
      isLight ? 'bg-slate-100 text-slate-800' : 'bg-slate-950 text-slate-100'
    }`}>
      <div className={`sticky top-0 z-40 max-w-md mx-auto ${isLight ? 'bg-white/95' : 'bg-slate-950/95'} backdrop-blur-md`}>
      {/* Top Header */}
      <header className={`border-b px-3 py-2.5 flex flex-wrap items-center justify-between gap-2 transition-colors ${
        isLight ? 'border-slate-200 shadow-sm' : 'border-slate-800/80'
      }`}>
        <div className="flex items-center gap-2 min-w-0">
          <RootMapLogo className="w-8 h-8 shrink-0" showWordmark={true} />
          <button
            onClick={() => setShowLegend(true)}
            className={`px-2 py-1 rounded-lg text-[10px] font-black border whitespace-nowrap transition ${
              isLight
                ? 'bg-emerald-50 text-emerald-800 border-emerald-300 hover:bg-emerald-100'
                : 'bg-emerald-950/70 text-emerald-300 border-emerald-700 hover:bg-emerald-900/80'
            }`}
            aria-haspopup="dialog"
          >
            ⓘ Legend
          </button>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={openYahooIngest}
            className={`px-2 py-1 rounded-lg text-[10px] font-black border whitespace-nowrap transition ${
              isLight
                ? 'bg-purple-50 text-purple-700 border-purple-300 hover:bg-purple-100'
                : 'bg-purple-950/70 text-purple-300 border-purple-700 hover:bg-purple-900/80'
            }`}
          >
            Import Yahoo Matchup
          </button>
          <button
            onClick={() => setTheme(prev => prev === 'dark' ? 'light' : 'dark')}
            className={`px-2 py-1 rounded-lg text-xs font-bold border transition ${
              isLight 
                ? 'bg-slate-100 text-slate-700 border-slate-300 hover:bg-slate-200' 
                : 'bg-slate-900 text-slate-300 border-slate-700 hover:bg-slate-800'
            }`}
          >
            {isLight ? '🌙 Dark' : '☀️ Light'}
          </button>

          <div className={`px-2.5 py-1 rounded-full text-xs font-black font-mono border ${
            totalNetDelta >= 0 
              ? isLight ? 'bg-emerald-50 text-emerald-700 border-emerald-300' : 'bg-emerald-950/80 text-emerald-400 border-emerald-700/60'
              : isLight ? 'bg-rose-50 text-rose-700 border-rose-300' : 'bg-rose-950/80 text-rose-400 border-rose-700/60'
          }`}>
            {totalNetDelta >= 0 ? `+${totalNetDelta.toFixed(1)}` : totalNetDelta.toFixed(1)}
          </div>
        </div>
      </header>

      <div className={`border-b ${
        isLight ? 'border-slate-200' : 'border-slate-800'
      }`}>
        <div className="flex items-center gap-1.5 px-3 py-2">
          <button
            ref={filterButtonRef}
            onClick={toggleLeagueFilter}
            aria-expanded={showLeagueFilter}
            aria-haspopup="dialog"
            className={`shrink-0 inline-flex items-center gap-1 px-2.5 py-1.5 rounded-full text-[10px] font-black whitespace-nowrap border transition ${
              showLeagueFilter || hiddenCount > 0
                ? isLight ? 'bg-emerald-600 text-white border-emerald-600' : 'bg-emerald-950 text-emerald-300 border-emerald-600'
                : isLight ? 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50' : 'bg-slate-900 text-slate-200 border-slate-600 hover:bg-slate-800'
            }`}
          >
            <svg viewBox="0 0 16 16" className="w-3 h-3" aria-hidden="true">
              <path d="M1.5 2.5h13l-5 6.2v4.3l-3 1.5V8.7L1.5 2.5z" fill="currentColor" />
            </svg>
            Filter Leagues
            {hiddenCount > 0 && (
              <span className={`font-mono ${isLight ? 'text-emerald-50' : 'text-emerald-200'}`}>
                {visibleLeagues.length}/{leagues.length}
              </span>
            )}
          </button>
          <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-none min-w-0">
          <button
            onClick={() => setActiveLeagueTab('combined')}
            className={`px-2.5 py-1.5 rounded-full text-[10px] font-black whitespace-nowrap border transition ${
              isCombinedTab
                ? isLight ? 'bg-slate-900 text-white border-slate-900' : 'bg-emerald-950 text-emerald-300 border-emerald-600'
                : isLight ? 'bg-slate-50 text-slate-600 border-slate-200' : 'bg-slate-900 text-slate-400 border-slate-700'
            }`}
          >
            {hiddenCount > 0
              ? `Combined Rooting (${visibleLeagues.length}/${leagues.length})`
              : 'Combined Rooting (All Leagues)'}
          </button>
          {leagues.map((lg) => {
            const selected = activeLeagueTab === lg.id;
            const hidden = hiddenLeagueIds.has(lg.id);
            const leagueName = getLeagueDisplayName(lg);
            return (
              <div
                key={lg.id}
                className={`inline-flex items-center shrink-0 rounded-full border overflow-hidden ${
                  hidden ? 'opacity-45' : ''
                } ${
                  selected
                    ? isLight ? 'border-purple-600' : 'border-purple-500'
                    : isLight ? 'border-slate-200' : 'border-slate-700'
                }`}
              >
                <button
                  onClick={() => setActiveLeagueTab(lg.id)}
                  title={hidden ? 'Off the combined board' : leagueName}
                  className={`px-2.5 py-1.5 text-[10px] font-black whitespace-nowrap transition ${
                    selected
                      ? isLight ? 'bg-purple-600 text-white' : 'bg-purple-950 text-purple-200'
                      : isLight ? 'bg-white text-slate-600' : 'bg-slate-900 text-slate-400'
                  }`}
                >
                  {leagueName}
                </button>
                <button
                  type="button"
                  aria-label={`Remove ${leagueName}`}
                  title={`Remove ${leagueName}`}
                  onClick={() => setLeaguePendingDelete(lg)}
                  className={`px-1.5 py-1.5 border-l transition ${
                    selected
                      ? isLight ? 'border-purple-500 text-white hover:bg-purple-700' : 'border-purple-700 text-rose-200 hover:bg-rose-950/80'
                      : isLight ? 'border-slate-200 text-rose-600 hover:bg-rose-50' : 'border-slate-700 text-rose-400 hover:bg-rose-950/60'
                  }`}
                >
                  <TrashIcon />
                </button>
              </div>
            );
          })}
          <button
            onClick={openYahooIngest}
            className={`px-2.5 py-1.5 rounded-full text-[10px] font-black whitespace-nowrap border transition ${
              isLight ? 'bg-purple-50 text-purple-700 border-purple-300 hover:bg-purple-100' : 'bg-purple-950/50 text-purple-300 border-purple-700 hover:bg-purple-900/70'
            }`}
          >
            + Import Another League
          </button>
          </div>
        </div>
      </div>
      </div>

      {/* Main Container */}
      <main className="max-w-md mx-auto p-3 space-y-3">
        {syncStatus && (
          <div className="bg-purple-950/90 text-purple-200 border border-purple-700 px-3 py-2.5 rounded-xl text-xs font-mono font-bold text-center shadow-lg">
            {syncStatus}
          </div>
        )}

        {/* Diagnostic Inspector */}
        <SyncInspector data={rawYahooDebug} onClose={() => setRawYahooDebug(null)} />

        {/* VIEW 1: MATCHUPS */}
        {view === 'matchups' && leagues.length === 0 && (
          <div className={`rounded-2xl p-5 border text-center space-y-3 shadow-sm ${
            isLight ? 'bg-white border-slate-200' : 'bg-slate-900 border-slate-800'
          }`}>
            <div className={`text-sm font-black ${isLight ? 'text-slate-900' : 'text-white'}`}>
              Sync your first league via the extension or import tool
            </div>
            <p className={`text-xs leading-relaxed ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>
              RootMap starts empty. Import a Yahoo matchup here, or sync from the RootMap extension on your Yahoo Fantasy matchup page.
            </p>
            <button
              onClick={openYahooIngest}
              className="px-3.5 py-2 rounded-xl bg-purple-600 hover:bg-purple-500 text-white text-xs font-black shadow-lg transition"
            >
              Import Yahoo Matchup
            </button>
          </div>
        )}
        {view === 'matchups' && leagues.length > 0 && (
          <div className="space-y-3">
            <div className="space-y-2">
              <div className="flex justify-between items-center px-1">
                <div className={`text-xs font-black uppercase tracking-wider ${isLight ? 'text-slate-700' : 'text-slate-300'}`}>
                  {isCombinedTab ? 'Combined Rooting' : getLeagueDisplayName(scopedLeagues[0])}
                </div>
                <div className={`text-[11px] font-mono font-bold ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>
                  {myPortfolio.length} Active • {oppThreats.length} Threats
                </div>
              </div>

              <div className="flex gap-1.5 overflow-x-auto pb-1 scrollbar-none text-[11px] font-bold">
                <button
                  onClick={() => setSortMode('exposure')}
                  className={`px-2.5 py-1 rounded-lg border whitespace-nowrap transition ${
                    sortMode === 'exposure'
                      ? isLight ? 'bg-slate-900 text-white border-slate-900 shadow-sm' : 'bg-slate-800 text-white border-slate-600 shadow-sm'
                      : isLight ? 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50' : 'bg-slate-900/60 text-slate-400 border-slate-800 hover:text-slate-200'
                  }`}
                >
                  ⚡ Exposure
                </button>
                <button
                  onClick={() => setSortMode('live')}
                  className={`px-2.5 py-1 rounded-lg border whitespace-nowrap transition ${
                    sortMode === 'live'
                      ? isLight ? 'bg-emerald-600 text-white border-emerald-600 shadow-sm' : 'bg-emerald-950 text-emerald-400 border-emerald-700 shadow-sm'
                      : isLight ? 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50' : 'bg-slate-900/60 text-slate-400 border-slate-800 hover:text-slate-200'
                  }`}
                >
                  🟢 Live On Field
                </button>
                <button
                  onClick={() => setSortMode('redzone')}
                  className={`px-2.5 py-1 rounded-lg border whitespace-nowrap transition ${
                    sortMode === 'redzone'
                      ? isLight ? 'bg-rose-600 text-white border-rose-600 shadow-sm' : 'bg-rose-950 text-rose-400 border-rose-700 shadow-sm'
                      : isLight ? 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50' : 'bg-slate-900/60 text-slate-400 border-slate-800 hover:text-slate-200'
                  }`}
                >
                  🔴 Red Zone
                </button>
                <button
                  onClick={() => setSortMode('conflict')}
                  className={`px-2.5 py-1 rounded-lg border whitespace-nowrap transition ${
                    sortMode === 'conflict'
                      ? isLight ? 'bg-amber-500 text-slate-900 border-amber-500 font-black shadow-sm' : 'bg-amber-950 text-amber-400 border-amber-700 shadow-sm'
                      : isLight ? 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50' : 'bg-slate-900/60 text-slate-400 border-slate-800 hover:text-slate-200'
                  }`}
                >
                  🔀 Conflicted First
                </button>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4 text-center text-xs font-black tracking-wider uppercase">
              <div className={`rounded-xl py-2 px-1 flex flex-col items-center justify-center border shadow-sm transition ${
                isLight ? 'bg-emerald-50 border-emerald-200 text-emerald-800' : 'bg-slate-900 border-emerald-500/30 text-emerald-400'
              }`}>
                <span>Your Portfolio</span>
                <span className={`text-[10px] font-normal ${isLight ? 'text-emerald-700' : 'text-slate-400'}`}>
                  ({myPortfolio.length} Active)
                </span>
              </div>
              <div className={`rounded-xl py-2 px-1 flex flex-col items-center justify-center border shadow-sm transition ${
                isLight ? 'bg-rose-50 border-rose-200 text-rose-800' : 'bg-slate-900 border-rose-500/30 text-rose-400'
              }`}>
                <span>Opposition Threats</span>
                <span className={`text-[10px] font-normal ${isLight ? 'text-rose-700' : 'text-slate-400'}`}>
                  ({oppThreats.length} Total)
                </span>
              </div>
            </div>

            {myPortfolio.length === 0 && oppThreats.length === 0 && (
              <div className={`rounded-2xl px-3 py-4 text-center text-xs font-semibold border ${
                isLight ? 'bg-white border-slate-200 text-slate-500' : 'bg-slate-900 border-slate-800 text-slate-400'
              }`}>
                {isCombinedTab && visibleLeagues.length === 0
                  ? 'Every league is filtered out. Turn one back on in Filter Leagues. Saved rosters stay on this device.'
                  : 'No starters in this view.'}
              </div>
            )}

            <div ref={containerRef} className="relative">
              <svg className="pointer-events-none absolute inset-0 w-full h-full z-20 overflow-visible">
                <defs>
                  <linearGradient id="conflictWireGrad" x1="0%" y1="0%" x2="100%" y2="0%">
                    <stop offset="0%" stopColor="#10b981" stopOpacity="0.8" />
                    <stop offset="50%" stopColor="#f59e0b" stopOpacity="1" />
                    <stop offset="100%" stopColor="#f43f5e" stopOpacity="0.8" />
                  </linearGradient>
                  <filter id="wireGlow" x="-20%" y="-20%" width="140%" height="140%">
                    <feDropShadow dx="0" dy="0" stdDeviation="2.5" floodColor="#f59e0b" floodOpacity="0.7"/>
                  </filter>
                </defs>

                {connectors.map((c) => {
                  const isHovered = hoveredConflictPlayer === c.name || selectedPlayer?.name === c.name;
                  const dx = (c.x2 - c.x1) * 0.55;
                  const pathData = `M ${c.x1} ${c.y1} C ${c.x1 + dx} ${c.y1}, ${c.x2 - dx} ${c.y2}, ${c.x2} ${c.y2}`;

                  return (
                    <g key={c.name}>
                      <path
                        d={pathData}
                        fill="none"
                        stroke={isHovered ? "#f59e0b" : "url(#conflictWireGrad)"}
                        strokeWidth={isHovered ? 3.5 : 2}
                        strokeDasharray={isHovered ? "none" : "3,3"}
                        strokeOpacity={isHovered ? 1 : 0.75}
                        filter={isHovered ? "url(#wireGlow)" : undefined}
                      />
                      <circle cx={c.x1} cy={c.y1} r={isHovered ? 3.5 : 2.5} fill="#10b981" />
                      <circle cx={c.x2} cy={c.y2} r={isHovered ? 3.5 : 2.5} fill="#f43f5e" />
                    </g>
                  );
                })}
              </svg>

              <div className="grid grid-cols-2 gap-4 relative z-10">
                <div className="space-y-2">
                  {myPortfolio.map((player) => {
                    const isConflict = player.oppShares > 0;
                    const isHovered = hoveredConflictPlayer === player.name;
                    return (
                      <div
                        key={`my_${player.name}`}
                        data-player-name={player.name}
                        data-friendly-fire={player.friendlyFire ? 'true' : 'false'}
                        ref={(el) => { leftCardRefs.current[player.name] = el; }}
                        onClick={() => setSelectedPlayer(player)}
                        onMouseEnter={() => isConflict && setHoveredConflictPlayer(player.name)}
                        onMouseLeave={() => setHoveredConflictPlayer(null)}
                        className={`relative rounded-xl p-2.5 transition active:scale-[0.98] cursor-pointer border shadow-sm ${
                          isLight
                            ? isConflict
                              ? isHovered
                                ? 'bg-amber-50 border-amber-400 ring-2 ring-amber-300'
                                : 'bg-white border-amber-300 hover:bg-amber-50/50'
                              : 'bg-white border-emerald-200 hover:border-emerald-300 hover:shadow'
                            : isConflict
                            ? isHovered
                              ? 'bg-amber-950/40 border-amber-400 ring-1 ring-amber-400'
                              : 'bg-amber-950/20 border-amber-500/50 hover:bg-amber-950/30'
                            : 'bg-emerald-950/20 border-emerald-500/40 hover:bg-emerald-950/30'
                        }`}
                      >
                        <div className="absolute -top-1.5 -right-1 flex gap-1 items-center">
                          {player.inRedZone && (
                            <span className="px-1.5 py-0.5 rounded text-[8px] font-black uppercase bg-rose-600 text-white tracking-wider shadow">
                              RZ
                            </span>
                          )}
                          {player.isLive && (
                            <span className="h-2 w-2 rounded-full bg-emerald-500 ring-2 ring-white" />
                          )}
                        </div>

                        <div className="flex items-center gap-2 mb-1">
                          <PlayerHeadshot key={`${player.name}-${headshotTick}`} name={player.name} team={player.nflTeam} size={40} />
                          <div className="min-w-0 flex-1">
                            <div className="flex items-start justify-between gap-1">
                              <div className={`font-black text-xs truncate leading-tight ${isLight ? 'text-slate-900' : 'text-white'}`}>
                                {player.name}
                              </div>
                              <div className="text-right shrink-0">
                                <span className={`font-mono font-black text-xs ${isLight ? 'text-emerald-700' : 'text-emerald-400'}`}>
                                  {(player.points || 0).toFixed(1)}
                                </span>
                                <span className={`text-[9px] font-bold ml-0.5 ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>pts</span>
                              </div>
                            </div>
                            <div className={`text-[10px] font-bold flex items-center gap-1 mt-0.5 ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>
                              <span>{player.position} • {player.nflTeam}</span>
                              <span className={`font-mono text-[9px] px-1 py-0.2 rounded truncate ${
                                player.isLive 
                                  ? isLight ? 'bg-emerald-100 text-emerald-800 font-bold' : 'bg-emerald-950/80 text-emerald-300' 
                                  : isLight ? 'text-slate-400' : 'text-slate-500'
                              }`}>
                                {player.gameClock}
                              </span>
                            </div>
                          </div>
                        </div>

                        {player.bigPlay && (
                          <div className="mb-1.5">
                            <span className={`inline-flex items-center px-1.5 py-0.2 rounded font-mono text-[9px] font-black border ${
                              isLight ? 'bg-amber-100 text-amber-800 border-amber-300' : 'bg-amber-500/20 text-amber-300 border-amber-500/40'
                            }`}>
                              ⚡ {player.bigPlay}
                            </span>
                          </div>
                        )}

                        <ExposureFlags player={player} isLight={isLight} />

                        <div className={`flex justify-between items-center gap-1 text-[10px] pt-1.5 border-t font-mono ${
                          isLight ? 'border-slate-100' : 'border-slate-800/80'
                        }`}>
                          <span className={`font-bold shrink-0 ${isLight ? 'text-emerald-700' : 'text-emerald-400'}`}>
                            {player.myShares} {player.myShares === 1 ? 'LEAGUE' : 'LEAGUES'}
                          </span>
                          {renderStance(player, 'mine', isConflict)}
                        </div>
                      </div>
                    );
                  })}
                </div>

                <div className="space-y-2">
                  {oppThreats.map((threat) => {
                    const isConflict = threat.myShares > 0;
                    const isHovered = hoveredConflictPlayer === threat.name;
                    return (
                      <div
                        key={`opp_${threat.name}`}
                        ref={(el) => { rightCardRefs.current[threat.name] = el; }}
                        onClick={() => setSelectedPlayer(threat)}
                        onMouseEnter={() => isConflict && setHoveredConflictPlayer(threat.name)}
                        onMouseLeave={() => setHoveredConflictPlayer(null)}
                        className={`relative rounded-xl p-2.5 transition active:scale-[0.98] cursor-pointer border shadow-sm ${
                          isLight
                            ? isConflict
                              ? isHovered
                                ? 'bg-amber-50 border-amber-400 ring-2 ring-amber-300'
                                : 'bg-white border-amber-300 hover:bg-amber-50/50'
                              : 'bg-white border-rose-200 hover:border-rose-300 hover:shadow'
                            : isConflict
                            ? isHovered
                              ? 'bg-amber-950/40 border-amber-400 ring-1 ring-amber-400'
                              : 'bg-amber-950/20 border-amber-500/50 hover:bg-amber-950/30'
                            : 'bg-rose-950/20 border-rose-500/40 hover:bg-rose-950/30'
                        }`}
                      >
                        <div className="absolute -top-1.5 -left-1 flex gap-1 items-center">
                          {threat.inRedZone && (
                            <span className="px-1.5 py-0.5 rounded text-[8px] font-black uppercase bg-rose-600 text-white tracking-wider shadow">
                              RZ
                            </span>
                          )}
                          {threat.isLive && (
                            <span className="h-2 w-2 rounded-full bg-rose-500 ring-2 ring-white" />
                          )}
                        </div>

                        <div className="flex items-center gap-2 mb-1">
                          <PlayerHeadshot key={`${threat.name}-${headshotTick}`} name={threat.name} team={threat.nflTeam} size={40} />
                          <div className="min-w-0 flex-1">
                            <div className="flex items-start justify-between gap-1">
                              <div className={`font-black text-xs truncate leading-tight ${isLight ? 'text-slate-900' : 'text-white'}`}>
                                {threat.name}
                              </div>
                              <div className="text-right shrink-0">
                                <span className={`font-mono font-black text-xs ${isLight ? 'text-rose-700' : 'text-rose-400'}`}>
                                  {(threat.points || 0).toFixed(1)}
                                </span>
                                <span className={`text-[9px] font-bold ml-0.5 ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>pts</span>
                              </div>
                            </div>
                            <div className={`text-[10px] font-bold flex items-center gap-1 mt-0.5 ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>
                              <span>{threat.position} • {threat.nflTeam}</span>
                              <span className={`font-mono text-[9px] px-1 py-0.2 rounded truncate ${
                                threat.isLive 
                                  ? isLight ? 'bg-rose-100 text-rose-800 font-bold' : 'bg-rose-950/80 text-rose-300' 
                                  : isLight ? 'text-slate-400' : 'text-slate-500'
                              }`}>
                                {threat.gameClock}
                              </span>
                            </div>
                          </div>
                        </div>

                        {threat.bigPlay && (
                          <div className="mb-1.5">
                            <span className={`inline-flex items-center px-1.5 py-0.2 rounded font-mono text-[9px] font-black border ${
                              isLight ? 'bg-amber-100 text-amber-800 border-amber-300' : 'bg-amber-500/20 text-amber-300 border-amber-500/40'
                            }`}>
                              ⚡ {threat.bigPlay}
                            </span>
                          </div>
                        )}

                        <ExposureFlags player={threat} isLight={isLight} />

                        <div className={`flex justify-between items-center gap-1 text-[10px] pt-1.5 border-t font-mono ${
                          isLight ? 'border-slate-100' : 'border-slate-800/80'
                        }`}>
                          <span className={`font-bold shrink-0 ${isLight ? 'text-rose-700' : 'text-rose-400'}`}>
                            {threat.oppShares} {threat.oppShares === 1 ? 'LEAGUE' : 'LEAGUES'}
                          </span>
                          {renderStance(threat, 'opp', isConflict)}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* VIEW 2: GAME SLATE */}
        {view === 'game-slate' && (
          <div className="space-y-3">
            <div className={`rounded-2xl p-3 border flex justify-between items-center gap-3 shadow-sm ${
              isLight ? 'bg-white border-slate-200' : 'bg-slate-900 border-slate-800'
            }`}>
              <div>
                <div className={`text-xs font-black uppercase tracking-wide ${isLight ? 'text-emerald-700' : 'text-emerald-400'}`}>
                  {slateMeta.label || 'NFL Slate'} · {slateMeta.range}
                </div>
                <div className={`text-[11px] mt-0.5 ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>
                  Tuesday 6:00 AM ET slate. ESPN scores fill in once a game is posted.
                </div>
                {slateMeta.byes?.length > 0 && (
                  <div className={`text-[11px] mt-1 font-bold ${isLight ? 'text-slate-600' : 'text-slate-300'}`}>
                    Bye weeks: {slateMeta.byes.join(', ')}
                  </div>
                )}
              </div>
              <div className="text-right shrink-0">
                <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold border ${
                  isLight ? 'bg-emerald-50 text-emerald-700 border-emerald-300' : 'bg-emerald-950 text-emerald-400 border-emerald-800'
                }`}>
                  Week {slateMeta.week}
                </span>
              </div>
            </div>

            {(games || []).map(game => {
              const activeMatchPlayers = getGamePlayers(game);
              return (
                <div key={game.id} className={`rounded-2xl overflow-hidden border shadow-sm ${
                  isLight ? 'bg-white border-slate-200' : 'bg-slate-900 border-slate-800'
                }`}>
                  <div className={`px-3.5 py-2.5 border-b flex justify-between items-center text-xs ${
                    isLight ? 'bg-slate-50 border-slate-200' : 'bg-slate-950 border-slate-800'
                  }`}>
                    <div className="flex items-center gap-2">
                      <span className={`font-bold ${isLight ? 'text-slate-900' : 'text-white'}`}>{game.away} @ {game.home}</span>
                      <span className={`font-mono text-[11px] ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>
                        ({game.awayScore || 0} - {game.homeScore || 0})
                      </span>
                    </div>
                    <span className={`text-[11px] font-bold text-right ${
                      game.status?.includes('LIVE') 
                        ? isLight ? 'text-emerald-700' : 'text-emerald-400' 
                        : isLight ? 'text-slate-500' : 'text-slate-400'
                    }`}>
                      {game.status || game.time}
                    </span>
                  </div>

                  <div className={`divide-y p-1 ${isLight ? 'divide-slate-100' : 'divide-slate-800/60'}`}>
                    {activeMatchPlayers.length === 0 ? (
                      <div className="p-3 text-center text-xs text-slate-400 italic">
                        No portfolio starters active in this matchup
                      </div>
                    ) : (
                      activeMatchPlayers.map(player => (
                        <div
                          key={player.name}
                          onClick={() => setSelectedPlayer(player)}
                          className={`p-2.5 cursor-pointer rounded-xl transition ${
                            isLight ? 'hover:bg-slate-50' : 'hover:bg-slate-800/40'
                          }`}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <div className="flex items-center gap-2.5 min-w-0">
                              <PlayerHeadshot key={`${player.name}-${headshotTick}`} name={player.name} team={player.nflTeam} size={40} />
                              <div className="min-w-0">
                                <div className={`font-bold text-xs truncate ${isLight ? 'text-slate-900' : 'text-white'}`}>{player.name}</div>
                                <div className={`text-[10px] ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>{player.position} • {player.nflTeam}</div>
                              </div>
                            </div>
                            <div className="text-right font-mono shrink-0">
                              <div className={`text-xs font-black ${isLight ? 'text-emerald-700' : 'text-emerald-400'}`}>
                                {(player.points || 0).toFixed(1)} pts
                              </div>
                              <div className={`text-[10px] ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>
                                {player.myShares} {player.myShares === 1 ? 'League' : 'Leagues'}
                              </div>
                            </div>
                          </div>
                          <ExposureFlags player={player} isLight={isLight} />
                        </div>
                      ))
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* VIEW 3: ALL LEAGUES */}
        {view === 'all-leagues' && (
          <div className="space-y-3">
            <div className={`p-4 rounded-2xl border flex flex-col gap-3 shadow-sm ${
              isLight ? 'bg-white border-slate-200' : 'bg-slate-900 border-slate-800'
            }`}>
              <div className="flex justify-between items-center">
                <div>
                  <div className={`font-black text-sm ${isLight ? 'text-slate-900' : 'text-white'}`}>
                    Platform Integration
                  </div>
                  <div className={`text-xs ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>
                    Sync all your Yahoo fantasy rosters automatically
                  </div>
                </div>
                <button
                  onClick={handleConnectYahoo}
                  disabled={isSyncing}
                  className="px-3.5 py-2 rounded-xl bg-purple-600 hover:bg-purple-500 active:scale-95 text-white text-xs font-black shadow-lg transition flex items-center gap-1.5"
                >
                  <span>⚡</span>
                  <span>{isSyncing ? 'Connecting...' : 'Connect Yahoo'}</span>
                </button>
              </div>
            </div>

            <div className={`text-xs font-black uppercase tracking-wider ${isLight ? 'text-slate-700' : 'text-slate-300'}`}>
              Connected Leagues ({leagues.length})
            </div>

            {leagues.length === 0 && (
              <div className={`rounded-2xl p-5 border text-center space-y-3 shadow-sm ${
                isLight ? 'bg-white border-slate-200' : 'bg-slate-900 border-slate-800'
              }`}>
                <div className={`text-sm font-black ${isLight ? 'text-slate-900' : 'text-white'}`}>
                  Sync your first league via the extension or import tool
                </div>
                <button
                  onClick={openYahooIngest}
                  className="px-3.5 py-2 rounded-xl bg-purple-600 hover:bg-purple-500 text-white text-xs font-black shadow-lg transition"
                >
                  Import Yahoo Matchup
                </button>
              </div>
            )}

            {leagues.map((lg) => (
              <div
                key={lg.id}
                onClick={() => setActiveLeagueDrawer(lg)}
                className={`rounded-2xl p-4 space-y-3 cursor-pointer border shadow-sm transition ${
                  isLight 
                    ? 'bg-white border-slate-200 hover:border-slate-300 hover:shadow' 
                    : 'bg-slate-900 border-slate-800 hover:border-slate-700'
                }`}
              >
                <div className="flex justify-between items-start">
                  <div>
                    <div className={`font-black text-base ${isLight ? 'text-slate-900' : 'text-white'}`}>{getLeagueDisplayName(lg)}</div>
                    <div className={`text-xs ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>vs {getLeagueOppName(lg)}</div>
                  </div>
                  <span className={`text-[10px] font-mono px-2 py-0.5 rounded-full font-bold border ${
                    isLight ? 'bg-purple-50 text-purple-700 border-purple-200' : 'bg-purple-950 text-purple-300 border-purple-800'
                  }`}>
                    {lg.platform}
                  </span>
                </div>
                <div className={`flex justify-between items-center gap-2 pt-2 border-t text-xs ${
                  isLight ? 'border-slate-100 text-slate-500' : 'border-slate-800 text-slate-400'
                }`}>
                  <span>{getLeaguePortfolio(lg).length} Starters Synced</span>
                  <span className={`font-bold ${
                    hiddenLeagueIds.has(lg.id)
                      ? isLight ? 'text-slate-400' : 'text-slate-500'
                      : isLight ? 'text-emerald-700' : 'text-emerald-400'
                  }`}>
                    {hiddenLeagueIds.has(lg.id) ? 'Off combined board' : 'On combined board'}
                  </span>
                  <span className={`font-mono font-bold ${isLight ? 'text-slate-800' : 'text-slate-200'}`}>
                    {(lg.myScore || 0).toFixed(2)} - {(lg.oppScore || 0).toFixed(2)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>

      {/* Persistent Bottom Navigation */}
      <nav className={`fixed bottom-0 left-0 right-0 z-40 backdrop-blur-lg border-t max-w-md mx-auto transition-colors ${
        isLight ? 'bg-white/95 border-slate-200' : 'bg-slate-950/95 border-slate-800'
      }`}>
        <div className="grid grid-cols-3 py-2 px-3 gap-1">
          <button
            onClick={() => setView('matchups')}
            className={`py-2 flex flex-col items-center justify-center rounded-xl text-xs font-bold transition ${
              view === 'matchups' 
                ? isLight ? 'bg-emerald-50 text-emerald-700 shadow-sm' : 'bg-slate-800 text-emerald-400' 
                : isLight ? 'text-slate-500 hover:text-slate-800' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <span>⚔️ Matchups</span>
          </button>
          <button
            onClick={() => setView('game-slate')}
            className={`py-2 flex flex-col items-center justify-center rounded-xl text-xs font-bold transition ${
              view === 'game-slate' 
                ? isLight ? 'bg-emerald-50 text-emerald-700 shadow-sm' : 'bg-slate-800 text-emerald-400' 
                : isLight ? 'text-slate-500 hover:text-slate-800' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <span>🎮 Game Slate</span>
          </button>
          <button
            onClick={() => setView('all-leagues')}
            className={`py-2 flex flex-col items-center justify-center rounded-xl text-xs font-bold transition ${
              view === 'all-leagues' 
                ? isLight ? 'bg-emerald-50 text-emerald-700 shadow-sm' : 'bg-slate-800 text-emerald-400' 
                : isLight ? 'text-slate-500 hover:text-slate-800' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <span>🏆 All Leagues</span>
          </button>
        </div>
      </nav>

      {/* Unified Player Breakdown Drawer */}
      {selectedPlayer && (
        <div
          onClick={() => setSelectedPlayer(null)}
          className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-end justify-center"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className={`border-t sm:border rounded-t-3xl sm:rounded-3xl p-5 max-w-md w-full space-y-4 shadow-2xl transition-colors ${
              isLight ? 'bg-white border-slate-200' : 'bg-slate-900 border-slate-800'
            }`}
          >
            <div className={`w-12 h-1.5 rounded-full mx-auto ${isLight ? 'bg-slate-300' : 'bg-slate-700'}`} />
            
            <div className={`flex justify-between items-start border-b pb-3 ${isLight ? 'border-slate-100' : 'border-slate-800'}`}>
              <div>
                <h3 className={`text-lg font-black flex items-center gap-2 ${isLight ? 'text-slate-900' : 'text-white'}`}>
                  <span>{selectedPlayer.name}</span>
                  {selectedPlayer.bigPlay && (
                    <span className={`px-1.5 py-0.5 rounded text-xs font-mono font-black border ${
                      isLight ? 'bg-amber-100 text-amber-800 border-amber-300' : 'bg-amber-500/20 text-amber-300 border-amber-500/40'
                    }`}>
                      ⚡ {selectedPlayer.bigPlay}
                    </span>
                  )}
                </h3>
                <div className={`text-xs font-semibold flex items-center gap-2 mt-0.5 ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>
                  <span>{selectedPlayer.position} • {selectedPlayer.nflTeam}</span>
                  <span>•</span>
                  <span className={`font-mono font-bold ${isLight ? 'text-emerald-700' : 'text-emerald-400'}`}>
                    {(selectedPlayer.points || 0).toFixed(1)} PTS
                  </span>
                  <span>•</span>
                  <span className="font-mono">{selectedPlayer.gameClock}</span>
                </div>
              </div>
              <button
                onClick={() => setSelectedPlayer(null)}
                className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-sm ${
                  isLight ? 'bg-slate-100 text-slate-500 hover:bg-slate-200' : 'bg-slate-800 text-slate-400'
                }`}
              >
                ✕
              </button>
            </div>

            <div className={`p-3 rounded-xl border flex justify-between items-center text-xs ${
              isLight ? 'bg-slate-50 border-slate-200' : 'bg-slate-950 border-slate-800'
            }`}>
              <span className={`font-bold ${isLight ? 'text-slate-700' : 'text-slate-300'}`}>Portfolio Net Stance:</span>
              <span className={`font-mono font-black px-2.5 py-0.5 rounded-full border ${
                selectedPlayer.myShares > selectedPlayer.oppShares
                  ? isLight ? 'bg-emerald-100 text-emerald-800 border-emerald-300' : 'bg-emerald-950 text-emerald-400 border-emerald-800'
                  : selectedPlayer.myShares < selectedPlayer.oppShares
                  ? isLight ? 'bg-rose-100 text-rose-800 border-rose-300' : 'bg-rose-950 text-rose-400 border-rose-800'
                  : isLight ? 'bg-amber-100 text-amber-800 border-amber-300' : 'bg-amber-950 text-amber-400 border-amber-800'
              }`}>
                {selectedPlayer.myShares > selectedPlayer.oppShares
                  ? `ROOTING FOR (+${selectedPlayer.myShares - selectedPlayer.oppShares})`
                  : selectedPlayer.myShares < selectedPlayer.oppShares
                  ? `ROOTING AGAINST (-${selectedPlayer.oppShares - selectedPlayer.myShares})`
                  : 'PERFECTLY CONFLICTED (0)'}
              </span>
            </div>

            <ExposureFlags player={selectedPlayer} isLight={isLight} />

            <div className="space-y-3">
              <div>
                <div className={`text-[11px] font-bold uppercase tracking-wider mb-1.5 flex justify-between ${
                  isLight ? 'text-emerald-700' : 'text-emerald-400'
                }`}>
                  <span>Your Roster ({selectedPlayer.myShares} Leagues)</span>
                  <span className={`text-[10px] ${isLight ? 'text-slate-400' : 'text-slate-500'}`}>ROOTING FOR</span>
                </div>
                {selectedPlayer.myShares > 0 ? (
                  <div className="space-y-1.5">
                    {selectedPlayer.myLeagues.map((item, i) => (
                      <div key={i} className={`rounded-xl px-3 py-2 text-xs flex justify-between items-center border ${
                        isLight ? 'bg-slate-50 border-slate-200 text-slate-800' : 'bg-slate-800/60 border-slate-700/50 text-slate-200'
                      }`}>
                        <span className="font-semibold">{item.league}</span>
                        <span className={`text-[10px] ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>vs {item.opponent}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className={`rounded-xl p-2.5 text-xs italic text-center border ${
                    isLight ? 'bg-slate-50 border-slate-200 text-slate-400' : 'bg-slate-950/40 border-slate-800/50 text-slate-500'
                  }`}>
                    Not rostered on any of your active teams
                  </div>
                )}
              </div>

              <div>
                <div className={`text-[11px] font-bold uppercase tracking-wider mb-1.5 flex justify-between ${
                  isLight ? 'text-rose-700' : 'text-rose-400'
                }`}>
                  <span>Opponent Starters ({selectedPlayer.oppShares} Leagues)</span>
                  <span className={`text-[10px] ${isLight ? 'text-slate-400' : 'text-slate-500'}`}>ROOTING AGAINST</span>
                </div>
                {selectedPlayer.oppShares > 0 ? (
                  <div className="space-y-1.5">
                    {selectedPlayer.oppLeagues.map((item, i) => (
                      <div key={i} className={`rounded-xl px-3 py-2 text-xs flex justify-between items-center border ${
                        isLight ? 'bg-slate-50 border-slate-200 text-slate-800' : 'bg-slate-800/60 border-slate-700/50 text-slate-200'
                      }`}>
                        <span className="font-semibold">{item.league}</span>
                        <span className={`text-[10px] font-bold ${isLight ? 'text-rose-700' : 'text-rose-400'}`}>
                          Started by {item.opponent}
                        </span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className={`rounded-xl p-2.5 text-xs italic text-center border ${
                    isLight ? 'bg-slate-50 border-slate-200 text-slate-400' : 'bg-slate-950/40 border-slate-800/50 text-slate-500'
                  }`}>
                    Zero opponent exposure across your leagues
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {leaguePendingDelete && (
        <div
          onClick={() => setLeaguePendingDelete(null)}
          className="fixed inset-0 z-[80] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
          role="presentation"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="remove-league-title"
            className={`rounded-3xl p-5 max-w-sm w-full space-y-4 shadow-2xl border ${
              isLight ? 'bg-white border-slate-200' : 'bg-slate-900 border-slate-800'
            }`}
          >
            <h3 id="remove-league-title" className={`text-base font-black ${isLight ? 'text-slate-900' : 'text-white'}`}>
              Remove {getLeagueDisplayName(leaguePendingDelete)} from RootMap?
            </h3>
            <p className={`text-xs leading-relaxed ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>
              Combined Rooting updates as soon as this league is removed. You can import it again later.
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setLeaguePendingDelete(null)}
                className={`flex-1 py-2.5 rounded-xl text-xs font-bold border transition ${
                  isLight ? 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50' : 'bg-slate-800 text-slate-300 border-slate-700 hover:bg-slate-700'
                }`}
              >
                Keep league
              </button>
              <button
                type="button"
                onClick={confirmRemoveLeague}
                className="flex-1 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-black shadow-lg transition"
              >
                Remove league
              </button>
            </div>
          </div>
        </div>
      )}

      {showLegend && (
        <div
          onClick={() => setShowLegend(false)}
          className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
          role="presentation"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="rooting-key-title"
            className={`rounded-3xl p-5 max-w-md w-full space-y-4 shadow-2xl border ${
              isLight ? 'bg-white border-slate-200' : 'bg-slate-900 border-slate-800'
            }`}
          >
            <div className="flex justify-between items-start gap-3">
              <div>
                <h3 id="rooting-key-title" className={`text-base font-black ${isLight ? 'text-slate-900' : 'text-white'}`}>
                  Rooting Key
                </h3>
                <p className={`text-xs mt-1 ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>
                  How exposure badges read across your leagues.
                </p>
              </div>
              <button
                onClick={() => setShowLegend(false)}
                aria-label="Close legend"
                className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-sm shrink-0 ${
                  isLight ? 'bg-slate-100 text-slate-500 hover:bg-slate-200' : 'bg-slate-800 text-slate-400'
                }`}
              >
                ✕
              </button>
            </div>
            <ul className="space-y-2">
              {ROOTING_LEGEND.map((item) => (
                <li
                  key={item.title}
                  className={`rounded-2xl px-3 py-2.5 border flex gap-2.5 ${
                    isLight ? 'bg-slate-50 border-slate-200' : 'bg-slate-950 border-slate-800'
                  }`}
                >
                  <span className="text-base leading-none pt-0.5" aria-hidden="true">{item.icon}</span>
                  <div>
                    <div className={`text-xs font-black ${isLight ? 'text-slate-900' : 'text-white'}`}>{item.title}</div>
                    <div className={`text-[11px] mt-0.5 leading-snug ${isLight ? 'text-slate-600' : 'text-slate-400'}`}>{item.detail}</div>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {showLeagueFilter && createPortal(
        <div
          onClick={() => setShowLeagueFilter(false)}
          className="fixed inset-0 z-[70] bg-black/45 backdrop-blur-[2px]"
          role="presentation"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="league-filter-title"
            style={{ top: filterPos.top, left: filterPos.left }}
            className={`absolute w-[min(18rem,calc(100vw-1rem))] max-h-[min(24rem,70vh)] overflow-y-auto rounded-2xl border shadow-2xl p-3 ${
              isLight ? 'bg-white border-slate-200' : 'bg-slate-900 border-slate-700'
            }`}
          >
            <div className="flex items-start justify-between gap-2 mb-2">
              <div>
                <h3 id="league-filter-title" className={`text-sm font-black ${isLight ? 'text-slate-900' : 'text-white'}`}>
                  Filter Leagues
                </h3>
                <p className={`text-[11px] mt-0.5 leading-snug ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>
                  Checked leagues stay in Combined Rooting and the game board.
                </p>
              </div>
              <button
                onClick={() => setShowLeagueFilter(false)}
                aria-label="Close league filter"
                className={`w-7 h-7 rounded-full flex items-center justify-center font-bold text-xs shrink-0 ${
                  isLight ? 'bg-slate-100 text-slate-500 hover:bg-slate-200' : 'bg-slate-800 text-slate-400'
                }`}
              >
                ✕
              </button>
            </div>
            {hiddenCount > 0 && (
              <button
                onClick={() => setHiddenLeagueIds(new Set())}
                className={`mb-2 w-full py-1.5 rounded-xl text-[11px] font-black border ${
                  isLight ? 'bg-emerald-50 text-emerald-800 border-emerald-200' : 'bg-emerald-950 text-emerald-300 border-emerald-800'
                }`}
              >
                Show all leagues
              </button>
            )}
            <div className="space-y-1">
              {leagues.length === 0 && (
                <p className={`px-2 py-2 text-[11px] ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>
                  No leagues imported yet.
                </p>
              )}
              {leagues.map((lg) => {
                const checked = !hiddenLeagueIds.has(lg.id);
                const leagueName = getLeagueDisplayName(lg);
                return (
                  <div
                    key={lg.id}
                    className={`flex items-center gap-1 rounded-xl ${
                      isLight ? 'hover:bg-slate-50' : 'hover:bg-slate-800/70'
                    }`}
                  >
                    <label className="flex items-center gap-2.5 px-2 py-2 cursor-pointer min-w-0 flex-1">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleLeagueVisibility(lg.id)}
                        className="accent-emerald-500 w-4 h-4 shrink-0"
                      />
                      <span className="min-w-0">
                        <span className={`block text-xs font-black truncate ${isLight ? 'text-slate-900' : 'text-white'}`}>
                          {leagueName}
                        </span>
                        <span className={`block text-[10px] truncate ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>
                          vs {getLeagueOppName(lg)}
                        </span>
                      </span>
                    </label>
                    <button
                      type="button"
                      aria-label={`Remove ${leagueName}`}
                      title={`Remove ${leagueName}`}
                      onClick={() => setLeaguePendingDelete(lg)}
                      className={`mr-1 w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${
                        isLight ? 'text-rose-600 hover:bg-rose-50' : 'text-rose-400 hover:bg-rose-950/70'
                      }`}
                    >
                      <TrashIcon />
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        </div>,
        document.body
      )}

      {showYahooIngest && (
        <div
          onClick={() => setShowYahooIngest(false)}
          className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className={`rounded-3xl p-5 max-w-md w-full space-y-4 shadow-2xl border ${
              isLight ? 'bg-white border-slate-200' : 'bg-slate-900 border-slate-800'
            }`}
          >
            <div className="flex justify-between items-start gap-3">
              <div>
                <h3 className={`text-base font-black ${isLight ? 'text-slate-900' : 'text-white'}`}>
                  Import Yahoo Matchup
                </h3>
                <p className={`text-xs mt-1 leading-relaxed ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>
                  On your Yahoo Fantasy Matchup page, press Ctrl+A, Ctrl+C, and paste here.
                </p>
              </div>
              <button
                onClick={() => setShowYahooIngest(false)}
                className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-sm shrink-0 ${
                  isLight ? 'bg-slate-100 text-slate-500 hover:bg-slate-200' : 'bg-slate-800 text-slate-400'
                }`}
              >
                ✕
              </button>
            </div>

            <div>
              <label className={`text-[11px] font-black uppercase tracking-wider block mb-1 ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>
                League Name
              </label>
              <input
                type="text"
                value={yahooLeagueName}
                onChange={(e) => setYahooLeagueName(e.target.value)}
                placeholder={`League ${leagues.length + 1}`}
                className={`w-full px-3 py-2 rounded-xl text-xs font-bold select-text focus:outline-none ${
                  isLight
                    ? 'bg-slate-50 border border-slate-200 text-slate-800 placeholder-slate-400 focus:border-purple-400'
                    : 'bg-slate-950 border border-slate-700 text-slate-200 placeholder-slate-500 focus:border-purple-500'
                }`}
              />
            </div>

            <textarea
              value={yahooPaste}
              onChange={(e) => {
                setYahooPaste(e.target.value);
                if (yahooIngestError) setYahooIngestError('');
              }}
              placeholder="Paste the full Yahoo Matchup page here…"
              className={`w-full h-48 rounded-2xl p-3 text-xs font-mono leading-relaxed resize-y select-text focus:outline-none ${
                isLight
                  ? 'bg-slate-50 border border-slate-200 text-slate-800 placeholder-slate-400 focus:border-purple-400'
                  : 'bg-slate-950 border border-slate-700 text-slate-200 placeholder-slate-500 focus:border-purple-500'
              }`}
            />

            {yahooIngestError && (
              <div className={`text-xs font-bold rounded-xl px-3 py-2 border ${
                isLight ? 'bg-rose-50 text-rose-700 border-rose-200' : 'bg-rose-950/70 text-rose-300 border-rose-800'
              }`}>
                {yahooIngestError}
              </div>
            )}

            <div className="flex gap-2">
              <button
                onClick={() => setShowYahooIngest(false)}
                className={`flex-1 py-2.5 rounded-xl text-xs font-bold border transition ${
                  isLight ? 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50' : 'bg-slate-800 text-slate-300 border-slate-700 hover:bg-slate-700'
                }`}
              >
                Cancel
              </button>
              <button
                onClick={handleImportYahooMatchup}
                disabled={!yahooPaste.trim()}
                className="flex-1 py-2.5 rounded-xl bg-purple-600 hover:bg-purple-500 disabled:opacity-40 disabled:hover:bg-purple-600 text-white text-xs font-black shadow-lg transition"
              >
                Import Matchup
              </button>
            </div>
          </div>
        </div>
      )}

      {/* League Matchup Drawer */}
      {activeLeagueDrawer && (
        <div
          onClick={() => setActiveLeagueDrawer(null)}
          className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-end justify-center"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className={`border-t sm:border rounded-t-3xl sm:rounded-3xl p-5 max-w-md w-full max-h-[80vh] flex flex-col shadow-2xl transition-colors ${
              isLight ? 'bg-white border-slate-200' : 'bg-slate-900 border-slate-800'
            }`}
          >
            <div className={`w-12 h-1.5 rounded-full mx-auto mb-3 ${isLight ? 'bg-slate-300' : 'bg-slate-700'}`} />
            <div className={`flex justify-between items-center border-b pb-3 ${isLight ? 'border-slate-100' : 'border-slate-800'}`}>
              <div>
                <h3 className={`text-base font-black ${isLight ? 'text-slate-900' : 'text-white'}`}>{getLeagueDisplayName(activeLeagueDrawer)}</h3>
                <div className={`text-xs ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>vs {getLeagueOppName(activeLeagueDrawer)}</div>
              </div>
              <button
                onClick={() => setActiveLeagueDrawer(null)}
                className={`w-7 h-7 rounded-full flex items-center justify-center font-bold text-xs ${
                  isLight ? 'bg-slate-100 text-slate-500 hover:bg-slate-200' : 'bg-slate-800 text-slate-400'
                }`}
              >
                ✕
              </button>
            </div>
            <div className="overflow-y-auto space-y-2 py-3">
              {getLeaguePortfolio(activeLeagueDrawer).map((p, idx) => (
                <div key={idx} className={`rounded-xl p-2.5 flex justify-between items-center text-xs border ${
                  isLight ? 'bg-slate-50 border-slate-200' : 'bg-slate-800/60 border-slate-700/40'
                }`}>
                  <div className="flex items-center gap-2">
                    <span className={`font-mono text-[10px] px-1.5 py-0.5 rounded font-bold ${
                      isLight ? 'bg-slate-200 text-slate-700' : 'bg-slate-700 text-slate-300'
                    }`}>
                      {p.slot}
                    </span>
                    <span className={`font-bold ${isLight ? 'text-slate-900' : 'text-white'}`}>{p.name}</span>
                    <span className={`text-[11px] ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>{p.nflTeam}</span>
                  </div>
                  <span className={`font-mono font-bold ${isLight ? 'text-emerald-700' : 'text-emerald-400'}`}>{(p.points || 0).toFixed(1)} pts</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
