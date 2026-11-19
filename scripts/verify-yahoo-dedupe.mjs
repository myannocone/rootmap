/**
 * Smoke checks for Yahoo league identity + dedupe (no network).
 */
import {
  canonicalLeagueIdentity,
  dedupeImportedLeagues,
  extractYahooLeagueTitle,
  isGenericYahooLeagueName,
  resolvedYahooLeagueName,
  yahooLeagueNumOf,
  yahooTeamNumOf
} from '../src/utils/yahooSync.js';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const apiRow = {
  id: 'yahoo-461.l.123456',
  leagueKey: '461.l.123456',
  yahooLeagueId: '461.l.123456',
  yahooTeamId: '461.l.123456.t.1',
  platform: 'Yahoo',
  name: 'Yahoo League',
  leagueName: 'Yahoo League',
  myTeamName: 'YANNACONDA 🐍',
  portfolio: [{ name: 'A' }, { name: 'B' }]
};

const scrapeRow = {
  id: 'yahoo-123456-1',
  yahooLeagueId: '123456',
  yahooTeamId: '1',
  platform: 'Yahoo',
  name: 'Yahoo League',
  leagueName: 'Yahoo League',
  myTeamName: 'YANNACONDA 🐍',
  portfolio: [{ name: 'A' }]
};

const legacyRow = {
  id: 'yahoo-123456',
  yahooLeagueId: '123456',
  platform: 'Yahoo',
  name: 'Yahoo League',
  leagueName: 'Yahoo League',
  myTeamName: 'YANNACONDA 🐍'
};

const otherTeam = {
  id: 'yahoo-123456-9',
  yahooLeagueId: '123456',
  yahooTeamId: '9',
  platform: 'Yahoo',
  name: 'Other League',
  leagueName: 'Other League',
  myTeamName: 'YANNACONDA JR'
};

assert(yahooLeagueNumOf(apiRow) === '123456', `api league num ${yahooLeagueNumOf(apiRow)}`);
assert(yahooLeagueNumOf(scrapeRow) === '123456', `scrape league num ${yahooLeagueNumOf(scrapeRow)}`);
assert(yahooTeamNumOf(apiRow) === '1', `api team num ${yahooTeamNumOf(apiRow)}`);
assert(yahooTeamNumOf(scrapeRow) === '1', `scrape team num ${yahooTeamNumOf(scrapeRow)}`);

assert(
  canonicalLeagueIdentity(apiRow) === 'yahoo:123456',
  `api identity ${canonicalLeagueIdentity(apiRow)}`
);
assert(
  canonicalLeagueIdentity(scrapeRow) === 'yahoo:123456',
  `scrape identity ${canonicalLeagueIdentity(scrapeRow)}`
);

const otherLeague = {
  id: 'yahoo-999',
  yahooLeagueId: '449.l.999',
  platform: 'Yahoo',
  name: 'Finance',
  leagueName: 'Finance',
  myTeamName: 'YANNACONDA 🐍',
  oppTeamName: 'SUCK CITY',
  myRecord: { wins: 8, losses: 2, ties: 0 }
};

const collapsed = dedupeImportedLeagues([
  scrapeRow,
  apiRow,
  legacyRow,
  { ...scrapeRow, id: 'yahoo-123456-1-dup' },
  otherTeam,
  otherLeague
]);

assert(collapsed.length === 2, `expected 2 unique Yahoo rows, got ${collapsed.length}`);
assert(
  collapsed.some((row) => String(row.leagueKey || row.yahooLeagueId || '').includes('123456')),
  '123456 league kept'
);
assert(
  collapsed.some((row) => String(row.yahooLeagueId || '').includes('999')),
  'different league id kept'
);

const primary = collapsed.find((row) => String(row.leagueKey || row.id || '').includes('123456') || String(row.yahooLeagueId || '').includes('123456'));
assert(primary?.portfolio?.length === 2, 'richer API roster should win merge');
assert(
  String(primary.id).includes('461.l.123456') || String(primary.leagueKey || '').includes('461.l.123456'),
  'canonical API id/key preferred'
);

const financeA = {
  id: 'fin-a',
  platform: 'Yahoo',
  name: 'Finance',
  leagueName: 'Finance',
  yahooLeagueId: '449.l.555',
  myTeamName: 'Desk',
  oppTeamName: 'Window'
};
const financeB = {
  id: 'fin-b',
  platform: 'Yahoo',
  name: 'Finance',
  leagueName: 'Finance',
  yahooLeagueId: '555',
  myTeamName: 'Desk',
  oppTeamName: 'Hall'
};
const snakeA = {
  id: 'snake-a',
  platform: 'Yahoo',
  name: 'League 3',
  leagueName: 'League 3',
  myTeamName: 'YANNACONDA 🐍',
  oppTeamName: 'SUCK CITY',
  myRecord: { wins: 8, losses: 2, ties: 0 }
};
const snakeB = {
  id: 'snake-b',
  platform: 'Yahoo',
  name: 'League 4',
  leagueName: 'League 4',
  myTeamName: 'YANNACONDA 🐍',
  oppTeamName: 'SUCK CITY',
  myRecord: '8-2-0'
};
const snakeOther = {
  id: 'snake-c',
  platform: 'Yahoo',
  name: 'League 5',
  leagueName: 'League 5',
  myTeamName: 'YANNACONDA 🐍',
  oppTeamName: 'Other Kids',
  myRecord: { wins: 1, losses: 1, ties: 0 }
};
const cached = dedupeImportedLeagues([financeA, financeB, snakeA, snakeB, snakeOther]);
assert(cached.length === 3, `finance + two snake matchups, got ${cached.length}`);
assert(cached.filter((row) => row.leagueName === 'Finance' || row.name === 'Finance').length === 1, 'Finance collapsed');

assert(isGenericYahooLeagueName('League 3'), 'League 3 placeholder');
assert(!isGenericYahooLeagueName('Finance'), 'Finance is real');

const titled = extractYahooLeagueTitle({
  html: '<title>Finance - Fantasy Football - Yahoo Sports</title><meta property="og:title" content="Finance - Fantasy Football - Yahoo Sports">'
});
assert(titled === 'Finance', `title extract ${titled}`);
const fromJson = extractYahooLeagueTitle({
  pageText: '{"league_key":"449.l.555","name":"Finance","num_teams":12}'
});
assert(fromJson === 'Finance', `json extract ${fromJson}`);
assert(
  resolvedYahooLeagueName(['League 5', ''], 'YANNACONDA 🐍') === 'YANNACONDA 🐍',
  'team nickname replaces League 5'
);
assert(resolvedYahooLeagueName(['Finance'], 'YANNACONDA 🐍') === 'Finance', 'real title wins');

console.log('verify-yahoo-dedupe: ok');
