/**
 * Smoke checks for Sleeper/ESPN matchup lineup extraction + slot pairing.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  pairStartersBySlot,
  sortStartersBySlot,
  starterProjectedPoints,
  starterScoredPoints
} from '../src/utils/matchupLineup.js';
import { mapEspnLeague } from '../src/utils/espnDirectApi.js';
import { mapSleeperLeague } from '../src/utils/sleeperApi.js';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const espnApi = readFileSync(join(root, 'src/utils/espnDirectApi.js'), 'utf8');
const espnProxy = readFileSync(join(root, 'api/espn.js'), 'utf8');
const sleeperApi = readFileSync(join(root, 'src/utils/sleeperApi.js'), 'utf8');
const app = readFileSync(join(root, 'src/App.jsx'), 'utf8');

assert(espnApi.includes('mBoxscore'), 'ESPN client requests mBoxscore');
assert(espnApi.includes('rosterForCurrentScoringPeriod'), 'ESPN prefers weekly matchup roster');
assert(espnProxy.includes('mBoxscore'), 'ESPN proxy requests mBoxscore');
assert(espnProxy.includes('mScoreboard'), 'ESPN proxy requests mScoreboard');
assert(sleeperApi.includes('Never invent a "best available" lineup'), 'Sleeper refuses invented starters');
assert(sleeperApi.includes('fetchSleeperLeague'), 'Sleeper refreshes league roster positions');
assert(app.includes('pairStartersBySlot'), 'Matchups UI pairs by slot');
assert(app.includes('mergeSyncedLeague'), 'Platform-aware league merge');
assert(app.includes('starterScoredPoints'), 'Live totals ignore projection placeholders');

// --- Slot pairing mirrors ESPN / Sleeper matchup rows (not array index) ---
const daddy = [
  { name: 'Drake Maye', slot: 'QB', position: 'QB', isStarter: true, projPoints: 0 },
  { name: 'Jaylen Warren', slot: 'RB', position: 'RB', isStarter: true, projPoints: 16.37 },
  { name: 'Aaron Jones', slot: 'RB', position: 'RB', isStarter: true, projPoints: 8.57 },
  { name: 'Chris Olave', slot: 'RB/WR', position: 'WR', isStarter: true, projPoints: 14.68 },
  { name: 'Zay Flowers', slot: 'WR', position: 'WR', isStarter: true, projPoints: 14.64 },
  { name: 'Deebo Samuel', slot: 'WR', position: 'WR', isStarter: true, projPoints: 10.47 },
  { name: 'Tyler Warren', slot: 'TE', position: 'TE', isStarter: true, projPoints: 8.93 },
  { name: 'Chase Brown', slot: 'FLEX', position: 'RB', isStarter: true, projPoints: 15.94 },
  { name: 'Jamien Sherwood', slot: 'DP', position: 'LB', isStarter: true, projPoints: 5.11 },
  { name: 'Micah McFadden', slot: 'DP', position: 'LB', isStarter: true, projPoints: 5.25 },
  { name: 'Broncos D/ST', slot: 'D/ST', position: 'D/ST', isStarter: true, projPoints: 9.8 },
  { name: 'Tyler Bass', slot: 'K', position: 'K', isStarter: true, projPoints: 11.09 }
];

const hammer = [
  { name: 'Matthew Stafford', slot: 'QB', position: 'QB', isStarter: true, projPoints: 0 },
  { name: 'Travis Etienne', slot: 'RB', position: 'RB', isStarter: true, projPoints: 11.46 },
  { name: 'Jonathan Taylor', slot: 'RB', position: 'RB', isStarter: true, projPoints: 16.97 },
  { name: 'Rashee Rice', slot: 'RB/WR', position: 'WR', isStarter: true, projPoints: 13.1 },
  { name: 'Emeka Egbuka', slot: 'WR', position: 'WR', isStarter: true, projPoints: 11.39 },
  { name: 'Khalil Shakir', slot: 'WR', position: 'WR', isStarter: true, projPoints: 9.59 },
  { name: 'George Kittle', slot: 'TE', position: 'TE', isStarter: true, projPoints: 13.42 },
  { name: 'Tony Pollard', slot: 'FLEX', position: 'RB', isStarter: true, projPoints: 19.26 },
  { name: 'Nakobe Dean', slot: 'DP', position: 'LB', isStarter: true, projPoints: 5.68 },
  { name: 'Nate Landman', slot: 'DP', position: 'LB', isStarter: true, projPoints: 0 },
  { name: 'Giants D/ST', slot: 'D/ST', position: 'D/ST', isStarter: true, projPoints: 6.22 },
  { name: 'Harrison Butker', slot: 'K', position: 'K', isStarter: true, projPoints: 9.39 }
];

// Scramble opponent order — pairing must still align QB/RB/... not index.
const scrambled = [...hammer].reverse();
const rows = pairStartersBySlot(daddy, scrambled, [
  'QB', 'RB', 'RB', 'RB/WR', 'WR', 'WR', 'TE', 'FLEX', 'DP', 'DP', 'D/ST', 'K'
]);

assert(rows.length === 12, `expected 12 paired rows, got ${rows.length}`);
assert(rows[0].slot === 'QB' && rows[0].mine.name === 'Drake Maye' && rows[0].opp.name === 'Matthew Stafford', 'QB paired');
const rbNames = rows.filter((row) => row.slot === 'RB').map((row) => row.opp?.name).sort();
assert(rbNames.join('|') === 'Jonathan Taylor|Travis Etienne', 'both RBs paired into RB rows');
assert(rows.find((row) => row.slot === 'K')?.opp?.name === 'Harrison Butker', 'K paired to Butker not Landman');
assert(rows.find((row) => row.slot === 'D/ST')?.opp?.name === 'Giants D/ST', 'D/ST paired');
assert(rows.every((row) => row.slot !== 'QB' || row.opp?.position === 'QB'), 'QB row only holds QBs');

const sorted = sortStartersBySlot([
  { name: 'K', slot: 'K', isStarter: true },
  { name: 'QB', slot: 'QB', isStarter: true },
  { name: 'RB', slot: 'RB', isStarter: true }
]);
assert(sorted.map((p) => p.name).join(',') === 'QB,RB,K', 'slot sort order');

assert(starterScoredPoints({ points: 18.5, projPoints: 18.5 }) === 0, 'proj placeholder is not live score');
assert(starterScoredPoints({ actualPoints: 12.2, points: 12.2, projPoints: 18 }) === 12.2, 'actual counts');
assert(starterProjectedPoints({ projPoints: 14.5, points: 14.5 }) === 14.5, 'proj readable');

// --- ESPN map uses weekly rosterForCurrentScoringPeriod, not season totals ---
const espnLeague = {
  settings: {
    name: 'THE ZULU NATION',
    rosterSettings: {
      lineupSlotCounts: { 0: 1, 2: 2, 3: 1, 4: 2, 6: 1, 23: 1, 15: 2, 16: 1, 17: 1, 20: 6 }
    }
  },
  teams: [
    {
      id: 1,
      location: 'Daddy',
      nickname: 'Tags',
      playoffSeed: 6,
      record: { overall: { wins: 4, losses: 6, ties: 0 } },
      roster: {
        entries: [
          // Stale/wrong current roster entry — must be ignored when weekly entries exist.
          {
            lineupSlotId: 2,
            playerId: 999,
            playerPoolEntry: {
              appliedStatTotal: 258.5,
              player: {
                id: 999,
                fullName: 'Kyren Williams',
                defaultPositionId: 2,
                proTeamId: 14,
                stats: []
              }
            }
          }
        ]
      }
    },
    {
      id: 2,
      location: 'Hammer',
      nickname: 'Time',
      playoffSeed: 8,
      record: { overall: { wins: 4, losses: 6, ties: 0 } },
      roster: { entries: [] }
    }
  ],
  schedule: [
    {
      matchupPeriodId: 11,
      home: {
        teamId: 1,
        totalPoints: 0,
        totalPointsLive: 0,
        totalProjectedPointsLive: 120.8,
        rosterForCurrentScoringPeriod: {
          appliedStatTotal: 0,
          entries: [
            {
              lineupSlotId: 0,
              playerId: 1,
              playerPoolEntry: {
                player: {
                  id: 1,
                  fullName: 'Drake Maye',
                  defaultPositionId: 1,
                  proTeamId: 17,
                  stats: [{ statSourceId: 1, scoringPeriodId: 11, appliedStatTotal: 0 }]
                }
              }
            },
            {
              lineupSlotId: 2,
              playerId: 2,
              playerPoolEntry: {
                player: {
                  id: 2,
                  fullName: 'Jaylen Warren',
                  defaultPositionId: 2,
                  proTeamId: 23,
                  stats: [{ statSourceId: 1, scoringPeriodId: 11, appliedStatTotal: 16.37 }]
                }
              }
            },
            {
              lineupSlotId: 20,
              playerId: 3,
              playerPoolEntry: {
                player: {
                  id: 3,
                  fullName: 'Kyren Williams',
                  defaultPositionId: 2,
                  proTeamId: 14,
                  stats: [{ statSourceId: 1, scoringPeriodId: 11, appliedStatTotal: 12 }]
                }
              }
            }
          ]
        }
      },
      away: {
        teamId: 2,
        totalPoints: 0,
        totalPointsLive: 0,
        totalProjectedPointsLive: 116.5,
        rosterForCurrentScoringPeriod: {
          appliedStatTotal: 0,
          entries: [
            {
              lineupSlotId: 0,
              playerId: 10,
              playerPoolEntry: {
                player: {
                  id: 10,
                  fullName: 'Matthew Stafford',
                  defaultPositionId: 1,
                  proTeamId: 14,
                  stats: [{ statSourceId: 1, scoringPeriodId: 11, appliedStatTotal: 0 }]
                }
              }
            },
            {
              lineupSlotId: 17,
              playerId: 11,
              playerPoolEntry: {
                player: {
                  id: 11,
                  fullName: 'Harrison Butker',
                  defaultPositionId: 5,
                  proTeamId: 12,
                  stats: [{ statSourceId: 1, scoringPeriodId: 11, appliedStatTotal: 9.39 }]
                }
              }
            }
          ]
        }
      }
    }
  ]
};

const mappedEspn = mapEspnLeague({
  league: espnLeague,
  leagueId: '123',
  teamId: 1,
  week: 11,
  season: 2026
});

assert(mappedEspn.myTeamName === 'Daddy Tags', 'ESPN team name');
assert(mappedEspn.oppTeamName === 'Hammer Time', 'ESPN opponent name');
assert(mappedEspn.portfolio.some((p) => p.name === 'Jaylen Warren'), 'weekly starter used');
assert(!mappedEspn.portfolio.some((p) => p.name === 'Kyren Williams'), 'bench Kyren not starter');
assert(mappedEspn.bench.some((p) => p.name === 'Kyren Williams'), 'Kyren on bench');
assert(mappedEspn.threats.some((p) => p.name === 'Matthew Stafford'), 'opp QB from weekly roster');
assert(mappedEspn.myScore === 0, 'pregame score stays 0');
assert(mappedEspn.myProj === 120.8, 'board projected total');
assert(mappedEspn.oppProj === 116.5, 'opp board projected total');
assert(mappedEspn.rosterPositions[0] === 'QB', 'roster positions from settings');

// --- Sleeper map uses matchup.starters, keeps bench, resolves opponent name ---
const sleeperPlayers = {
  '1': { full_name: 'C.J. Stroud', position: 'QB', team: 'HOU' },
  '2': { full_name: 'Christian McCaffrey', position: 'RB', team: 'SF' },
  '3': { full_name: 'Luther Burden III', position: 'WR', team: 'CHI' },
  '4': { full_name: 'Jayden Daniels', position: 'QB', team: 'WAS' },
  '5': { full_name: 'Saquon Barkley', position: 'RB', team: 'PHI' },
  IND: { position: 'DEF', team: 'IND', last_name: 'Colts' },
  PHI: { position: 'DEF', team: 'PHI', last_name: 'Eagles' }
};

const mappedSleeper = mapSleeperLeague({
  league: {
    id: '999',
    name: 'ROOTROOTSLEEPER',
    rosterPositions: ['QB', 'RB', 'WR', 'TE', 'FLEX', 'K', 'DEF', 'BN', 'BN'],
    scoringSettings: { rec: 1 }
  },
  userId: 'u1',
  week: 11,
  players: sleeperPlayers,
  weekStats: {},
  weekProjections: {
    '1': { pts_ppr: 20.53 },
    '2': { pts_ppr: 19.76 },
    '3': { pts_ppr: 14.0 },
    '4': { pts_ppr: 21.31 },
    '5': { pts_ppr: 12.66 },
    IND: { pts_ppr: 4.23 },
    PHI: { pts_ppr: 5.94 }
  },
  rosters: [
    { roster_id: 1, owner_id: 'u1', starters: ['1', '2', '0'], players: ['1', '2', '3', 'IND'], settings: { wins: 1, losses: 1, ties: 0, fpts: 100 } },
    { roster_id: 4, owner_id: 'u4', starters: ['4', '5', 'PHI'], players: ['4', '5', 'PHI'], settings: { wins: 2, losses: 0, ties: 0, fpts: 120 } }
  ],
  users: [
    { user_id: 'u1', display_name: 'conda', metadata: { team_name: 'CondaTeam' } },
    { user_id: 'u4', display_name: 'owner4', metadata: { team_name: 'Team 4' } }
  ],
  matchups: [
    { roster_id: 1, matchup_id: 7, starters: ['1', '2', 'IND'], points: 0, players_points: {} },
    { roster_id: 4, matchup_id: 7, starters: ['4', '5', 'PHI'], points: 0, players_points: {} }
  ]
});

assert(mappedSleeper.myTeamName === 'CondaTeam', 'Sleeper team name');
assert(mappedSleeper.oppTeamName === 'Team 4', 'Sleeper opponent uses metadata team_name');
assert(mappedSleeper.portfolio.map((p) => p.name).includes('C.J. Stroud'), 'matchup starter');
assert(!mappedSleeper.portfolio.map((p) => p.name).includes('Luther Burden III'), 'bench stud not invented as starter');
assert(mappedSleeper.bench.some((p) => p.name === 'Luther Burden III'), 'bench persisted');
assert(mappedSleeper.oppRecord?.wins === 2, 'opponent record');
assert(mappedSleeper.myScore === 0, 'pregame sleeper score');
assert(mappedSleeper.myProj > 0, 'sleeper proj from starters');

console.log('verify-matchup-lineup: ok');
