const SLOT_TOKEN_RE = /^(QB|RB|WR|TE|W\/R\/T|FLEX|K|DEF|D|DB|DL|LB)$/i;
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
  if (key === 'D/ST' || key === 'DST') return 'DEF';
  if (key === 'PK') return 'K';
  return key;
}

function normalizeSlot(slot) {
  const key = String(slot || '').toUpperCase();
  if (key === 'W/R/T' || key === 'WR/TE' || key === 'W/R') return 'FLEX';
  if (key === 'D/ST' || key === 'DST') return 'DEF';
  if (key === 'D') return 'IDP';
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
  if (isOpponentMark(text) || isLeagueLine(text)) return false;
  const cleaned = stripNameNoise(text);
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
      if (text && !isOpponentMark(text)) lines.push(text);
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

function teamNameBefore(header, index) {
  const names = [];
  for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
    const prev = header[cursor];
    if (RECORD_RE.test(prev)) break;
    if (isLeagueLine(prev) || isOpponentMark(prev)) continue;
    if (isNameLine(prev)) names.unshift(stripNameNoise(prev));
  }
  return names[0] || '';
}

function projectionAfter(header, index) {
  let proj = null;
  for (let cursor = index + 1; cursor < header.length; cursor += 1) {
    const line = header[cursor];
    if (RECORD_RE.test(line) || isNameLine(line)) break;
    if (isFloatLine(line) && proj == null) proj = parseFloat(line);
  }
  return proj;
}

function parseYahooHeader(lines) {
  const leagueLine = lines.find((line) => isLeagueLine(line));
  const leagueName = leagueLine ? (leagueLine.match(LEAGUE_LINE_RE)?.[1] || '').trim() : '';
  const startersAt = lines.findIndex((line) => /^starters$/i.test(line));
  const firstSlot = lines.findIndex((line) => SLOT_TOKEN_RE.test(line));
  const end = startersAt >= 0 ? startersAt : (firstSlot >= 0 ? firstSlot : lines.length);
  const header = lines.slice(0, end);
  const teams = [];
  header.forEach((line, index) => {
    const record = readRecord(line, header[index + 1]);
    if (!record) return;
    teams.push({
      name: teamNameBefore(header, index),
      record: { wins: record.wins, losses: record.losses, ties: record.ties },
      rank: record.rank,
      proj: projectionAfter(header, index),
      score: null
    });
  });
  if (teams.length && teams.every((team) => team.proj == null)) {
    const floats = header.filter(isFloatLine).map((line) => parseFloat(line));
    teams.forEach((team, index) => {
      if (floats[index] != null) team.proj = floats[index];
    });
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

function readScorePair(nums, projFirst) {
  if (nums.length >= 2) {
    return projFirst
      ? { projPoints: nums[nums.length - 2], actualPoints: nums[nums.length - 1] }
      : { projPoints: nums[nums.length - 1], actualPoints: nums[0] };
  }
  if (nums.length === 1) return { projPoints: nums[0], actualPoints: null };
  return { projPoints: null, actualPoints: null };
}

function toStarterRecord(player, side) {
  const isMine = side === 'mine';
  const proj = player.projPoints ?? player.points ?? 0;
  const actual = player.actualPoints ?? null;
  return {
    name: cleanYahooPlayerName(player.name),
    nflTeam: player.nflTeam,
    position: player.position,
    slot: player.slot || player.position,
    points: actual ?? proj ?? 0,
    projPoints: proj ?? 0,
    actualPoints: actual,
    isLive: /^(1st|2nd|3rd|4th|OT|Q)/i.test(player.gameClock || ''),
    inRedZone: false,
    gameClock: player.gameClock || 'Scheduled',
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
  const nums = [];
  while (idx >= 0 && (isFloatLine(lines[idx]) || isDash(lines[idx]))) {
    if (isFloatLine(lines[idx])) nums.unshift(parseFloat(lines[idx]));
    idx -= 1;
  }
  const scores = readScorePair(nums, true);

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
    points: scores.actualPoints ?? scores.projPoints ?? 0,
    projPoints: scores.projPoints,
    actualPoints: scores.actualPoints,
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
    if (nums.length >= 2) break;
  }
  while (i < lines.length && isDash(lines[i])) i += 1;
  const scores = readScorePair(nums, false);

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
      points: scores.actualPoints ?? scores.projPoints ?? 0,
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
