/**
 * Smoke checks for free-tier active league caps (no network).
 */
import {
  FREE_ACTIVE_LEAGUE_LIMIT,
  activeLeagueCount,
  clampFreeActiveHidden,
  freeActiveBadge
} from '../src/utils/proEntitlement.js';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

assert(FREE_ACTIVE_LEAGUE_LIMIT === 2, `limit ${FREE_ACTIVE_LEAGUE_LIMIT}`);

const leagues = [
  { id: 'a' },
  { id: 'b' },
  { id: 'c' },
  { id: 'd' }
];

assert(activeLeagueCount(leagues, new Set()) === 4, 'all active');
assert(activeLeagueCount(leagues, new Set(['c', 'd'])) === 2, 'two hidden');
assert(freeActiveBadge(2) === '2 / 2 Free Active', freeActiveBadge(2));
assert(freeActiveBadge(0) === '0 / 2 Free Active', freeActiveBadge(0));

const clamped = clampFreeActiveHidden(leagues, new Set());
assert(activeLeagueCount(leagues, clamped) === 2, `clamped count ${activeLeagueCount(leagues, clamped)}`);
assert(!clamped.has('a') && !clamped.has('b') && clamped.has('c') && clamped.has('d'), 'first two stay active');
const already = clampFreeActiveHidden(leagues, new Set(['c', 'd']));
assert(activeLeagueCount(leagues, already) === 2, 'cap does not hide more once two are active');

console.log('verify-pro-entitlement: ok');
