/**
 * Smoke checks for Yahoo-native point + league name parsing (no network).
 */
import {
  mapYahooPlayer,
  parseLeagues,
  parseRoster,
  parseScoreboard,
  extractYahooTotal,
  findYahooKey,
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
                          {
                            team_points: { total: '107.32' },
                            team_projected_points: { total: '135.87' },
                            win_probability: 0.79
                          }
                        ]
                      },
                      '1': {
                        team: [
                          [{ team_key: '461.l.1.t.2' }, { name: 'SUCK CITY' }],
                          {
                            team_points: { total: '76.07' },
                            team_projected_points: { total: '107.94' },
                            win_probability: 0.21
                          }
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
assert(scoreboard.mine?.score === 107.32, `mine score ${scoreboard.mine?.score}`);
assert(scoreboard.opp?.score === 76.07, `opp score ${scoreboard.opp?.score}`);
assert(scoreboard.mine?.name === 'YANNACONDA 🐍', `mine name ${scoreboard.mine?.name}`);
assert(scoreboard.opp?.name === 'SUCK CITY', `opp name ${scoreboard.opp?.name}`);
assert(scoreboard.mine?.proj === 135.87, `mine proj ${scoreboard.mine?.proj}`);
assert(scoreboard.opp?.proj === 107.94, `opp proj ${scoreboard.opp?.proj}`);
assert(scoreboard.mine?.winOdds === 0.79, `mine winOdds ${scoreboard.mine?.winOdds}`);
assert(scoreboard.opp?.winOdds === 0.21, `opp winOdds ${scoreboard.opp?.winOdds}`);

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
assert(isGenericYahooSectionName('Mail'), 'Mail nav label is not a league');
assert(isGenericYahooSectionName('Account'), 'Account label is not a league');
assert(isGenericYahooSectionName('League 3'), 'League 3 is not a league title');
assert(isGenericYahooSectionName('League 5'), 'League 5 is not a league title');
assert(!isGenericYahooSectionName('Finance'), 'Finance is a real league title');

// Deep numeric-key nesting (the shape that breaks hardcoded player[0][13] paths).
const deepPlayer = {
  '0': {
    '0': { player_key: '461.p.30123' },
    '5': { name: { full: 'Jahmyr Gibbs' } },
    '8': { editorial_team_abbr: 'Det' },
    '9': { display_position: 'RB' },
    '10': { primary_position: 'RB' },
    '13': {
      selected_position: { position: 'RB' },
      player_points: { '0': { total: '43.70' }, coverage_type: 'week' },
      player_projected_points: [{ coverage_type: 'week' }, { total: '18.40' }]
    }
  }
};
assert(findYahooKey(deepPlayer, 'player_points') != null, 'findYahooKey player_points');
assert(extractYahooTotal(findYahooKey(deepPlayer, 'player_points')) === 43.7, 'deep player total');
const gibbs = mapYahooPlayer({ player: deepPlayer }, 11);
assert(gibbs?.name === 'Jahmyr Gibbs', `deep name ${gibbs?.name}`);
assert(gibbs?.actualPoints === 43.7, `deep actual ${gibbs?.actualPoints}`);
assert(gibbs?.projPoints === 18.4, `deep proj ${gibbs?.projPoints}`);
assert(gibbs?.points === 43.7, `deep points ${gibbs?.points}`);

// Roster body with players buried under numeric keys (no fantasy_content.team.roster.players shortcut).
const deepRoster = parseRoster({
  fantasy_content: {
    '0': {
      team: {
        '0': [{ team_key: '461.l.1.t.1' }, { name: 'YANNACONDA 🐍' }],
        '1': {
          roster: {
            '0': {
              players: {
                '0': { player: deepPlayer },
                count: 1
              }
            }
          }
        }
      }
    }
  }
}, 11);
assert(deepRoster.length === 1, `deep roster count ${deepRoster.length}`);
assert(deepRoster[0].actualPoints === 43.7, `deep roster points ${deepRoster[0].actualPoints}`);

// League metadata as numeric-key object (mergeYahoo does not flatten these).
const numericLeagues = parseLeagues({
  fantasy_content: {
    users: {
      '0': {
        user: {
          '1': {
            games: {
              '0': {
                game: {
                  '1': {
                    leagues: {
                      '0': {
                        league: {
                          '0': {
                            '0': { league_key: '461.l.100' },
                            '2': { name: 'BCliff Football' },
                            '4': { num_teams: 12 },
                            '7': { current_week: 11 }
                          }
                        }
                      },
                      '1': {
                        league: {
                          '0': {
                            '0': { league_key: '461.l.200' },
                            '2': { name: 'Mantasy' },
                            '4': { num_teams: 10 }
                          }
                        }
                      },
                      count: 2
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  }
});
assert(numericLeagues.length === 2, `numeric league count ${numericLeagues.length}`);
assert(numericLeagues[0].name === 'BCliff Football', numericLeagues[0].name);
assert(numericLeagues[1].name === 'Mantasy', numericLeagues[1].name);

console.log('verify-yahoo-native: ok');
