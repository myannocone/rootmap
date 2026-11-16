/**
 * Smoke checks for Yahoo-native point + league name parsing (no network).
 */
import {
  mapYahooPlayer,
  parseLeagues,
  parseScoreboard,
  extractYahooTotal,
  isGenericYahooSectionName
} from '../lib/yahooFantasy.js';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

// Classic Yahoo roster player: metadata array + stats sibling with player_points.total
const burrow = mapYahooPlayer({
  player: [
    [
      { player_key: '461.p.30123' },
      { name: { full: 'Joe Burrow', first: 'Joe', last: 'Burrow' } },
      { editorial_team_abbr: 'Cin' },
      { display_position: 'QB' },
      { primary_position: 'QB' }
    ],
    {
      selected_position: [{ position: 'QB' }],
      player_points: { coverage_type: 'week', week: '11', total: '33.16' },
      player_projected_points: { total: '22.40' }
    }
  ]
}, 11);

assert(burrow.actualPoints === 33.16, `Burrow actual ${burrow.actualPoints}`);
assert(burrow.points === 33.16, `Burrow points ${burrow.points}`);
assert(burrow.projPoints === 22.4, `Burrow proj ${burrow.projPoints}`);
assert(burrow.yahooNative === true, 'Burrow should be yahooNative');

// Unplayed MNF: Yahoo actual 0, projection present — points must stay 0 (not proj).
const flowers = mapYahooPlayer({
  player: [
    [
      { player_key: '461.p.40001' },
      { name: { full: 'Zay Flowers' } },
      { editorial_team_abbr: 'Bal' },
      { display_position: 'WR' }
    ],
    {
      selected_position: [{ position: 'WR' }],
      player_points: { total: '0.00' },
      player_projected_points: { total: '15.20' }
    }
  ]
}, 11);
assert(flowers.actualPoints === 0, `Flowers actual ${flowers.actualPoints}`);
assert(flowers.points === 0, `Flowers points must not use proj, got ${flowers.points}`);
assert(flowers.projPoints === 15.2, `Flowers proj ${flowers.projPoints}`);

// Missing player_points node: still never copy projection into points.
const missingActual = mapYahooPlayer({
  player: [
    [{ name: { full: 'Nico Collins' } }, { editorial_team_abbr: 'Hou' }, { display_position: 'WR' }],
    { selected_position: [{ position: 'WR' }], player_projected_points: { total: '19.90' } }
  ]
}, 11);
assert(missingActual.points === 0, `missing actual points ${missingActual.points}`);
assert(missingActual.projPoints === 19.9, 'proj still present');

// IDP DP slot with Yahoo native points
const idp = mapYahooPlayer({
  player: [
    [
      { name: { full: 'Demetrius Knight Jr.' } },
      { editorial_team_abbr: 'Cin' },
      { display_position: 'LB' },
      { primary_position: 'LB' }
    ],
    {
      selected_position: [{ position: 'DP' }],
      player_points: [{ coverage_type: 'week', week: '11' }, { total: '11.30' }],
      player_projected_points: { '0': { total: '8.50' } }
    }
  ]
}, 11);
assert(idp.slot === 'DP', `IDP slot ${idp.slot}`);
assert(idp.isStarter === true, 'DP is a starter slot');
assert(idp.actualPoints === 11.3, `IDP actual ${idp.actualPoints}`);
assert(idp.points === 11.3, `IDP points ${idp.points}`);

// Numeric-key team_points shape from scoreboard
assert(extractYahooTotal({ '0': { total: '111.46' }, coverage_type: 'week' }) === 111.46, 'team total');
assert(extractYahooTotal([{ coverage_type: 'week' }, { total: '43.70' }]) === 43.7, 'array total');

const scoreboard = parseScoreboard({
  fantasy_content: {
    league: [
      {
        scoreboard: {
          '0': {
            matchups: {
              '0': {
                matchup: {
                  '0': {
                    teams: {
                      '0': {
                        team: [
                          [{ team_key: '461.l.1.t.1' }, { name: 'YANNACONDA 🐍' }],
                          { team_points: { total: '111.46' }, team_projected_points: { total: '135.87' } }
                        ]
                      },
                      '1': {
                        team: [
                          [{ team_key: '461.l.1.t.2' }, { name: 'Opponent' }],
                          { team_points: { total: '107.94' }, team_projected_points: { total: '107.94' } }
                        ]
                      },
                      count: 2
                    }
                  }
                }
              },
              count: 1
            }
          }
        }
      }
    ]
  }
}, '461.l.1.t.1');
assert(scoreboard.mine?.score === 111.46, `mine score ${scoreboard.mine?.score}`);
assert(scoreboard.opp?.score === 107.94, `opp score ${scoreboard.opp?.score}`);
assert(scoreboard.mine?.proj === 135.87, `mine proj ${scoreboard.mine?.proj}`);

// League names: section header must not win over BCliff Football / Mantasy
const leagues = parseLeagues({
  fantasy_content: {
    users: {
      '0': {
        user: [
          { guid: 'x' },
          {
            games: {
              '0': {
                game: [
                  [{ game_key: '461' }],
                  {
                    leagues: {
                      '0': {
                        league: [
                          [
                            { league_key: '461.l.100' },
                            { name: 'BCliff Football' },
                            { num_teams: 12 },
                            { current_week: 11 },
                            { scoring_type: 'head' }
                          ]
                        ]
                      },
                      '1': {
                        league: [
                          [
                            { league_key: '461.l.200' },
                            { name: 'Mantasy' },
                            { num_teams: 10 },
                            { current_week: 11 }
                          ]
                        ]
                      },
                      count: 2
                    }
                  }
                ]
              }
            }
          }
        ]
      }
    }
  }
});
assert(leagues.length === 2, `league count ${leagues.length}`);
assert(leagues[0].name === 'BCliff Football', leagues[0].name);
assert(leagues[1].name === 'Mantasy', leagues[1].name);
assert(!isGenericYahooSectionName('BCliff Football'), 'real name not generic');
assert(isGenericYahooSectionName('My Teams & Leagues'), 'section is generic');

console.log('verify-yahoo-native: ok');
