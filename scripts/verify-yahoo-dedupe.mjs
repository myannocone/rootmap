/**
 * Smoke checks for Yahoo league identity + dedupe (no network).
 */
import {
  canonicalLeagueIdentity,
  dedupeImportedLeagues,
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
  canonicalLeagueIdentity(apiRow) === 'yahoo:123456:1',
  `api identity ${canonicalLeagueIdentity(apiRow)}`
);
assert(
  canonicalLeagueIdentity(scrapeRow) === 'yahoo:123456:1',
  `scrape identity ${canonicalLeagueIdentity(scrapeRow)}`
);

const collapsed = dedupeImportedLeagues([
  scrapeRow,
  apiRow,
  legacyRow,
  { ...scrapeRow, id: 'yahoo-123456-1-dup' },
  otherTeam
]);

assert(collapsed.length === 2, `expected 2 unique Yahoo rows, got ${collapsed.length}`);
assert(
  collapsed.some((row) => yahooTeamNumOf(row) === '1' || /yannaconda$/.test(String(row.myTeamName || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ''))),
  'primary YANNACONDA row kept'
);
assert(
  collapsed.some((row) => yahooTeamNumOf(row) === '9'),
  'distinct team 9 kept'
);

const primary = collapsed.find((row) => yahooTeamNumOf(row) === '1' || yahooTeamNumOf(row) === '');
assert(primary?.portfolio?.length === 2, 'richer API roster should win merge');
assert(
  String(primary.id).includes('461.l.123456') || String(primary.leagueKey || '').includes('461.l.123456'),
  'canonical API id/key preferred'
);

console.log('verify-yahoo-dedupe: ok');
