import { canonTeamCode, displayPlayerPosition } from './playerIdentity';

const SLOT_TOKEN_RE = /^(QB|RB|WR|TE|W\/R\/T|FLEX|K|DEF|D\/ST|DST|IDP|D|DB|DL|LB)$/i;
const HEADER_CELL_RE = /^(stats|player|proj|pts|projected|points|pos)$/i;
const GENERIC_YAHOO_RE = /^(my team|league(?:\s*\d+)?|matchup|players|standings|mail|inbox|account|my account|sign in|sign out|settings|home|news|profile|notifications?)$/i;
const STAT_BLURB_RE = /\d.*\b(rush|rec|pass|yds|yards|td|int|sack)\b/i;
const STOP_SLOT_RE = /^(BN|IR|BENCH|IL|NA)$/i;
const TEAM_POS_RE = /^([A-Za-z]{2,3})\s*[-–]\s*([A-Za-z/]+)$/;
const DASH_RE = /^[-–—]$/;
const FLOAT_RE = /^\d+\.\d{1,2}$/;
const YAHOO_UI_NOISE_RE = /(Video\s*Forecast|New\s*Player\s*Note|No\s*new\s*player\s*Notes|Player\s*Note)/gi;
const NAME_NOISE_LINE_RE = /^(?:No new player Notes|Video Forecast|New Player Note|Player Note|PUP|SUSP|IR|Q|O)$/i;
const OPPONENT_MARK_RE = /^(?:@|vs\.?|at)\s+[A-Za-z]{2,3}$/i;
const LEAGUE_LINE_RE = /^League:\s*(.+)$/i;
const NAME_NOISE_SUFFIX_RE = /(?:\s+(?:PUP|SUSP|IR|Q|O))+$/i;
const RECORD_RE = /^(\d{1,2})-(\d{1,2})-(\d{1,2})(?:\s*\|\s*(\d+)(?:st|nd|rd|th)?)?$/i;
const RANK_RE = /^(\d+)(?:st|nd|rd|th)$/i;
const DUAL_ROW_RE = /^(.+?)\s+([A-Za-z]{2,3})\s*[-–]\s*([A-Za-z/]+)\s+(\d+\.\d{1,2})\s+(QB|RB|WR|TE|W\/R\/T|FLEX|K|DEF|D|DB|DL|LB)\s+(\d+\.\d{1,2})\s+(.+?)\s+([A-Za-z]{2,3})\s*[-–]\s*([A-Za-z/]+)$/i;

function normalizePosition(pos) {
  const key = String(pos || '').toUpperCase();
  if (key === 'DEF' || key === 'D/ST' || key === 'DST') return 'D/ST';
  if (key === 'D' || key === 'DB' || key === 'DL' || key === 'LB') return 'IDP';
  if (key === 'PK') return 'K';
  return key;
}

function normalizeSlot(slot) {
  const key = String(slot || '').toUpperCase();
  if (key === 'W/R/T' || key === 'WR/TE' || key === 'W/R') return 'FLEX';
  if (key === 'DEF' || key === 'D/ST' || key === 'DST') return 'D/ST';
  if (key === 'D' || key === 'DB' || key === 'DL' || key === 'LB') return 'IDP';
  return key;
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

function isYahooStarterStop(line) {
  const text = String(line || '').trim();
  return STOP_SLOT_RE.test(text) || /bench players/i.test(text) || /^bench$/i.test(text) || /^total\b/i.test(text);
}

function isOpponentMark(line) {
  return OPPONENT_MARK_RE.test(String(line || '').trim());
}

function isLeagueLine(line) {
  return LEAGUE_LINE_RE.test(String(line || '').trim());
}

function isYahooChromeLine(line) {
  return /^(week\b.*|starters|bench|projected|projection|proj\b.*|matchup|yahoo|fantasy|points|pts|vs\.?|edit|live|recap)$/i.test(String(line || '').trim());
}

export function cleanYahooPlayerName(raw) {
  YAHOO_UI_NOISE_RE.lastIndex = 0;
  let text = String(raw || '').replace(YAHOO_UI_NOISE_RE, '').replace(/\s+/g, ' ').trim();
  if (!text || NAME_NOISE_LINE_RE.test(text)) return '';
  let prev = '';
  while (text && text !== prev) {
    prev = text;
    text = text.replace(NAME_NOISE_SUFFIX_RE, '').trim();
  }
  return text.replace(/\s+/g, ' ').trim();
}

function stripNameNoise(raw) {
  return cleanYahooPlayerName(raw);
}

function isNameLine(line) {
  const text = String(line || '').trim();
  if (!text || isDash(text) || isFloatLine(text) || SLOT_TOKEN_RE.test(text) || isYahooStarterStop(text) || isTeamPosLine(text)) return false;
  if (isGameLine(text) || isStatLine(text) || RECORD_RE.test(text) || RANK_RE.test(text) || isYahooChromeLine(text)) return false;
  if (isOpponentMark(text) || isLeagueLine(text) || HEADER_CELL_RE.test(text) || GENERIC_YAHOO_RE.test(text) || STAT_BLURB_RE.test(text)) return false;
  const cleaned = stripNameNoise(text);
  if (cleaned.length < 2 || cleaned.length > 80) return false;
  return /[A-Za-z]/.test(cleaned);
}

function parseTeamPos(line) {
  const match = String(line || '').trim().match(TEAM_POS_RE);
  if (!match) return { nflTeam: '', position: '' };
  const rawTeam = match[1].toUpperCase();
  return {
    nflTeam: canonTeamCode(rawTeam) || rawTeam,
    position: normalizePosition(match[2])
  };
}

function expandDualRow(line) {
  const match = String(line || '').trim().match(DUAL_ROW_RE);
  if (!match) return null;
  return [
    match[1].trim(),
    `${match[2]} - ${match[3]}`,
    match[4],
    match[5].toUpperCase(),
    match[6],
    match[7].trim(),
    `${match[8]} - ${match[9]}`
  ];
}

function splitGluedFloat(text) {
  const match = String(text || '').trim().match(/^(\d+\.\d{1,2})\s+(.+)$/);
  if (!match) return [String(text || '').trim()].filter(Boolean);
  const rest = match[2].trim();
  if (SLOT_TOKEN_RE.test(rest) || isTeamPosLine(rest) || isNameLine(rest)) {
    return [match[1], ...splitGluedFloat(rest)];
  }
  return [String(text || '').trim()];
}

function explodeYahooLine(line) {
  const text = String(line || '').trim();
  if (!text) return [];
  const dual = expandDualRow(text);
  if (dual) return dual;
  const labeled = text.match(/^(?:proj(?:ected)?\s+)?(\d+\.\d{1,2})(?:\s+proj(?:ected)?)?$/i);
  if (labeled) return [labeled[1]];
  return text.split(/\s{2,}|\t/).flatMap((piece) => splitGluedFloat(piece));
}

function yahooLines(raw) {
  const lines = [];
  String(raw || '').replace(/\r/g, '').split('\n').forEach((row) => {
    explodeYahooLine(row).forEach((piece) => {
      const text = String(piece || '').trim();
      if (text && !isOpponentMark(text) && !HEADER_CELL_RE.test(text) && !STAT_BLURB_RE.test(text)) lines.push(text);
    });
  });
  return lines;
}

function readRecord(line, nextLine) {
  const match = String(line || '').trim().match(RECORD_RE);
  if (!match) return null;
  const separateRank = String(nextLine || '').trim().match(RANK_RE);
  const rank = match[4] != null ? Number(match[4]) : (separateRank ? Number(separateRank[1]) : null);
  return {
    wins: Number(match[1]),
    losses: Number(match[2]),
    ties: Number(match[3]),
    rank
  };
}

function parseYahooHeader(lines) {
  const leagueLine = lines.find((line) => isLeagueLine(line));
  const leagueRaw = leagueLine ? (leagueLine.match(LEAGUE_LINE_RE)?.[1] || '').trim() : '';
  const leagueName = leagueRaw && !GENERIC_YAHOO_RE.test(leagueRaw) ? leagueRaw : '';
  const startersAt = lines.findIndex((line) => /^starters$/i.test(line));
  const firstSlot = lines.findIndex((line) => SLOT_TOKEN_RE.test(line));
  const end = startersAt >= 0 ? startersAt : (firstSlot >= 0 ? firstSlot : lines.length);
  const header = lines.slice(0, end);
  const names = [];
  const records = [];
  header.forEach((line, index) => {
    const record = readRecord(line, header[index + 1]);
    if (record) {
      records.push({ ...record, index });
      return;
    }
    if (isNameLine(line)) names.push({ name: stripNameNoise(line), index });
  });
  const teams = records.map((record) => ({
    name: '',
    record: { wins: record.wins, losses: record.losses, ties: record.ties },
    rank: record.rank,
    proj: null,
    score: null,
    index: record.index
  }));
  if (teams.length) {
    const firstRecordAt = records[0].index;
    const namesBefore = names.filter((entry) => entry.index < firstRecordAt);
    const namesGrouped = names.length > 0 && names.every((entry) => entry.index < firstRecordAt);
    if (namesGrouped && namesBefore.length >= teams.length) {
      // Side-by-side header: column 0 name, column 1 name, then each column's record.
      teams.forEach((team, index) => {
        team.name = namesBefore[index]?.name || '';
      });
    } else {
      teams.forEach((team, index) => {
        const prevAt = index === 0 ? -1 : records[index - 1].index;
        const between = names.filter((entry) => entry.index > prevAt && entry.index < team.index);
        team.name = between.length ? between[between.length - 1].name : '';
      });
      const used = new Set(teams.map((team) => team.name).filter(Boolean));
      const leftovers = names.map((entry) => entry.name).filter((name) => name && !used.has(name));
      teams.forEach((team) => {
        if (!team.name && leftovers.length) team.name = leftovers.shift();
      });
    }
    teams.forEach((team, index) => {
      const start = records[index].index + 1;
      const stop = index + 1 < records.length ? records[index + 1].index : header.length;
      const floats = [];
      for (let cursor = start; cursor < stop; cursor += 1) {
        if (isNameLine(header[cursor])) break;
        if (isFloatLine(header[cursor])) floats.push(parseFloat(header[cursor]));
      }
      // First number under a record is that column's live total; the next is its projection.
      if (floats[0] != null) team.score = floats[0];
      if (floats[1] != null) team.proj = floats[1];
    });
  }
  if (teams.length && teams.every((team) => team.proj == null && team.score == null)) {
    const floats = header.filter(isFloatLine).map((line) => parseFloat(line));
    // Header floats are usually live totals (one per team). Older layouts may only show proj.
    if (floats.length >= teams.length) {
      teams.forEach((team, index) => {
        if (floats[index] != null) team.score = floats[index];
      });
      if (floats.length >= teams.length * 2) {
        teams.forEach((team, index) => {
          const proj = floats[teams.length + index];
          if (proj != null) team.proj = proj;
        });
      }
    } else {
      teams.forEach((team, index) => {
        if (floats[index] != null) team.proj = floats[index];
      });
    }
  }
  return {
    leagueName,
    myTeamName: teams[0]?.name || '',
    oppTeamName: teams[1]?.name || '',
    myRecord: teams[0]?.record || null,
    oppRecord: teams[1]?.record || null,
    myRank: teams[0]?.rank ?? null,
    oppRank: teams[1]?.rank ?? null,
    myScore: teams[0]?.score ?? null,
    oppScore: teams[1]?.score ?? null,
    myProj: teams[0]?.proj ?? null,
    oppProj: teams[1]?.proj ?? null
  };
}

/**
 * Yahoo stacks two numbers per side. The top slot is actual points
 * ("-" / "—" means unplayed). The bottom slot is the projection and must
 * never be stored as the actual.
 */
function readStackedScores(tokens, gameClock) {
  const liveOrFinal = /^(final|q[1-4]|ot|halftime|1st|2nd|3rd|4th)\b/i.test(String(gameClock || ''));
  if (!tokens || !tokens.length) return { actualPoints: null, projPoints: null };
  if (tokens.length >= 2) {
    return {
      actualPoints: tokens[0].dash ? null : tokens[0].value,
      projPoints: tokens[1].dash ? null : tokens[1].value
    };
  }
  if (tokens[0].dash) return { actualPoints: null, projPoints: null };
  // A lone number is the actual only after kickoff. Pregame lines are projections.
  if (liveOrFinal) return { actualPoints: tokens[0].value, projPoints: null };
  return { actualPoints: null, projPoints: tokens[0].value };
}

function toStarterRecord(player, side) {
  const isMine = side === 'mine';
  const explicitProj = player.projPoints;
  const storedPoints = player.points;
  const proj = explicitProj != null
    ? explicitProj
    : (storedPoints != null && Number(storedPoints) !== 0 ? storedPoints : null);
  const actual = player.actualPoints ?? null;
  const hasYahooStats = actual != null || proj != null;
  const slot = player.slot || player.position;
  const teamRaw = player.nflTeam || player.team || '';
  const clock = player.gameClock || 'Scheduled';
  const final = /^final\b/i.test(clock);
  const live = /^(Q[1-4]|OT|Halftime|1st|2nd|3rd|4th)/i.test(clock);
  return {
    name: cleanYahooPlayerName(player.name),
    nflTeam: canonTeamCode(teamRaw) || String(teamRaw || '').toUpperCase(),
    position: displayPlayerPosition({ position: player.position, slot }),
    slot,
    points: actual != null ? actual : 0,
    projPoints: proj,
    actualPoints: actual,
    scoringSource: hasYahooStats ? 'yahoo' : undefined,
    yahooNative: hasYahooStats,
    isLive: live,
    isFinal: final,
    gameStatus: final ? 'FINAL' : (live ? 'IN_PROGRESS' : 'UPCOMING'),
    inRedZone: false,
    gameClock: clock,
    bigPlay: null,
    isStarter: true,
    ownership: isMine ? 1 : 0,
    isThreat: !isMine,
    opponent: null
  };
}

function parseMySlotBlock(linesBeforeSlot, slotToken) {
  const lines = (linesBeforeSlot || []).map((line) => String(line).trim()).filter(Boolean);
  let idx = lines.length - 1;
  const tokens = [];
  while (idx >= 0 && (isFloatLine(lines[idx]) || isDash(lines[idx]))) {
    if (isDash(lines[idx])) tokens.unshift({ dash: true });
    else tokens.unshift({ dash: false, value: parseFloat(lines[idx]) });
    idx -= 1;
  }

  let gameClock = 'Scheduled';
  if (idx >= 0 && isGameLine(lines[idx])) {
    gameClock = lines[idx];
    idx -= 1;
  }
  const scores = readStackedScores(tokens, gameClock);

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
    points: scores.actualPoints != null ? scores.actualPoints : 0,
    projPoints: scores.projPoints,
    actualPoints: scores.actualPoints,
    gameClock
  };
}

function parseOppSlotBlock(lines, startIndex, slotToken) {
  let i = startIndex;
  const tokens = [];
  while (i < lines.length && (isFloatLine(lines[i]) || isDash(lines[i]))) {
    if (isDash(lines[i])) tokens.push({ dash: true });
    else tokens.push({ dash: false, value: parseFloat(lines[i]) });
    i += 1;
    if (tokens.length >= 2) break;
  }
  while (i < lines.length && isDash(lines[i])) i += 1;

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
  const scores = readStackedScores(tokens, gameClock);

  return {
    player: {
      name,
      nflTeam,
      position,
      slot: normalizeSlot(slotToken),
      points: scores.actualPoints != null ? scores.actualPoints : 0,
      projPoints: scores.projPoints,
      actualPoints: scores.actualPoints,
      gameClock
    },
    nextIndex: i
  };
}

export function parseYahooMatchupText(raw) {
  const lines = yahooLines(raw);
  const stopAt = lines.findIndex((line) => isYahooStarterStop(line) && !STOP_SLOT_RE.test(line));
  const bounded = stopAt === -1 ? lines : lines.slice(0, stopAt);
  const header = parseYahooHeader(bounded);
  const myStarters = [];
  const oppStarters = [];
  let cursor = bounded.findIndex((line) => /^starters$/i.test(line));
  cursor = cursor >= 0 ? cursor + 1 : 0;

  while (cursor < bounded.length) {
    if (isYahooStarterStop(bounded[cursor])) break;
    const slotIdx = bounded.findIndex((line, idx) => idx >= cursor && SLOT_TOKEN_RE.test(line));
    if (slotIdx === -1) break;
    if (bounded.slice(cursor, slotIdx).some(isYahooStarterStop)) break;

    const slotToken = bounded[slotIdx];
    const mine = parseMySlotBlock(bounded.slice(cursor, slotIdx), slotToken);
    const { player: opp, nextIndex } = parseOppSlotBlock(bounded, slotIdx + 1, slotToken);
    if (mine.name) myStarters.push(toStarterRecord(mine, 'mine'));
    if (opp.name) oppStarters.push(toStarterRecord(opp, 'opp'));
    cursor = Math.max(nextIndex, slotIdx + 1);
  }

  return {
    leagueName: header.leagueName || '',
    myTeamName: header.myTeamName || 'My Team',
    oppTeamName: header.oppTeamName || 'Opponent',
    myRecord: header.myRecord,
    oppRecord: header.oppRecord,
    myRank: header.myRank,
    oppRank: header.oppRank,
    myScore: header.myScore,
    oppScore: header.oppScore,
    myProj: header.myProj,
    oppProj: header.oppProj,
    myStarters,
    oppStarters
  };
}

function teamNameKey(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function sameYahooTeam(a, b) {
  const left = teamNameKey(a);
  const right = teamNameKey(b);
  return Boolean(left && right && left === right);
}

function genericYahooSideName(value) {
  return !String(value || '').trim() || /^(opponent|my team)$/i.test(String(value || '').trim());
}

function rosterNameHits(starters, names) {
  const wanted = new Set((names || []).map(teamNameKey).filter(Boolean));
  if (!wanted.size) return 0;
  return (starters || []).filter((player) => wanted.has(teamNameKey(player?.name))).length;
}

function renameSide(team, name) {
  if (!team || typeof team !== 'object') return team;
  return { ...team, name };
}

/**
 * Keep each column's name, record, rank, logo, and roster together.
 * The logged-in team (team id, lobby nickname, or the roster already on the
 * RootMap board) is placed on the left. A nickname that landed on the user
 * while the opponent slot is blank is the opponent's name.
 */
export function alignYahooMatchupSides(parsed, hint = {}) {
  if (!parsed || typeof parsed !== 'object') return parsed;
  const knownName = String(hint.teamName || '').trim();
  const knownId = String(hint.teamId || '').trim();
  const rosterNames = hint.rosterNames || [];

  const swapSides = (source) => ({
    ...source,
    myTeamName: source.oppTeamName,
    oppTeamName: source.myTeamName,
    myRecord: source.oppRecord,
    oppRecord: source.myRecord,
    myRank: source.oppRank,
    oppRank: source.myRank,
    myScore: source.oppScore,
    oppScore: source.myScore,
    myProj: source.oppProj,
    oppProj: source.myProj,
    myLogo: source.oppLogo,
    oppLogo: source.myLogo,
    myTeamId: source.oppTeamId,
    oppTeamId: source.myTeamId,
    myStarters: source.oppStarters,
    oppStarters: source.myStarters,
    userTeam: source.oppTeam,
    oppTeam: source.userTeam
  });

  const idOnRight = Boolean(
    knownId
    && String(parsed.oppTeamId || '') === knownId
    && String(parsed.myTeamId || '') !== knownId
  );
  const nameOnRight = Boolean(
    knownName
    && sameYahooTeam(parsed.oppTeamName, knownName)
    && !sameYahooTeam(parsed.myTeamName, knownName)
  );
  const rightHits = rosterNameHits(parsed.oppStarters, rosterNames);
  const leftHits = rosterNameHits(parsed.myStarters, rosterNames);
  const rosterOnRight = rosterNames.length >= 3 && rightHits >= 3 && rightHits > leftHits;

  let next = (idOnRight || nameOnRight || rosterOnRight) ? swapSides(parsed) : parsed;
  const mine = String(next.myTeamName || '').trim();
  const opp = String(next.oppTeamName || '').trim();
  if (
    knownName
    && !genericYahooSideName(mine)
    && !sameYahooTeam(mine, knownName)
    && genericYahooSideName(opp)
  ) {
    next = {
      ...next,
      myTeamName: knownName,
      oppTeamName: mine,
      userTeam: renameSide(next.userTeam, knownName),
      oppTeam: renameSide(next.oppTeam, mine)
    };
  } else if (knownName && genericYahooSideName(mine)) {
    next = {
      ...next,
      myTeamName: knownName,
      userTeam: renameSide(next.userTeam, knownName)
    };
  }
  return next;
}
