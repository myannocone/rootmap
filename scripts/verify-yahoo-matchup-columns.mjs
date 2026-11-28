/**
 * Yahoo matchup column binding + actual/projected score slots.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { register } from 'node:module';

register('./resolve-js-ext.mjs', import.meta.url);

const { alignYahooMatchupSides, parseYahooMatchupText } = await import('../src/utils/yahooPaste.js');
const { starterScoredPoints, sumListedStarterActuals } = await import('../src/utils/matchupLineup.js');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function kickedOffTotal(starters) {
  return sumListedStarterActuals(starters);
}

const riceGoedert = `
League: Friends League
My Real Squad
You're a Funny Guy!
9-2-0 | 1st
6-5-0 | 4th
7.00
4.30
Starters
Austin Ekeler
WAS - RB
Final
4.00
11.20
RB
2.90
9.16
Rashee Rice
KC - WR
Final
Breece Hall
NYJ - RB
Final
3.00
14.40
RB
1.40
8.67
Dallas Goedert
PHI - TE
Final
Tank Dell
HOU - WR
Sun 1:00
—
12.50
WR
—
11.40
Unplayed Receiver
DAL - WR
Sun 4:25
Bench
`;

const parsed = parseYahooMatchupText(riceGoedert);
assert(parsed.myTeamName === 'My Real Squad', `my team ${parsed.myTeamName}`);
assert(parsed.oppTeamName === "You're a Funny Guy!", `opp team ${parsed.oppTeamName}`);
assert(parsed.myRank === 1 && parsed.oppRank === 4, 'ranks stay on their columns');

const rice = parsed.oppStarters.find((player) => player.name === 'Rashee Rice');
const goedert = parsed.oppStarters.find((player) => player.name === 'Dallas Goedert');
const unplayed = parsed.oppStarters.find((player) => player.name === 'Unplayed Receiver');
assert(rice, 'Rashee Rice parsed on the right');
assert(rice.actualPoints === 2.9, `Rice actual ${rice?.actualPoints} (proj must not overwrite)`);
assert(rice.projPoints === 9.16, `Rice proj ${rice?.projPoints}`);
assert(goedert.actualPoints === 1.4, `Goedert actual ${goedert?.actualPoints}`);
assert(goedert.projPoints === 8.67, `Goedert proj ${goedert?.projPoints}`);
assert(unplayed.actualPoints == null, `unplayed actual ${unplayed?.actualPoints}`);
assert(unplayed.projPoints === 11.4, `unplayed proj ${unplayed?.projPoints}`);
assert(starterScoredPoints(rice) === 2.9, 'final actual counts');
assert(starterScoredPoints(goedert) === 1.4, 'final actual counts');
assert(starterScoredPoints(unplayed) === 0, 'pregame projection is not an actual');

const ekeler = parsed.myStarters.find((player) => player.name === 'Austin Ekeler');
const hall = parsed.myStarters.find((player) => player.name === 'Breece Hall');
const dell = parsed.myStarters.find((player) => player.name === 'Tank Dell');
assert(ekeler.actualPoints === 4 && ekeler.projPoints === 11.2, 'left column top is actual');
assert(hall.actualPoints === 3 && hall.projPoints === 14.4, 'left column bottom is proj');
assert(dell.actualPoints == null && dell.projPoints === 12.5, 'dash is unplayed on the left');
assert(kickedOffTotal(parsed.myStarters) === 7, `user total ${kickedOffTotal(parsed.myStarters)}`);
assert(kickedOffTotal(parsed.oppStarters) === 4.3, `opp total ${kickedOffTotal(parsed.oppStarters)}`);
assert(Math.round((9.16 + 8.67) * 100) / 100 === 17.83, 'documents the inflated proj total');

const full = parseYahooMatchupText(`
My Real Squad
YOU WANT 2 CEE DEE
8-3-0 | 2nd
5-6-0 | 7th
Starters
Player One
BUF - QB
Final
10.20
18.00
QB
16.50
15.72
Kyren Williams
LAR - RB
Final
Player Two
DAL - WR
Final
8.40
12.00
WR
23.40
24.63
CeeDee Lamb
DAL - WR
Final
Player Three
KC - TE
Final
7.10
9.00
TE
8.10
10.00
Right Three
KC - TE
Final
Player Four
SF - RB
Final
6.00
8.00
RB
6.80
9.50
Right Four
SF - RB
Final
Player Five
BAL - WR
Final
5.20
7.00
WR
—
14.00
Right Five
BAL - WR
Sun 8:20
`);

assert(full.myTeamName === 'My Real Squad', `full my ${full.myTeamName}`);
assert(full.oppTeamName === 'YOU WANT 2 CEE DEE', `full opp ${full.oppTeamName}`);
const kyren = full.oppStarters.find((player) => player.name === 'Kyren Williams');
const ceedee = full.oppStarters.find((player) => player.name === 'CeeDee Lamb');
assert(kyren.actualPoints === 16.5 && kyren.projPoints === 15.72, `Kyren ${kyren?.actualPoints}/${kyren?.projPoints}`);
assert(ceedee.actualPoints === 23.4 && ceedee.projPoints === 24.63, `CeeDee ${ceedee?.actualPoints}/${ceedee?.projPoints}`);
const myTotal = Math.round(kickedOffTotal(full.myStarters) * 100) / 100;
const oppTotal = Math.round(kickedOffTotal(full.oppStarters) * 100) / 100;
assert(myTotal === 36.9, `header user total ${myTotal}`);
assert(oppTotal === 54.8, `header opp total ${oppTotal}`);

const zeroLine = parseYahooMatchupText(`
My Real Squad
You're a Funny Guy!
1-0-0 | 1st
1-0-0 | 2nd
Starters
Zero Back
DAL - RB
Final
0.00
15.72
RB
4.30
9.00
Other Back
NYJ - RB
Final
`);
const zero = zeroLine.myStarters.find((player) => player.name === 'Zero Back');
assert(zero.actualPoints === 0, `0.00 actual stayed ${zero?.actualPoints}`);
assert(zero.projPoints === 15.72, 'proj kept beside a zero actual');
assert(starterScoredPoints(zero) === 0, 'zero actual is not replaced by projection');

const misnamed = parseYahooMatchupText(`
You're a Funny Guy!
6-5-0 | 4th
Starters
Austin Ekeler
WAS - RB
Final
7.00
11.00
RB
4.30
9.00
Rashee Rice
KC - WR
Final
`);
const aligned = alignYahooMatchupSides(misnamed, { teamName: 'My Real Squad' });
assert(aligned.myTeamName === 'My Real Squad', `aligned user ${aligned.myTeamName}`);
assert(aligned.oppTeamName === "You're a Funny Guy!", `aligned opp ${aligned.oppTeamName}`);
assert(aligned.myStarters[0].name === 'Austin Ekeler', 'user roster stays on the left');
assert(aligned.oppStarters[0].name === 'Rashee Rice', 'opponent roster stays on the right');

const swappedColumns = alignYahooMatchupSides({
  myTeamName: "You're a Funny Guy!",
  oppTeamName: 'My Real Squad',
  myTeamId: '4',
  oppTeamId: '2',
  myRecord: { wins: 6, losses: 5, ties: 0 },
  oppRecord: { wins: 9, losses: 2, ties: 0 },
  myRank: 4,
  oppRank: 1,
  myLogo: 'opp.png',
  oppLogo: 'me.png',
  myStarters: [{ name: 'Rashee Rice', actualPoints: 2.9, projPoints: 9.16, isFinal: true, gameStatus: 'FINAL' }],
  oppStarters: [{ name: 'Austin Ekeler', actualPoints: 7, projPoints: 11, isFinal: true, gameStatus: 'FINAL' }]
}, { teamId: '2', rosterNames: ['Austin Ekeler', 'Breece Hall', 'Tank Dell'] });
assert(swappedColumns.myTeamName === 'My Real Squad', 'user column moves left with its name');
assert(swappedColumns.oppTeamName === "You're a Funny Guy!", 'opponent name stays with the other column');
assert(swappedColumns.myTeamId === '2' && swappedColumns.oppTeamId === '4', 'team ids follow the columns');
assert(swappedColumns.myRank === 1 && swappedColumns.oppRank === 4, 'rank stays on its column');
assert(swappedColumns.myLogo === 'me.png' && swappedColumns.oppLogo === 'opp.png', 'logos stay on their columns');
assert(swappedColumns.myStarters[0].name === 'Austin Ekeler', 'user roster moves with the user column');
assert(swappedColumns.oppStarters[0].actualPoints === 2.9, 'opponent actual stays on the right');

const swift = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../ios/App/App/YahooLoginPlugin.swift'), 'utf8');
assert(swift.includes('Top score slot is actual'), 'scraper treats the top slot as actual');
assert(swift.includes('Bottom score slot is projected'), 'scraper treats the bottom slot as projected');
assert(swift.includes('userOnRight'), 'scraper moves the user column to the left with its roster');
assert(swift.includes('jsonForTeamId'), 'ydb nicknames bind by team id');
assert(!swift.includes('if (!mineJson && ydb.teams[0]) mineJson = ydb.teams[0]'), 'first JSON team is not assumed to be the user');
assert(swift.includes('splitAt = Math.floor((leftIdx + rightIdx) / 2) + 1'), 'slot-aware float split stays');

console.log('verify-yahoo-matchup-columns: ok');
