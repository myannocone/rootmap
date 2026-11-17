/**
 * Smoke checks for Yahoo opponent points/name mapping regressions (no Capacitor).
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const swift = readFileSync(join(root, 'ios/App/App/YahooLoginPlugin.swift'), 'utf8');
const native = readFileSync(join(root, 'src/utils/yahooNative.js'), 'utf8');
const fantasy = readFileSync(join(root, 'lib/yahooFantasy.js'), 'utf8');
const app = readFileSync(join(root, 'src/App.jsx'), 'utf8');

// Harvest must split at the slot column — not at the opponent player cell.
assert(swift.includes('splitAt = Math.floor((leftIdx + rightIdx) / 2) + 1'), 'slot-aware float split');
assert(!/mid = foundCells\[1\]/.test(swift), 'must not split floats at opp player index');
assert(swift.includes('teamAnchorName'), 'logo-only team anchors keep identity');
assert(swift.includes('Prefer embedded JSON nicknames'), 'lobby dig runs before sparse links');
assert(swift.includes('projLabeled'), 'enrichSide reads labeled projections');

assert(native.includes("hasYahooStats ? 'yahoo'"), 'structured starters only mark yahooNative with stats');
assert(native.includes('myHasStats && oppHasStats'), 'yahooStatsOk requires both sides');
assert(fantasy.includes('myStatsOk && oppStatsOk'), 'API yahooStatsOk requires both sides');
assert(app.includes('allowSleeperForPlayer'), 'per-player Sleeper fill for scoreless Yahoo rows');

function numberOrNull(value) {
  if (value == null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function usableName(value, fallback) {
  const text = String(value || '').trim();
  if (!text || /^(my team|opponent|league|matchup|players|standings|yahoo(?:\s+\d+)?)$/i.test(text)) {
    return fallback;
  }
  return text;
}

/** Mirrors starterFromStructured + yahooStatsOk gating in yahooNative.js */
function mapCapture({ lineup, identity }) {
  const parsed = typeof lineup === 'string' ? JSON.parse(lineup) : lineup;
  const mapStarter = (player) => {
    const rawActual = player.actualPoints ?? player.points;
    const actualPoints = (rawActual === '' || rawActual == null) ? null : numberOrNull(rawActual);
    const projPoints = numberOrNull(player.projPoints ?? player.projectedPoints);
    const hasYahooStats = actualPoints != null || projPoints != null;
    return {
      name: player.name,
      actualPoints,
      projPoints,
      points: actualPoints != null ? actualPoints : 0,
      yahooNative: hasYahooStats,
      scoringSource: hasYahooStats ? 'yahoo' : undefined
    };
  };
  const myStarters = (parsed.myStarters || []).map(mapStarter);
  const oppStarters = (parsed.oppStarters || []).map(mapStarter);
  const myTeamName = usableName(parsed.myTeamName, '')
    || usableName(identity.teamName, '')
    || 'My Team';
  const leagueName = usableName(parsed.leagueName, '')
    || usableName(identity.leagueName, '')
    || 'Yahoo League';
  const myHasStats = myStarters.some((player) => player.yahooNative)
    || numberOrNull(parsed.myScore) != null
    || numberOrNull(parsed.myProj) != null;
  const oppHasStats = !oppStarters.length
    || oppStarters.some((player) => player.yahooNative)
    || numberOrNull(parsed.oppScore) != null
    || numberOrNull(parsed.oppProj) != null;
  return {
    leagueName,
    myTeamName,
    oppTeamName: usableName(parsed.oppTeamName, 'Opponent'),
    yahooStatsOk: myHasStats && oppHasStats,
    portfolio: myStarters,
    threats: oppStarters,
    oppScore: numberOrNull(parsed.oppScore)
  };
}

const brokenOpp = mapCapture({
  identity: { leagueName: 'BCliff Football', teamName: 'YANNACONDA 🐍' },
  lineup: {
    leagueName: '',
    myTeamName: '',
    oppTeamName: 'SUCK CITY',
    myScore: '76.06',
    oppScore: '',
    myProj: '182.18',
    oppProj: '',
    myStarters: [
      { name: 'Jonathan Taylor', points: '14.96', actualPoints: '14.96', projPoints: '16.2' },
      { name: 'Joe Burrow', points: '', actualPoints: '', projPoints: '' }
    ],
    oppStarters: [
      { name: 'Matthew Stafford', points: '', actualPoints: '', projPoints: '' },
      { name: 'Chuba Hubbard', points: '', actualPoints: '', projPoints: '' }
    ]
  }
});

assert(brokenOpp.leagueName === 'BCliff Football', `leagueName=${brokenOpp.leagueName}`);
assert(brokenOpp.myTeamName.includes('YANNACONDA'), `myTeamName=${brokenOpp.myTeamName}`);
assert(brokenOpp.oppTeamName === 'SUCK CITY', `oppTeamName=${brokenOpp.oppTeamName}`);
assert(brokenOpp.yahooStatsOk === false, 'scoreless opp must clear yahooStatsOk');
assert(brokenOpp.portfolio[0].yahooNative === true, 'scored mine starter is yahooNative');
assert(brokenOpp.portfolio[1].yahooNative === false, 'empty Burrow row is not yahooNative');
assert(brokenOpp.threats.every((player) => player.yahooNative === false), 'scoreless opp rows are not yahooNative');
assert(brokenOpp.threats[0].actualPoints == null, 'missing opp actual stays null');

const healthy = mapCapture({
  identity: { leagueName: 'BCliff Football', teamName: 'YANNACONDA 🐍' },
  lineup: {
    leagueName: 'BCliff Football',
    myTeamName: 'YANNACONDA 🐍',
    oppTeamName: 'SUCK CITY',
    myScore: '76.06',
    oppScore: '54.10',
    myProj: '182.18',
    oppProj: '160.40',
    myStarters: [
      { name: 'Jonathan Taylor', points: '14.96', actualPoints: '14.96', projPoints: '16.2' }
    ],
    oppStarters: [
      { name: 'Chuba Hubbard', points: '9.40', actualPoints: '9.40', projPoints: '12.1' }
    ]
  }
});

assert(healthy.yahooStatsOk === true, 'both sides with stats keep yahooStatsOk');
assert(healthy.threats[0].yahooNative === true, 'scored opp starter is yahooNative');
assert(healthy.oppScore === 54.1, `oppScore=${healthy.oppScore}`);

/** Mirrors the fixed harvest float split. */
function splitFloats(cellTexts, leftPlayerAt, rightPlayerAt) {
  let splitAt = Math.floor((leftPlayerAt + rightPlayerAt) / 2) + 1;
  for (let i = leftPlayerAt + 1; i < rightPlayerAt; i += 1) {
    if (/^(QB|RB|WR|TE|FLEX|K|D\/ST|DP)$/i.test(String(cellTexts[i] || '').trim())) {
      splitAt = i;
      break;
    }
  }
  const floatRe = /\d+\.\d{1,2}/g;
  const left = cellTexts.slice(0, splitAt).join(' ').match(floatRe) || [];
  const right = cellTexts.slice(splitAt).join(' ').match(floatRe) || [];
  return { left, right, splitAt };
}

const row = ['Jonathan Taylor', '16.20', '14.96', 'RB', '9.40', '12.10', 'Chuba Hubbard'];
const split = splitFloats(row, 0, 6);
assert(split.left.join(',') === '16.20,14.96', `left floats ${split.left}`);
assert(split.right.join(',') === '9.40,12.10', `right floats ${split.right}`);

const buggyMid = 6; // old behavior: mid = opp player index
const buggyLeft = row.slice(0, buggyMid).join(' ').match(/\d+\.\d{1,2}/g) || [];
const buggyRight = row.slice(buggyMid).join(' ').match(/\d+\.\d{1,2}/g) || [];
assert(buggyLeft.length === 4 && buggyRight.length === 0, 'documents prior mid=opp-player bug');

console.log('verify-yahoo-opp-points: ok');
