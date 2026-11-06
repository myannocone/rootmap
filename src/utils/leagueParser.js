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

const NFL_TEAMS = new Set([
  'ARI', 'ATL', 'BAL', 'BUF', 'CAR', 'CHI', 'CIN', 'CLE', 'DAL', 'DEN', 'DET', 'GB',
  'HOU', 'IND', 'JAX', 'KC', 'LAC', 'LAR', 'LV', 'MIA', 'MIN', 'NE', 'NO', 'NYG',
  'NYJ', 'PHI', 'PIT', 'SEA', 'SF', 'TB', 'TEN', 'WAS'
]);

const NICKNAME_TO_TEAM = {
  cardinals: 'ARI',
  arizona: 'ARI',
  falcons: 'ATL',
  atlanta: 'ATL',
  ravens: 'BAL',
  baltimore: 'BAL',
  bills: 'BUF',
  buffalo: 'BUF',
  panthers: 'CAR',
  carolina: 'CAR',
  bears: 'CHI',
  chicago: 'CHI',
  bengals: 'CIN',
  cincinnati: 'CIN',
  browns: 'CLE',
  cleveland: 'CLE',
  cowboys: 'DAL',
  dallas: 'DAL',
  broncos: 'DEN',
  denver: 'DEN',
  lions: 'DET',
  detroit: 'DET',
  packers: 'GB',
  'green bay': 'GB',
  texans: 'HOU',
  houston: 'HOU',
  colts: 'IND',
  indianapolis: 'IND',
  jaguars: 'JAX',
  jags: 'JAX',
  jacksonville: 'JAX',
  chiefs: 'KC',
  'kansas city': 'KC',
  chargers: 'LAC',
  rams: 'LAR',
  raiders: 'LV',
  'las vegas': 'LV',
  dolphins: 'MIA',
  miami: 'MIA',
  vikings: 'MIN',
  minnesota: 'MIN',
  patriots: 'NE',
  'new england': 'NE',
  saints: 'NO',
  'new orleans': 'NO',
  giants: 'NYG',
  'new york giants': 'NYG',
  jets: 'NYJ',
  'new york jets': 'NYJ',
  eagles: 'PHI',
  philadelphia: 'PHI',
  steelers: 'PIT',
  pittsburgh: 'PIT',
  seahawks: 'SEA',
  seattle: 'SEA',
  '49ers': 'SF',
  niners: 'SF',
  'san francisco': 'SF',
  buccaneers: 'TB',
  bucs: 'TB',
  'tampa bay': 'TB',
  titans: 'TEN',
  tennessee: 'TEN',
  commanders: 'WAS',
  washington: 'WAS'
};

const SLOT_ALT = 'D\\/ST|DST|DEF|FLEX|RB\\/WR|W\\/R\\/T|QB|RB|WR|TE|LB|DL|DB|DE|DT|CB|DP|ED|K|S';
const POS_ALT = SLOT_ALT;
const STATUS_ALT = 'QUESTIONABLE|DOUBTFUL|OUT|DTD|PUP|SSPD|IR|Q|O|D|P';
const SLOT_ONLY_RE = new RegExp(`^(?:${SLOT_ALT})$`, 'i');
const POS_ONLY_RE = new RegExp(`^(?:${POS_ALT})$`, 'i');
const STATUS_ONLY_RE = new RegExp(`^(?:${STATUS_ALT})$`, 'i');
const ROW_RE = new RegExp(
  `^(${SLOT_ALT})\\s+(.+?)(?:\\s+(?:${STATUS_ALT}))?\\s+([A-Za-z]{2,3})\\s+(${POS_ALT})\\b(.*)$`,
  'i'
);
const NOSLOT_RE = new RegExp(
  `^(.+?)(?:\\s+(?:${STATUS_ALT}))?\\s+([A-Za-z]{2,3})\\s+(${POS_ALT})\\b(.*)$`,
  'i'
);
const DST_TEAM_RE = /^(?:(?:D\/ST|DST|DEF)\s+)?(.+?\s+D\/ST)\s+([A-Za-z]{2,3})\s+(?:D\/ST|DST|DEF)\b(.*)$/i;
const DST_ROW_RE = /^(?:(?:D\/ST|DST|DEF)\s+)?(.+?)\s+(?:D\/ST|DST|DEF)\b(.*)$/i;
const STARTERS_RE = /^STARTERS\b/i;
const RECORD_RE = /^\(?\d{1,2}-\d{1,2}(?:-\d{1,2})?\)?$/;
const SCORE_RE = /^\d{1,3}(?:\.\d{1,2})?$/;
const FLOAT_RE = /\d+\.\d{1,2}/g;

function canonTeam(team) {
  const raw = String(team || '').toUpperCase().replace(/[^A-Z]/g, '');
  if (!raw) return '';
  const key = TEAM_ALIASES[raw] || raw;
  return NFL_TEAMS.has(key) ? key : '';
}

export function resolveNflTeam(value) {
  const abbrev = canonTeam(value);
  if (abbrev) return abbrev;
  return nicknameToTeam(value);
}

function nicknameToTeam(name) {
  const key = String(name || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s']/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!key) return '';
  if (NICKNAME_TO_TEAM[key]) return NICKNAME_TO_TEAM[key];
  const parts = key.split(' ').filter((part) => part && part !== 'd' && part !== 'st' && part !== 'dst');
  const lastTwo = parts.slice(-2).join(' ');
  if (NICKNAME_TO_TEAM[lastTwo]) return NICKNAME_TO_TEAM[lastTwo];
  const last = parts[parts.length - 1];
  if (NICKNAME_TO_TEAM[last]) return NICKNAME_TO_TEAM[last];
  return NICKNAME_TO_TEAM[parts[0]] || '';
}

function normalizeEspnPos(pos) {
  const p = String(pos || '').toUpperCase().trim();
  if (p === 'DST' || p === 'DEF' || p === 'D/ST') return 'D/ST';
  if (p === 'PK') return 'K';
  if (p === 'W/R/T' || p === 'WR/TE' || p === 'W/R' || p === 'RB/WR') return 'FLEX';
  return p;
}

function dedupePlayerName(raw) {
  const text = String(raw || '').trim();
  const collapsed = text.replace(/^(.{3,}?)\1$/i, '$1').trim();
  if (collapsed !== text) return collapsed;
  return text.replace(/^(.{3,}?)\s+\1$/i, '$1').trim();
}

function stripKickoffSuffix(raw) {
  return String(raw || '')
    .replace(/\s*(?:@|vs\.?|at)\s*[A-Za-z]{2,3}\s+(?:Sun|Mon|Tue|Wed|Thu|Fri|Sat)\s+\d{1,2}:\d{2}\s*(?:AM|PM)?\s*$/i, '')
    .replace(/\s+(?:Sun|Mon|Tue|Wed|Thu|Fri|Sat)\s+\d{1,2}:\d{2}\s*(?:AM|PM)?\s*$/i, '')
    .trim();
}

function cleanPlayerName(raw) {
  let s = dedupePlayerName(stripKickoffSuffix(String(raw || '').replace(/\s+/g, ' ').trim()));
  const tail = new RegExp(`\\s+(?:\\((?:${STATUS_ALT})\\)|(?:${STATUS_ALT}))\\s*$`, 'i');
  let prev = '';
  while (s && s !== prev) {
    prev = s;
    s = dedupePlayerName(s.replace(tail, '').trim());
  }
  return s;
}

function isKickoffLine(line) {
  const text = String(line || '').trim();
  if (/^(?:Sun|Mon|Tue|Wed|Thu|Fri|Sat)\b/i.test(text) && /\d{1,2}:\d{2}/.test(text)) return true;
  if (/^(?:@|vs\.?|v\.?|at)\s*[A-Za-z]{2,3}\b/i.test(text) && /(?:Sun|Mon|Tue|Wed|Thu|Fri|Sat)\b|\d{1,2}:\d{2}/i.test(text)) return true;
  if (/^(?:@|vs\.?)?[A-Za-z]{2,3}\s+(?:Sun|Mon|Tue|Wed|Thu|Fri|Sat)\s+\d{1,2}:\d{2}\s*(?:AM|PM)?$/i.test(text)) return true;
  return false;
}

function isEspnChromeLine(line) {
  return /in play:|to play:|proj(?:ected)?\s*total|box score|quick box|\bmatchup\b/i.test(String(line || ''));
}

function defenseDisplayName(name) {
  const cleaned = cleanPlayerName(name)
    .replace(/^(?:D\/ST|DST|DEF)\s+/i, '')
    .replace(/\s+D\/ST$/i, '')
    .trim();
  return cleaned ? `${cleaned} D/ST` : '';
}

function isIrSection(line, nextLine) {
  if (!/^IR$/i.test(String(line || '').trim())) return false;
  const next = String(nextLine || '').trim();
  if (!next || SLOT_ONLY_RE.test(next) || STARTERS_RE.test(next) || /^BENCH\b/i.test(next)) return true;
  if (canonTeam(next) || POS_ONLY_RE.test(next) || STATUS_ONLY_RE.test(next)) return false;
  return true;
}

function isRosterStop(line, nextLine) {
  const s = String(line || '').trim();
  if (/^BENCH\b/i.test(s)) return true;
  if (isIrSection(s, nextLine)) return true;
  if (!/^TOTALS?\b/i.test(s)) return false;
  return !/[A-Za-z]/.test(s.replace(/^TOTALS?\b/i, ''));
}

export function splitPasteLines(raw) {
  return String(raw || '')
    .replace(/\r/g, '')
    .replace(/\u00a0/g, ' ')
    .replace(/\t+/g, ' ')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

function isTableHeader(line) {
  const s = String(line || '').trim();
  if (/^player,\s*team\s*pos\b/i.test(s)) return true;
  return /^(slot|player|team\s*pos|opp|opponent|status|proj|projected|score|fpts|pts|%rost|%start|rostered|avg|last|ytd|oprk)$/i.test(s);
}

function parseMatchupToken(text) {
  const match = String(text || '').match(/(?:^|\s)(@|vs\.?|v\.?|at)\s*([A-Za-z]{2,3})\b/i);
  if (!match) return '';
  const team = canonTeam(match[2]);
  if (!team) return '';
  const away = match[1] === '@' || /^at$/i.test(match[1]);
  return `${away ? '@' : 'vs'} ${team}`;
}

function parseTrailingStats(rest) {
  const source = String(rest || '');
  const gameMatchup = parseMatchupToken(source);
  const nums = (source.match(FLOAT_RE) || []).map(Number);
  const points = nums.length ? nums[0] : 0;
  const actualPoints = nums.length >= 2 ? nums[1] : null;
  const status = source.match(/\b((?:Sun|Mon|Tue|Wed|Thu|Fri|Sat)(?:\s+\d{1,2}:\d{2}\s*(?:AM|PM)?)?|Final|Halftime|Q[1-4]|OT)\b/i);
  const isLive = /\b(Q[1-4]|1st|2nd|3rd|4th|OT|Halftime)\b/i.test(source);
  let gameClock = 'Scheduled';
  if (gameMatchup && status) gameClock = `${gameMatchup} · ${status[1]}`;
  else if (gameMatchup) gameClock = gameMatchup;
  else if (status) gameClock = status[1];
  return { gameMatchup, gameClock, points, projPoints: points, actualPoints, isLive };
}

function buildStarter({ slot, name, team, pos, rest }) {
  const slotNorm = normalizeEspnPos(slot);
  const posNorm = normalizeEspnPos(pos || slot);
  const cleaned = cleanPlayerName(name);
  const nflTeam = canonTeam(team) || nicknameToTeam(cleaned);
  if (!cleaned || !nflTeam) return null;
  const position = (slotNorm === 'FLEX' || slotNorm === 'DP') && posNorm && posNorm !== slotNorm
    ? posNorm
    : (posNorm || slotNorm);
  return {
    name: cleaned,
    slot: slotNorm,
    position,
    nflTeam,
    team: nflTeam,
    ...parseTrailingStats(rest)
  };
}

function buildDefenseStarter({ name, team, rest }) {
  const display = defenseDisplayName(name);
  const nflTeam = canonTeam(team) || nicknameToTeam(display);
  if (!display || !nflTeam) return null;
  return {
    name: display,
    slot: 'D/ST',
    position: 'D/ST',
    nflTeam,
    team: nflTeam,
    ...parseTrailingStats(rest)
  };
}

export function parseEspnPlayerRow(line) {
  const text = String(line || '').trim();
  if (!text || isKickoffLine(text) || isEspnChromeLine(text) || isTableHeader(text) || isRosterStop(text) || STARTERS_RE.test(text)) return null;

  const defenseTeam = text.match(DST_TEAM_RE);
  if (defenseTeam && canonTeam(defenseTeam[2])) {
    const starter = buildDefenseStarter({
      name: defenseTeam[1],
      team: defenseTeam[2],
      rest: defenseTeam[3]
    });
    if (starter) return starter;
  }

  const row = text.match(ROW_RE);
  if (row && canonTeam(row[3])) {
    const starter = buildStarter({
      slot: row[1],
      name: row[2],
      team: row[3],
      pos: row[4],
      rest: row[5]
    });
    if (starter) return starter;
  }

  const bare = text.match(NOSLOT_RE);
  if (bare && canonTeam(bare[2]) && !SLOT_ONLY_RE.test(bare[1].trim())) {
    const starter = buildStarter({
      slot: bare[3],
      name: bare[1],
      team: bare[2],
      pos: bare[3],
      rest: bare[4]
    });
    if (starter && !/^(?:slot|player|opp|status|proj|score|fpts|pts)$/i.test(starter.name)) return starter;
  }

  const defense = text.match(DST_ROW_RE);
  if (!defense) return null;
  return buildDefenseStarter({
    name: defense[1],
    team: '',
    rest: defense[2]
  });
}

export function isEspnPlayerRow(line) {
  return Boolean(parseEspnPlayerRow(line));
}

function isSkippableHeaderLine(line) {
  if (/^week\s+\d+/i.test(line)) return true;
  if (isEspnChromeLine(line) || isKickoffLine(line)) return true;
  if (/^(matchup|espn|fantasy(?:\s+football)?|box\s*score|full\s+box|quick\s*box|recap|schedule|starters|bench)$/i.test(line)) return true;
  if (/^\d{1,2}:\d{2}\b/i.test(line)) return true;
  if (/^(am|pm|et|edt|est)$/i.test(line)) return true;
  return false;
}

function looksLikeTeamName(line) {
  if (!line || line.length < 2 || line.length > 48) return false;
  if (isSkippableHeaderLine(line) || isTableHeader(line) || isRosterStop(line) || STATUS_ONLY_RE.test(line)) return false;
  if (SLOT_ONLY_RE.test(line) || POS_ONLY_RE.test(line) || RECORD_RE.test(line) || SCORE_RE.test(line)) return false;
  if (isEspnPlayerRow(line)) return false;
  if (/^(proj|projected|score|fpts|pts)\b/i.test(line)) return false;
  return /[A-Za-z]/.test(line);
}

function parseHeader(lines) {
  const teams = [];
  let want = null;
  lines.forEach((line) => {
    if (/proj(?:ected)?\s*total/i.test(line)) {
      want = 'proj';
      const inlineTotal = line.match(/(\d{1,3}(?:\.\d{1,2})?)\s*$/);
      if (inlineTotal && teams.length && /\d/.test(inlineTotal[1])) {
        teams[teams.length - 1].projectedScore = parseFloat(inlineTotal[1]);
        want = null;
      }
      return;
    }
    if (isSkippableHeaderLine(line) || isTableHeader(line) || RECORD_RE.test(line)) return;
    const labeled = line.match(/^(proj(?:ected)?|score|fpts|pts)\s*[:\-]?\s*(\d{1,3}(?:\.\d{1,2})?)$/i);
    if (labeled && teams.length) {
      const value = parseFloat(labeled[2]);
      const last = teams[teams.length - 1];
      if (/^proj/i.test(labeled[1])) last.projectedScore = value;
      else last.score = value;
      return;
    }
    if (/proj(?:ected)?(?:\s*total)?$/i.test(line)) {
      want = 'proj';
      const inlineTotal = line.match(/(\d{1,3}(?:\.\d{1,2})?)\s*$/);
      if (inlineTotal && teams.length && /proj/i.test(line)) {
        teams[teams.length - 1].projectedScore = parseFloat(inlineTotal[1]);
        want = null;
      }
      return;
    }
    if (SCORE_RE.test(line)) {
      if (!teams.length) return;
      const value = parseFloat(line);
      const last = teams[teams.length - 1];
      if (want === 'proj') last.projectedScore = value;
      else if (last.score == null) last.score = value;
      else if (last.projectedScore == null) last.projectedScore = value;
      want = null;
      return;
    }
    const inline = line.match(/^(.*?)[\s:]+(\d{1,3}(?:\.\d{1,2})?)$/);
    if (inline && looksLikeTeamName(inline[1].trim())) {
      teams.push({ name: inline[1].trim(), score: parseFloat(inline[2]), projectedScore: null });
      want = null;
      return;
    }
    if (looksLikeTeamName(line) && teams.length < 3) {
      teams.push({ name: line, score: null, projectedScore: null });
      want = null;
    }
  });

  const league = teams.length >= 3 ? teams[0] : null;
  const sides = teams.length >= 3 ? teams.slice(1, 3) : teams.slice(0, 2);
  const scoreOf = (team) => {
    if (!team) return 0;
    if (team.score != null) return team.score;
    return team.projectedScore ?? 0;
  };

  return {
    leagueName: league?.name || '',
    userName: sides[0]?.name || 'My Team',
    oppName: sides[1]?.name || 'Opponent',
    myScore: scoreOf(sides[0]),
    oppScore: scoreOf(sides[1]),
    myProjected: sides[0]?.projectedScore ?? null,
    oppProjected: sides[1]?.projectedScore ?? null
  };
}

function isDash(line) {
  return /^[-–—]+$/.test(line);
}

function isFloatLine(line) {
  return /^\d+\.\d{1,2}$/.test(line);
}

function isStatusLine(line) {
  return /^(?:Sun|Mon|Tue|Wed|Thu|Fri|Sat|Final|Halftime|Q[1-4]|OT)\b/i.test(line);
}

function parseMultilineSlot(lines, start) {
  const slot = normalizeEspnPos(lines[start]);
  let i = start + 1;
  let name = '';
  let nflTeam = '';
  let position = slot;
  let gameMatchup = '';
  let status = '';
  const nums = [];

  while (i < lines.length) {
    const line = lines[i];
    if (/^IR$/i.test(line) && !isIrSection(line, lines[i + 1])) {
      i += 1;
      continue;
    }
    if (STARTERS_RE.test(line) || isRosterStop(line, lines[i + 1]) || SLOT_ONLY_RE.test(line) || isEspnPlayerRow(line)) break;
    if (isTableHeader(line) || isDash(line) || STATUS_ONLY_RE.test(line) || isEspnChromeLine(line)) {
      i += 1;
      continue;
    }
    if (isKickoffLine(line)) {
      const matchup = parseMatchupToken(line);
      if (matchup && !gameMatchup) gameMatchup = matchup;
      if (!status) status = line;
      i += 1;
      continue;
    }
    if (!gameMatchup && /^(?:@|vs\.?|v\.?|at)(?:\s|$)/i.test(line)) {
      const matchup = parseMatchupToken(line);
      if (matchup) {
        gameMatchup = matchup;
        i += 1;
        continue;
      }
    }
    if (!status && isStatusLine(line)) {
      status = line;
      i += 1;
      continue;
    }
    if (isFloatLine(line)) {
      nums.push(parseFloat(line));
      i += 1;
      continue;
    }
    const teamPos = line.match(new RegExp(`^([A-Za-z]{2,3})\\s+(${POS_ALT})$`, 'i'));
    if (teamPos && canonTeam(teamPos[1])) {
      nflTeam = canonTeam(teamPos[1]);
      position = normalizeEspnPos(teamPos[2]);
      if (position === 'D/ST' && name) name = defenseDisplayName(name);
      i += 1;
      continue;
    }
    if (canonTeam(line) && i + 1 < lines.length && POS_ONLY_RE.test(lines[i + 1])) {
      nflTeam = canonTeam(line);
      position = normalizeEspnPos(lines[i + 1]);
      if (position === 'D/ST' && name) name = defenseDisplayName(name);
      i += 2;
      continue;
    }
    const nickPos = line.match(/^(.*?)\s+(D\/ST|DST|DEF)$/i);
    if (nickPos && (nicknameToTeam(nickPos[1]) || /d\/st/i.test(line))) {
      const display = defenseDisplayName(nickPos[1]);
      name = name || display;
      nflTeam = nflTeam || nicknameToTeam(display);
      position = 'D/ST';
      i += 1;
      continue;
    }
    if (!name && !isKickoffLine(line) && /[A-Za-z]/.test(line) && !isStatusLine(line) && !STATUS_ONLY_RE.test(line)) {
      name = /d\/st/i.test(line) ? defenseDisplayName(line) : cleanPlayerName(line);
      nflTeam = nflTeam || nicknameToTeam(name);
      if (/d\/st/i.test(line)) position = 'D/ST';
      i += 1;
      continue;
    }
    i += 1;
  }

  const points = nums[0] || 0;
  const actualPoints = nums.length >= 2 ? nums[1] : null;
  let gameClock = 'Scheduled';
  if (gameMatchup && status) gameClock = `${gameMatchup} · ${status}`;
  else if (gameMatchup) gameClock = gameMatchup;
  else if (status) gameClock = status;
  const resolvedTeam = nflTeam || nicknameToTeam(name);
  const player = name && resolvedTeam
    ? {
      name,
      slot,
      position,
      nflTeam: resolvedTeam,
      team: resolvedTeam,
      gameMatchup,
      gameClock,
      points,
      projPoints: points,
      actualPoints,
      isLive: /\b(Q[1-4]|1st|2nd|3rd|4th|OT|Halftime)\b/i.test(status)
    }
    : null;
  return { player, next: i };
}

function parseStarterSection(lines) {
  const rows = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (isRosterStop(line, lines[i + 1]) || STARTERS_RE.test(line)) break;
    if (isTableHeader(line)) {
      i += 1;
      continue;
    }
    const compact = parseEspnPlayerRow(line);
    if (compact) {
      rows.push(compact);
      i += 1;
      continue;
    }
    if (SLOT_ONLY_RE.test(line)) {
      const parsed = parseMultilineSlot(lines, i);
      if (parsed.player) rows.push(parsed.player);
      i = Math.max(parsed.next, i + 1);
      continue;
    }
    i += 1;
  }
  return rows;
}

function splitSides(rows) {
  if (!rows.length) return { mine: [], opp: [] };
  const runs = [];
  rows.forEach((row) => {
    const last = runs[runs.length - 1];
    if (last && last.slot === row.slot) last.count += 1;
    else runs.push({ slot: row.slot, count: 1 });
  });
  const paired = runs.length > 1 && runs.every((run) => run.count === 2);
  if (paired) {
    return {
      mine: rows.filter((_, index) => index % 2 === 0),
      opp: rows.filter((_, index) => index % 2 === 1)
    };
  }
  const firstSlot = rows[0].slot;
  const restart = rows.findIndex((row, index) => (
    index >= 4 && row.slot === firstSlot && rows[index - 1].slot !== firstSlot
  ));
  if (restart > 0) {
    return { mine: rows.slice(0, restart), opp: rows.slice(restart) };
  }
  return { mine: rows, opp: [] };
}

function finishStarter(player, side, oppName) {
  return {
    name: player.name,
    nflTeam: player.nflTeam,
    position: player.position,
    slot: player.slot || player.position,
    team: player.team || player.nflTeam,
    gameMatchup: player.gameMatchup || '',
    points: player.points || 0,
    projPoints: player.projPoints != null
      ? player.projPoints
      : (Number(player.points) > 0 ? Number(player.points) : null),
    actualPoints: player.actualPoints ?? null,
    isLive: Boolean(player.isLive),
    inRedZone: false,
    gameClock: player.gameClock || player.gameMatchup || 'Scheduled',
    bigPlay: null,
    isStarter: true,
    ownership: side === 'mine' ? 1.0 : 0,
    isThreat: side !== 'mine',
    opponent: side === 'mine' ? null : oppName
  };
}

function findMarker(text, marker) {
  return String(text || '').toLowerCase().indexOf(String(marker || '').toLowerCase());
}

export function isEspnFullBoxScore(raw) {
  return /The Zulu Nation|Daddy Tags Box Score|OFFENSIVE PLAYERS/i.test(String(raw || ''));
}

export function parseEspnMatchup(rawText) {
  const leagueName = 'The Zulu Nation';
  const source = String(rawText || '');
  const team2SplitIndex = findMarker(source, 'Laudy Donks Box Score');
  let team1Raw = '';
  let team2Raw = '';

  if (team2SplitIndex !== -1) {
    team1Raw = source.substring(0, team2SplitIndex);
    team2Raw = source.substring(team2SplitIndex);
  } else {
    team1Raw = source;
  }

  const VALID_STARTER_SLOTS = new Set(['QB', 'RB', 'WR', 'TE', 'FLEX', 'RB/WR', 'DP', 'K', 'D/ST']);
  const BOX_TEAMS = new Set([
    'ARI', 'ATL', 'BAL', 'BUF', 'CAR', 'CHI', 'CIN', 'CLE', 'DAL', 'DEN',
    'DET', 'GB', 'HOU', 'IND', 'JAX', 'KC', 'LV', 'LAC', 'LAR', 'MIA',
    'MIN', 'NE', 'NO', 'NYG', 'NYJ', 'PHI', 'PIT', 'SF', 'SEA', 'TB', 'TEN', 'WSH'
  ]);

  function parseTeamRoster(teamText) {
    const starters = [];
    const sections = ['OFFENSIVE PLAYERS', 'DEFENSIVE PLAYERS', 'KICKERS', 'TEAM D/ST'];

    for (let s = 0; s < sections.length; s++) {
      const sectionName = sections[s];
      const startIdx = findMarker(teamText, sectionName);
      if (startIdx === -1) continue;

      const subChunk = teamText.substring(startIdx + sectionName.length);
      const benchIdx = findMarker(subChunk, 'Bench');
      const totalsIdx = findMarker(subChunk, 'TOTALS');

      let endIdx = subChunk.length;
      if (benchIdx !== -1 && totalsIdx !== -1) {
        endIdx = Math.min(benchIdx, totalsIdx);
      } else if (benchIdx !== -1) {
        endIdx = benchIdx;
      } else if (totalsIdx !== -1) {
        endIdx = totalsIdx;
      }

      const starterText = subChunk.substring(0, endIdx);
      const lines = starterText.split('\n').map((l) => l.trim()).filter((l) => {
        if (!l.length) return false;
        const key = l.toUpperCase();
        if (key === 'SLOT' || key === 'PLAYER, TEAM POS' || key === 'OPP' || key === 'STATUS') return false;
        if (l.toUpperCase().includes('NFL WEEK')) return false;
        return true;
      });

      const isNewStarter = (index) => {
        const slot = String(lines[index] || '').toUpperCase();
        if (!VALID_STARTER_SLOTS.has(slot)) return false;
        const next = lines[index + 1] || '';
        if (!next || next.startsWith('@') || /^vs\b/i.test(next)) return false;
        if (BOX_TEAMS.has(next.toUpperCase()) || VALID_STARTER_SLOTS.has(next.toUpperCase())) return false;
        if (/^(Q|IR|O|D|P|OUT|QUESTIONABLE|DOUBTFUL)$/i.test(next)) return false;
        if (/^(?:Sun|Mon|Tue|Wed|Thu|Fri|Sat|Final|Halftime|Q[1-4])\b/i.test(next)) return false;
        return true;
      };

      let i = 0;
      while (i < lines.length) {
        const slotCandidate = isNewStarter(i) ? lines[i].toUpperCase() : '';

        if (slotCandidate) {
          let playerName = '';
          let team = '';
          let pos = slotCandidate;
          let opp = '';

          let j = 1;
          const tokens = [];
          while (i + j < lines.length && !isNewStarter(i + j) && j <= 7) {
            tokens.push(lines[i + j]);
            j += 1;
          }

          if (tokens.length >= 1) {
            playerName = cleanPlayerName(tokens[0]);

            if (slotCandidate === 'D/ST') {
              pos = 'D/ST';
              for (const tok of tokens) {
                const upper = tok.toUpperCase();
                if (BOX_TEAMS.has(upper)) team = upper;
                if (tok.startsWith('@') || /^vs\b/i.test(tok)) opp = tok;
              }
              if (!playerName.toLowerCase().includes('d/st')) playerName += ' D/ST';
            } else {
              for (let t = 1; t < tokens.length; t++) {
                const tok = tokens[t].toUpperCase();
                if (!team && BOX_TEAMS.has(tok)) team = tok;
                if (!opp && (tokens[t].startsWith('@') || /^vs\b/i.test(tokens[t]))) opp = tokens[t];
              }
            }

            if (playerName && (team || pos === 'D/ST')) {
              starters.push({
                id: `${playerName}-${team}-${pos}`.toLowerCase().replace(/[^a-z0-9]/g, '-'),
                name: cleanPlayerName(playerName),
                team: team || 'NFL',
                position: pos,
                opponent: opp || ''
              });
            }
          }
          i += j;
        } else {
          i += 1;
        }
      }
    }

    return starters;
  }

  const team1Starters = parseTeamRoster(team1Raw);
  const team2Starters = parseTeamRoster(team2Raw);

  return {
    id: `espn-${Date.now()}`,
    name: leagueName,
    platform: 'ESPN',
    userTeam: {
      name: 'Daddy Tags',
      starters: team1Starters
    },
    oppTeam: {
      name: 'Laudy Donks',
      starters: team2Starters
    }
  };
}

function adaptFullBoxScore(parsed) {
  const adapt = (player, side) => {
    const nflTeam = player.team && player.team !== 'NFL' ? player.team : '';
    const game = player.opponent || '';
    return {
      ...player,
      nflTeam,
      slot: player.position,
      gameMatchup: game,
      gameClock: game || 'Scheduled',
      points: 0,
      projPoints: null,
      actualPoints: null,
      isLive: false,
      inRedZone: false,
      bigPlay: null,
      isStarter: true,
      ownership: side === 'mine' ? 1 : 0,
      isThreat: side !== 'mine'
    };
  };
  const mine = (parsed.userTeam?.starters || []).map((player) => adapt(player, 'mine'));
  const opp = (parsed.oppTeam?.starters || []).map((player) => adapt(player, 'opp'));
  return {
    ...parsed,
    leagueName: parsed.name,
    myTeamName: parsed.userTeam?.name || 'Daddy Tags',
    oppTeamName: parsed.oppTeam?.name || 'Laudy Donks',
    myScore: 0,
    oppScore: 0,
    userTeam: { ...parsed.userTeam, starters: mine },
    oppTeam: { ...parsed.oppTeam, starters: opp },
    myStarters: mine,
    oppStarters: opp
  };
}

const DOUBLED_NAME_RE = /^(.{3,}?)\1$/i;
const POINTS_LINE_RE = /^(?:--|[-–—]|\d{1,3}(?:\.\d{1,2})?)$/;

function isDoubledName(line) {
  return DOUBLED_NAME_RE.test(String(line || '').trim());
}

function isPointsLine(line) {
  return POINTS_LINE_RE.test(String(line || '').trim());
}

function parsePointsLine(line) {
  const text = String(line || '').trim();
  if (!/^\d/.test(text)) return null;
  const value = parseFloat(text);
  return Number.isFinite(value) ? value : null;
}

function kickoffFields(line) {
  const text = String(line || '').trim();
  const match = text.match(/^(@|vs\.?|at)?\s*([A-Za-z]{2,3})\b/i);
  const team = match ? canonTeam(match[2]) : '';
  const away = Boolean(match && /^(@|at)$/i.test(match[1] || ''));
  return {
    gameMatchup: team ? `${away ? '@' : 'vs'} ${team}` : '',
    gameClock: text || 'Scheduled'
  };
}

function readSidePlayer(lines, start) {
  const name = cleanPlayerName(lines[start]);
  let i = start + 1;
  if (
    i < lines.length
    && !isDoubledName(lines[i])
    && !canonTeam(lines[i])
    && !STATUS_ONLY_RE.test(lines[i])
    && !SLOT_ONLY_RE.test(lines[i])
    && !POS_ONLY_RE.test(lines[i])
    && !isKickoffLine(lines[i])
    && !isPointsLine(lines[i])
    && !/^totals?$/i.test(lines[i])
  ) {
    i += 1;
  }
  if (i < lines.length && STATUS_ONLY_RE.test(lines[i])) i += 1;
  let nflTeam = '';
  let position = '';
  let kickoff = '';
  if (i < lines.length && canonTeam(lines[i])) {
    nflTeam = canonTeam(lines[i]);
    i += 1;
  }
  if (i < lines.length && (POS_ONLY_RE.test(lines[i]) || SLOT_ONLY_RE.test(lines[i]))) {
    position = normalizeEspnPos(lines[i]);
    i += 1;
  }
  if (i < lines.length && isKickoffLine(lines[i])) {
    kickoff = lines[i];
    i += 1;
  }
  const clock = kickoffFields(kickoff);
  const display = /d\/st/i.test(name) ? defenseDisplayName(name) : name;
  const resolvedTeam = nflTeam || nicknameToTeam(display);
  const player = display && resolvedTeam
    ? {
      name: display,
      nflTeam: resolvedTeam,
      team: resolvedTeam,
      position: position || (resolvedTeam ? 'D/ST' : ''),
      slot: position || 'D/ST',
      gameMatchup: clock.gameMatchup,
      gameClock: kickoff || 'Scheduled',
      points: 0,
      projPoints: null,
      actualPoints: null,
      isLive: false
    }
    : null;
  return { player, next: i };
}

function headerNameLike(line) {
  const text = String(line || '').trim();
  if (!text || !/[A-Za-z]/.test(text)) return false;
  if (RECORD_RE.test(text) || SCORE_RE.test(text) || isEspnChromeLine(text)) return false;
  if (/^chance to win$/i.test(text) || /on field|in red zone/i.test(text) || /^\d{1,3}%$/.test(text)) return false;
  return true;
}

function parseSideHeader(lines) {
  const teams = [];
  lines.forEach((line, index) => {
    if (!RECORD_RE.test(line)) return;
    const prev = lines[index - 1];
    const prev2 = lines[index - 2];
    const name = headerNameLike(prev2) && headerNameLike(prev)
      ? prev2
      : (headerNameLike(prev) ? prev : '');
    const recordMatch = line.match(/(\d{1,2})-(\d{1,2})(?:-(\d{1,2}))?/);
    const record = recordMatch
      ? {
        wins: Number(recordMatch[1]),
        losses: Number(recordMatch[2]),
        ties: recordMatch[3] == null ? 0 : Number(recordMatch[3])
      }
      : null;
    let score = null;
    let projectedScore = null;
    for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
      if (RECORD_RE.test(lines[cursor])) break;
      if (score == null && SCORE_RE.test(lines[cursor])) score = parseFloat(lines[cursor]);
      const proj = String(lines[cursor]).match(/proj(?:ected)?\s*total\s*:?\s*(\d{1,3}(?:\.\d{1,2})?)/i);
      if (proj) projectedScore = parseFloat(proj[1]);
    }
    if (name) teams.push({ name, record, score: score ?? 0, projectedScore });
  });
  return {
    userName: teams[0]?.name || 'My Team',
    oppName: teams[1]?.name || 'Opponent',
    myScore: teams[0]?.score ?? 0,
    oppScore: teams[1]?.score ?? 0,
    myProjected: teams[0]?.projectedScore ?? null,
    oppProjected: teams[1]?.projectedScore ?? null,
    myRecord: teams[0]?.record || null,
    oppRecord: teams[1]?.record || null
  };
}

function applySidePoints(player, value) {
  if (!player || value == null) return player;
  return { ...player, points: value, actualPoints: value };
}

export function isEspnSideBySidePaste(raw) {
  const lines = splitPasteLines(raw);
  if (lines.filter((line) => isDoubledName(line)).length < 4) return false;
  return /proj(?:ected)?\s*total|in play:|chance to win|on field/i.test(String(raw || ''));
}

function parseEspnSideBySide(raw) {
  const lines = splitPasteLines(raw);
  const start = lines.findIndex((line) => isDoubledName(line));
  const header = parseSideHeader(start > 0 ? lines.slice(0, start) : []);
  const mine = [];
  const opp = [];
  let i = Math.max(start, 0);
  while (i < lines.length) {
    if (/^totals?$/i.test(lines[i])) break;
    if (!isDoubledName(lines[i])) {
      i += 1;
      continue;
    }
    const left = readSidePlayer(lines, i);
    i = left.next;
    let leftPoints = null;
    if (i < lines.length && isPointsLine(lines[i])) {
      leftPoints = parsePointsLine(lines[i]);
      i += 1;
    }
    let slot = '';
    if (i < lines.length && (SLOT_ONLY_RE.test(lines[i]) || POS_ONLY_RE.test(lines[i]))) {
      slot = normalizeEspnPos(lines[i]);
      i += 1;
    }
    let rightPoints = null;
    if (i < lines.length && isPointsLine(lines[i])) {
      rightPoints = parsePointsLine(lines[i]);
      i += 1;
    }
    let right = null;
    if (i < lines.length && isDoubledName(lines[i])) {
      right = readSidePlayer(lines, i);
      i = right.next;
    }
    const leftPlayer = applySidePoints(left.player, leftPoints);
    const rightPlayer = right ? applySidePoints(right.player, rightPoints) : null;
    if (leftPlayer) mine.push(slot ? { ...leftPlayer, slot } : leftPlayer);
    if (rightPlayer) opp.push(slot ? { ...rightPlayer, slot } : rightPlayer);
  }
  return { header, mine, opp };
}

function packSideBySide(parsed) {
  const header = parsed.header;
  const oppName = header.oppName;
  const userTeam = {
    name: header.userName,
    score: header.myScore,
    projectedScore: header.myProjected,
    record: header.myRecord,
    starters: parsed.mine.map((player) => finishStarter(player, 'mine', oppName))
  };
  const oppTeam = {
    name: oppName,
    score: header.oppScore,
    projectedScore: header.oppProjected,
    record: header.oppRecord,
    starters: parsed.opp.map((player) => finishStarter(player, 'opp', oppName))
  };
  return {
    id: `espn-${Date.now()}`,
    name: userTeam.name || 'ESPN League',
    leagueName: '',
    platform: 'ESPN',
    myScore: header.myScore,
    oppScore: header.oppScore,
    myProj: header.myProjected,
    oppProj: header.oppProjected,
    myRecord: header.myRecord,
    oppRecord: header.oppRecord,
    userTeam,
    oppTeam,
    myTeamName: userTeam.name,
    oppTeamName: oppTeam.name,
    myStarters: userTeam.starters,
    oppStarters: oppTeam.starters
  };
}

export function isEspnMatchupText(raw) {
  const text = String(raw || '');
  if (isEspnFullBoxScore(text) || isEspnSideBySidePaste(text)) return true;
  const lines = splitPasteLines(text);
  const rowHits = lines.filter((line) => isEspnPlayerRow(line)).length;
  if (/\bPLAYER,\s*TEAM\s*POS\b/i.test(text) && (rowHits >= 1 || lines.some((line) => SLOT_ONLY_RE.test(line)))) return true;
  if (rowHits >= 2) return true;
  const undashedTeamPos = lines.some((line) => new RegExp(`^[A-Za-z]{2,3}\\s+(?:${POS_ALT})$`, 'i').test(line) && canonTeam(line.split(/\s+/)[0]));
  const hasStarters = lines.some((line) => STARTERS_RE.test(line));
  if (hasStarters && (rowHits >= 1 || undashedTeamPos)) return true;
  return false;
}

function sameTeamName(a, b) {
  return String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();
}

function collectRosters(lines, teamNames) {
  const rosters = [];
  let mode = 'seek';
  let buffer = [];
  let currentName = '';
  let pendingName = '';
  let previous = '';

  const flush = () => {
    const rows = parseStarterSection(buffer);
    buffer = [];
    if (!rows.length) return;
    rosters.push({
      name: currentName || teamNames[rosters.length] || '',
      rows
    });
  };

  lines.forEach((line, index) => {
    if (isKickoffLine(line) || isEspnChromeLine(line)) {
      previous = line;
      return;
    }
    if (STARTERS_RE.test(line)) {
      if (mode === 'starters') flush();
      const labeled = teamNames.find((name) => sameTeamName(name, previous));
      currentName = labeled || (mode === 'after-totals' ? pendingName : '') || teamNames[rosters.length] || '';
      pendingName = '';
      mode = 'starters';
      buffer = [];
      previous = line;
      return;
    }
    if (isRosterStop(line, lines[index + 1])) {
      if (mode === 'starters') flush();
      mode = 'wait';
      pendingName = '';
      previous = line;
      return;
    }
    if (mode === 'starters') {
      buffer.push(line);
      previous = line;
      return;
    }
    if (mode === 'after-totals' && teamNames.some((name) => sameTeamName(name, line))) {
      pendingName = line;
      previous = line;
      return;
    }
    if (mode === 'after-totals' && (isEspnPlayerRow(line) || SLOT_ONLY_RE.test(line))) {
      currentName = pendingName || teamNames[rosters.length] || '';
      pendingName = '';
      mode = 'starters';
      buffer = [line];
      previous = line;
      return;
    }
    previous = line;
  });
  if (mode === 'starters') flush();
  return rosters;
}

export function parseEspnMatchupText(raw) {
  if (isEspnSideBySidePaste(raw)) return packSideBySide(parseEspnSideBySide(raw));
  if (isEspnFullBoxScore(raw)) return adaptFullBoxScore(parseEspnMatchup(raw));
  const lines = splitPasteLines(raw);
  const contentStart = lines.findIndex((line) => STARTERS_RE.test(line) || isEspnPlayerRow(line));
  const header = parseHeader(contentStart > 0 ? lines.slice(0, contentStart) : []);
  const teamNames = [header.userName, header.oppName].filter((name) => name && name !== 'My Team' && name !== 'Opponent');
  let rosters = collectRosters(lines, teamNames);
  if (rosters.length === 1 && rosters[0].rows.length) {
    const split = splitSides(rosters[0].rows);
    if (split.opp.length) {
      rosters = [
        { name: rosters[0].name || header.userName, rows: split.mine },
        { name: header.oppName, rows: split.opp }
      ];
    }
  }
  if (!rosters.length) {
    const fallback = parseStarterSection(lines);
    if (fallback.length) {
      const split = splitSides(fallback);
      rosters = [
        { name: header.userName, rows: split.mine },
        { name: header.oppName, rows: split.opp }
      ].filter((roster) => roster.rows.length);
    }
  }

  const mine = rosters[0]?.rows || [];
  const opp = rosters[1]?.rows || [];
  const userName = rosters[0]?.name || header.userName;
  const oppName = rosters[1]?.name || header.oppName;
  const leagueName = header.leagueName || '';

  const userTeam = {
    name: userName,
    score: header.myScore,
    projectedScore: header.myProjected,
    starters: mine.map((player) => finishStarter(player, 'mine', oppName))
  };
  const oppTeam = {
    name: oppName,
    score: header.oppScore,
    projectedScore: header.oppProjected,
    starters: opp.map((player) => finishStarter(player, 'opp', oppName))
  };

  return {
    id: `espn-${Date.now()}`,
    name: leagueName || (userTeam.name && userTeam.name !== 'My Team' ? userTeam.name : 'ESPN League'),
    leagueName,
    platform: 'ESPN',
    myScore: header.myScore,
    oppScore: header.oppScore,
    userTeam,
    oppTeam,
    myTeamName: userTeam.name,
    oppTeamName: oppTeam.name,
    myStarters: userTeam.starters,
    oppStarters: oppTeam.starters
  };
}
