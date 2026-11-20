/**
 * Game Slate card order: impact, then league appearances, then name.
 * Does not exercise Sleeper, ESPN, or Yahoo parsers.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  compareSlateGamePlayers,
  slateFantasyImpact,
  slatePlayerRoots,
  sortSlateGamePlayers
} from '../src/utils/slateGameOrder.js';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function names(players) {
  return players.map((player) => player.name).join('|');
}

const ingested = [
  {
    name: 'Zay Flowers',
    actualPoints: 4.2,
    projPoints: 11.4,
    myLeagues: [{ league: 'Home' }],
    oppLeagues: [],
    myShares: 1,
    oppShares: 0
  },
  {
    name: 'Josh Allen',
    actualPoints: 0,
    projectedPoints: 24.8,
    roots: [{ league: 'Home' }, { league: 'Work' }],
    myShares: 2,
    oppShares: 0
  },
  {
    name: 'Saquon Barkley',
    actualPoints: 22.6,
    projPoints: 16.1,
    myLeagues: [{ league: 'Home' }],
    oppLeagues: [{ league: 'Work' }, { league: 'Friends' }],
    myShares: 1,
    oppShares: 2
  },
  {
    name: 'Amon-Ra St. Brown',
    actualPoints: 22.6,
    projectedPoints: 14,
    roots: [{ league: 'Home' }],
    myShares: 1,
    oppShares: 0
  },
  {
    name: 'Aaron Jones',
    actualPoints: 9.1,
    projPoints: 9.1,
    myLeagues: [{ league: 'Home' }, { league: 'Work' }],
    oppLeagues: [],
    myShares: 2,
    oppShares: 0
  },
  {
    name: 'Breece Hall',
    actualPoints: 9.1,
    projectedPoints: 8,
    myShares: 2,
    oppShares: 0
  }
];

assert(slateFantasyImpact(ingested[0]) === 11.4, 'projPoints feeds impact when it beats actual');
assert(slateFantasyImpact(ingested[1]) === 24.8, 'projectedPoints feeds impact before kickoff');
assert(slateFantasyImpact(ingested[2]) === 22.6, 'actual points win when they beat the projection');
assert(slateFantasyImpact({ actualPoints: 0, projectedPoints: 0 }) === 0, 'zeros stay zero');
assert(slateFantasyImpact({ actualPoints: null, projPoints: null }) === 0, 'missing scores stay zero');

assert(slatePlayerRoots(ingested[1]).length === 2, 'explicit roots.length is the league count');
assert(slatePlayerRoots(ingested[2]).length === 3, 'merged for/against leagues count when roots is absent');
assert(slatePlayerRoots(ingested[5]).length === 2, 'share totals count leagues when no league list is stored');

const sorted = sortSlateGamePlayers(ingested);
assert(
  names(sorted) === 'Josh Allen|Saquon Barkley|Amon-Ra St. Brown|Zay Flowers|Aaron Jones|Breece Hall',
  `unexpected order: ${names(sorted)}`
);
assert(names(ingested).startsWith('Zay Flowers'), 'sort does not mutate the ingested list');

const tied = sortSlateGamePlayers([
  { name: 'zeta', actualPoints: 10, projectedPoints: 10, roots: [{}] },
  { name: 'Alpha', actualPoints: 10, projectedPoints: 4, roots: [{}] },
  { name: 'Mike', actualPoints: 10, projectedPoints: 10, roots: [{}, {}] }
]);
assert(names(tied) === 'Mike|Alpha|zeta', `alpha tie-break failed: ${names(tied)}`);

const sameRefs = ingested.map((player) => player);
sortSlateGamePlayers(sameRefs).forEach((player, index, list) => {
  assert(player.actualPoints === sameRefs.find((row) => row.name === player.name).actualPoints, 'point totals stay intact');
  assert(player.myShares === sameRefs.find((row) => row.name === player.name).myShares, 'share totals stay intact');
  if (index > 0) assert(compareSlateGamePlayers(list[index - 1], player) <= 0, 'comparator agrees with sorted order');
});

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const app = readFileSync(join(root, 'src/App.jsx'), 'utf8');
const order = readFileSync(join(root, 'src/utils/slateGameOrder.js'), 'utf8');
assert(app.includes('compareSlateGamePlayers'), 'Game Slate uses the slate player comparator');
assert(/getGamePlayers[\s\S]{0,500}\.sort\(compareSlateGamePlayers\)/.test(app), 'game cards sort deduped players');
assert(order.includes('Math.max(actualPoints || 0, projectedPoints || 0)'), 'impact is max of actual and projected');
assert(order.includes('.length'), 'league tie-break uses the roots list length');
assert(!/sleeper|espn|yahoo/i.test(order), 'slate order does not parse platform payloads');

console.log('slate game order ok');
