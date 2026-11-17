/**
 * Smoke checks for Final-Slate Nailbiter detection (no notifications / no network).
 */
import {
  evaluateMatchupNailbiter,
  formatFinalSlateNailbiterBody,
  groupNailbitersByKickoff,
  isLateSlateKickoff
} from '../src/utils/finalSlateNailbiter.js';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

// Sunday 1:00 PM ET should never qualify; Sunday 4:25 and Monday night should.
assert(isLateSlateKickoff('2026-11-15T18:00:00.000Z') === false, 'Sunday 1pm ET must be ignored');
assert(isLateSlateKickoff('2026-11-15T21:25:00.000Z') === true, 'Sunday 4:25 PM ET must qualify');
assert(isLateSlateKickoff('2026-11-17T01:15:00.000Z') === true, 'Monday night must qualify');
assert(isLateSlateKickoff('2026-11-13T01:15:00.000Z') === false, 'Thursday night must be ignored');

const sundayKick = '2026-11-15T21:25:00.000Z'; // ~4:25 PM ET
const now = new Date('2026-11-15T20:00:00.000Z'); // before late slate

function starter(name, team, opts = {}) {
  return {
    name,
    nflTeam: team,
    isStarter: true,
    slot: opts.slot || 'WR',
    kickoff: opts.kickoff || null,
    actualPoints: opts.actual ?? 0,
    points: opts.actual ?? 0,
    projPoints: opts.proj ?? 0,
    gameStatus: opts.status || (opts.kickoff ? 'UPCOMING' : 'FINAL'),
    isLive: opts.status === 'IN_PROGRESS',
    isFinal: opts.status === 'FINAL'
  };
}

const games = [
  { home: 'BAL', away: 'CLE', kickoff: sundayKick, state: 'pre', status: 'Sun 4:25 PM' },
  { home: 'KC', away: 'DEN', kickoff: '2026-11-15T18:00:00.000Z', state: 'post', status: 'Final', completed: true }
];

// Behind 107.94 to 111.46 with Flowers still to play — 20% upside can flip, projected gap < 15.
const nailbiter = evaluateMatchupNailbiter({
  id: 'lg1',
  name: 'BCliff Football',
  myStarters: [
    starter('Lamar Jackson', 'BAL', { actual: 30, proj: 24, status: 'FINAL' }),
    starter('Derrick Henry', 'BAL', { actual: 22, proj: 18, status: 'FINAL' }),
    starter('Mark Andrews', 'BAL', { actual: 14, proj: 12, status: 'FINAL' }),
    starter('Rashod Bateman', 'BAL', { actual: 12, proj: 10, status: 'FINAL' }),
    starter('Justice Hill', 'BAL', { actual: 9, proj: 8, status: 'FINAL' }),
    starter('Justin Tucker', 'BAL', { actual: 8.94, proj: 8, status: 'FINAL' }),
    starter('Ravens D/ST', 'BAL', { actual: 12, proj: 9, status: 'FINAL', slot: 'D/ST' }),
    starter('Zay Flowers', 'BAL', { actual: 0, proj: 14.4, kickoff: sundayKick, status: 'UPCOMING' })
  ],
  oppStarters: [
    starter('Joe Burrow', 'CIN', { actual: 28, proj: 22, status: 'FINAL' }),
    starter('Ja\'Marr Chase', 'CIN', { actual: 24, proj: 20, status: 'FINAL' }),
    starter('Tee Higgins', 'CIN', { actual: 18, proj: 14, status: 'FINAL' }),
    starter('Chase Brown', 'CIN', { actual: 16, proj: 13, status: 'FINAL' }),
    starter('Zack Moss', 'CIN', { actual: 10, proj: 9, status: 'FINAL' }),
    starter('Evan McPherson', 'CIN', { actual: 8, proj: 8, status: 'FINAL' }),
    starter('Bengals D/ST', 'CIN', { actual: 7.46, proj: 7, status: 'FINAL', slot: 'D/ST' }),
    starter('Amari Cooper', 'BUF', { actual: 0, proj: 3, kickoff: sundayKick, status: 'UPCOMING' })
  ]
}, { games, now });

assert(nailbiter, 'expected a nailbiter evaluation');
assert(nailbiter.leagueName === 'BCliff Football', 'league name');
assert(Math.abs(nailbiter.myScore - 107.94) < 0.01, `myScore ${nailbiter.myScore}`);
assert(Math.abs(nailbiter.oppScore - 111.46) < 0.01, `oppScore ${nailbiter.oppScore}`);
assert(Math.abs(nailbiter.myRemProj - 14.4) < 0.01, `myRemProj ${nailbiter.myRemProj}`);
assert(nailbiter.decidingPlayers.some((player) => player.name === 'Zay Flowers'), 'deciding Flowers');

const body = formatFinalSlateNailbiterBody({
  finalKickoffTime: nailbiter.finalKickoffTime,
  matchups: [nailbiter]
});
assert(/Nailbiter in BCliff Football \(107\.9 vs 111\.5\)/.test(body), `body ${body}`);
assert(/Zay Flowers/.test(body), `body players ${body}`);

// Too lopsided projected gap should not trigger.
const blowout = evaluateMatchupNailbiter({
  id: 'lg2',
  name: 'Blowout League',
  myStarters: [
    starter('A', 'KC', { actual: 40, proj: 20, status: 'FINAL' }),
    starter('B', 'KC', { actual: 40, proj: 20, status: 'FINAL' }),
    starter('C', 'KC', { actual: 40, proj: 20, status: 'FINAL' }),
    starter('Hero', 'BAL', { actual: 0, proj: 5, kickoff: sundayKick, status: 'UPCOMING' })
  ],
  oppStarters: [
    starter('D', 'DEN', { actual: 5, proj: 20, status: 'FINAL' }),
    starter('E', 'DEN', { actual: 5, proj: 20, status: 'FINAL' }),
    starter('F', 'DEN', { actual: 5, proj: 20, status: 'FINAL' }),
    starter('G', 'BAL', { actual: 0, proj: 5, kickoff: sundayKick, status: 'UPCOMING' })
  ]
}, { games, now });
assert(blowout == null, 'blowout should not qualify');

// Early-Sunday-only unstarted must not qualify.
const earlyOnly = evaluateMatchupNailbiter({
  id: 'lg3',
  name: 'Early Only',
  myStarters: [
    starter('Early', 'KC', {
      actual: 0,
      proj: 20,
      kickoff: '2026-11-15T18:00:00.000Z',
      status: 'UPCOMING'
    })
  ],
  oppStarters: [
    starter('Also Early', 'DEN', {
      actual: 0,
      proj: 20,
      kickoff: '2026-11-15T18:00:00.000Z',
      status: 'UPCOMING'
    })
  ]
}, {
  games: [
    { home: 'KC', away: 'DEN', kickoff: '2026-11-15T18:00:00.000Z', state: 'pre', status: 'Sun 1:00 PM' }
  ],
  now: new Date('2026-11-15T16:00:00.000Z')
});
assert(earlyOnly == null, 'early Sunday slate must not qualify');

const grouped = groupNailbitersByKickoff([nailbiter, { ...nailbiter, leagueId: 'lg9', leagueName: 'Mantasy' }]);
assert(grouped.length === 1, 'same kickoff window groups together');
assert(grouped[0].matchups.length === 2, 'two matchups in window');

console.log('verify-final-slate-nailbiter: ok');
