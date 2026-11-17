/**
 * Smoke checks for native Yahoo capture → league mapping helpers (no Capacitor).
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const nativeSource = readFileSync(join(root, 'src/utils/yahooNative.js'), 'utf8');
const fantasySource = readFileSync(join(root, 'lib/yahooFantasy.js'), 'utf8');
const appSource = readFileSync(join(root, 'src/App.jsx'), 'utf8');

assert(nativeSource.includes('myWinOdds'), 'yahooNative maps myWinOdds');
assert(nativeSource.includes('oppWinOdds'), 'yahooNative maps oppWinOdds');
assert(nativeSource.includes('oppLogo'), 'yahooNative maps oppLogo');
assert(nativeSource.includes('yahooStatsOk'), 'yahooNative sets yahooStatsOk');
assert(nativeSource.includes('Never allow Team 2 to clone'), 'clone guard comment present');
assert(nativeSource.includes("oppTeamName === myTeamName"), 'clone detection compares team names');
assert(nativeSource.includes('Keep actual and projection distinct'), 'starter mapping keeps proj out of actual');

assert(fantasySource.includes('winOdds'), 'API readTeamSide exposes winOdds');
assert(fantasySource.includes('teamMetaParts'), 'API isolates team meta parts');
assert(fantasySource.includes('SUCK CITY') === false, 'fixture names stay in tests only');
assert(fantasySource.includes('resolvedOppName'), 'importYahooLeagues uses resolvedOppName');

assert(appSource.includes('yahooWinOddsPair'), 'matchupOutlook prefers Yahoo win odds');
assert(appSource.includes('liveToast'), 'floating toast state exists');
assert(appSource.includes('notifUnread'), 'unread badge state exists');
assert(appSource.includes('playerEligibleForLiveAlert'), 'live alert gate exists');

function numberOrNull(value) {
  if (value == null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function usableName(value, fallback) {
  const text = String(value || '').trim();
  if (!text || /^(my team|opponent|league|matchup|players|standings|yahoo(?:\s+\d+)?)$/i.test(text)) return fallback;
  return text;
}

/** Mirrors fromStructured clone guard. */
function normalizeSides(lineup) {
  const myTeamName = usableName(lineup.myTeamName, '');
  let oppTeamName = usableName(lineup.oppTeamName, '');
  if (oppTeamName && myTeamName && oppTeamName === myTeamName) {
    const sameScore = numberOrNull(lineup.myScore) != null
      && numberOrNull(lineup.myScore) === numberOrNull(lineup.oppScore);
    const sameRecord = String(lineup.myRecord || '') === String(lineup.oppRecord || '');
    if (sameScore || sameRecord) oppTeamName = '';
  }
  return {
    leagueName: usableName(lineup.leagueName, '') || 'Yahoo League',
    myTeamName,
    oppTeamName: oppTeamName || 'Opponent',
    myScore: numberOrNull(lineup.myScore),
    oppScore: oppTeamName ? numberOrNull(lineup.oppScore) : null,
    myWinOdds: numberOrNull(lineup.myWinOdds),
    oppWinOdds: oppTeamName ? numberOrNull(lineup.oppWinOdds) : null
  };
}

const good = normalizeSides({
  leagueName: 'BCliff Football',
  myTeamName: 'YANNACONDA 🐍',
  oppTeamName: 'SUCK CITY',
  myScore: '107.32',
  oppScore: '76.07',
  myWinOdds: '79',
  oppWinOdds: '21'
});
assert(good.leagueName === 'BCliff Football', good.leagueName);
assert(good.oppTeamName === 'SUCK CITY', good.oppTeamName);
assert(good.myScore === 107.32, String(good.myScore));
assert(good.oppScore === 76.07, String(good.oppScore));
assert(good.myWinOdds === 79 && good.oppWinOdds === 21, 'win odds');

const cloned = normalizeSides({
  leagueName: 'BCliff Football',
  myTeamName: 'YANNACONDA',
  oppTeamName: 'YANNACONDA',
  myRecord: '8-2-0',
  oppRecord: '8-2-0',
  myScore: '65.28',
  oppScore: '65.28'
});
assert(cloned.oppTeamName === 'Opponent', `cloned opp → ${cloned.oppTeamName}`);
assert(cloned.oppScore == null, `cloned score → ${cloned.oppScore}`);

console.log('verify-yahoo-capture-mapping: ok');
