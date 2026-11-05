/**
 * NFL week slates open Tuesday at 6:00 AM Eastern, after Monday Night Football.
 * Oct 27, 2026 is still EDT (UTC-4). DST ends Nov 1, 2026, so the next flip is EST (UTC-5).
 */
const TEAM_ALIASES = {
  WSH: 'WAS',
  JAC: 'JAX',
  LA: 'LAR',
  OAK: 'LV',
  SD: 'LAC',
  ARZ: 'ARI',
  GBP: 'GB',
  GNB: 'GB',
  KAN: 'KC',
  NOR: 'NO',
  TAM: 'TB',
  SFO: 'SF',
  NWE: 'NE'
};

export function canonTeam(team) {
  const key = String(team || '').toUpperCase().trim();
  return TEAM_ALIASES[key] || key;
}

export const FALLBACK_NFL_WEEK = 9;
export const NFL_SEASON = 2026;

export const NFL_TEAM_CODES = [
  'ARI', 'ATL', 'BAL', 'BUF', 'CAR', 'CHI', 'CIN', 'CLE',
  'DAL', 'DEN', 'DET', 'GB', 'HOU', 'IND', 'JAX', 'KC',
  'LAC', 'LAR', 'LV', 'MIA', 'MIN', 'NE', 'NO', 'NYG',
  'NYJ', 'PHI', 'PIT', 'SEA', 'SF', 'TB', 'TEN', 'WAS'
];

function game({ id, week = 8, away, home, awayName, homeName, kickoff, time, status }) {
  return {
    id,
    week,
    away: canonTeam(away),
    home: canonTeam(home),
    awayName,
    homeName,
    kickoff,
    time,
    status,
    homeScore: 0,
    awayScore: 0,
    players: []
  };
}

export const NFL_WEEKS_2026 = [
  {
    week: 8,
    season: 2026,
    label: 'Week 8',
    range: 'Oct 29 – Nov 2, 2026',
    opensAt: '2026-10-27T06:00:00-04:00',
    byes: ['HOU', 'NO', 'NYG', 'SF'],
    games: [
      game({
        id: 'w8-car-gb',
        away: 'CAR',
        home: 'GB',
        awayName: 'Panthers',
        homeName: 'Packers',
        kickoff: '2026-10-29T20:15:00-04:00',
        time: 'Thu 8:15 PM ET',
        status: 'Thu • 8:15 PM ET'
      }),
      game({
        id: 'w8-bal-buf',
        away: 'BAL',
        home: 'BUF',
        awayName: 'Ravens',
        homeName: 'Bills',
        kickoff: '2026-11-01T13:00:00-05:00',
        time: 'Sun 1:00 PM ET',
        status: 'Sun • 1:00 PM ET'
      }),
      game({
        id: 'w8-ten-cin',
        away: 'TEN',
        home: 'CIN',
        awayName: 'Titans',
        homeName: 'Bengals',
        kickoff: '2026-11-01T13:00:00-05:00',
        time: 'Sun 1:00 PM ET',
        status: 'Sun • 1:00 PM ET'
      }),
      game({
        id: 'w8-ari-dal',
        away: 'ARI',
        home: 'DAL',
        awayName: 'Cardinals',
        homeName: 'Cowboys',
        kickoff: '2026-11-01T13:00:00-05:00',
        time: 'Sun 1:00 PM ET',
        status: 'Sun • 1:00 PM ET'
      }),
      game({
        id: 'w8-min-det',
        away: 'MIN',
        home: 'DET',
        awayName: 'Vikings',
        homeName: 'Lions',
        kickoff: '2026-11-01T13:00:00-05:00',
        time: 'Sun 1:00 PM ET',
        status: 'Sun • 1:00 PM ET'
      }),
      game({
        id: 'w8-ind-jax',
        away: 'IND',
        home: 'JAX',
        awayName: 'Colts',
        homeName: 'Jaguars',
        kickoff: '2026-11-01T13:00:00-05:00',
        time: 'Sun 1:00 PM ET',
        status: 'Sun • 1:00 PM ET'
      }),
      game({
        id: 'w8-lv-nyj',
        away: 'LV',
        home: 'NYJ',
        awayName: 'Raiders',
        homeName: 'Jets',
        kickoff: '2026-11-01T13:00:00-05:00',
        time: 'Sun 1:00 PM ET',
        status: 'Sun • 1:00 PM ET'
      }),
      game({
        id: 'w8-cle-pit',
        away: 'CLE',
        home: 'PIT',
        awayName: 'Browns',
        homeName: 'Steelers',
        kickoff: '2026-11-01T13:00:00-05:00',
        time: 'Sun 1:00 PM ET',
        status: 'Sun • 1:00 PM ET'
      }),
      game({
        id: 'w8-atl-tb',
        away: 'ATL',
        home: 'TB',
        awayName: 'Falcons',
        homeName: 'Buccaneers',
        kickoff: '2026-11-01T13:00:00-05:00',
        time: 'Sun 1:00 PM ET',
        status: 'Sun • 1:00 PM ET'
      }),
      game({
        id: 'w8-lac-lar',
        away: 'LAC',
        home: 'LAR',
        awayName: 'Chargers',
        homeName: 'Rams',
        kickoff: '2026-11-01T16:05:00-05:00',
        time: 'Sun 4:05 PM ET',
        status: 'Sun • 4:05 PM ET'
      }),
      game({
        id: 'w8-kc-den',
        away: 'KC',
        home: 'DEN',
        awayName: 'Chiefs',
        homeName: 'Broncos',
        kickoff: '2026-11-01T16:25:00-05:00',
        time: 'Sun 4:25 PM ET',
        status: 'Sun • 4:25 PM ET'
      }),
      game({
        id: 'w8-ne-mia',
        away: 'NE',
        home: 'MIA',
        awayName: 'Patriots',
        homeName: 'Dolphins',
        kickoff: '2026-11-01T16:25:00-05:00',
        time: 'Sun 4:25 PM ET',
        status: 'Sun • 4:25 PM ET'
      }),
      game({
        id: 'w8-phi-was',
        away: 'PHI',
        home: 'WAS',
        awayName: 'Eagles',
        homeName: 'Commanders',
        kickoff: '2026-11-01T20:20:00-05:00',
        time: 'Sun 8:20 PM ET',
        status: 'Sun • 8:20 PM ET'
      }),
      game({
        id: 'w8-chi-sea',
        away: 'CHI',
        home: 'SEA',
        awayName: 'Bears',
        homeName: 'Seahawks',
        kickoff: '2026-11-02T20:15:00-05:00',
        time: 'Mon 8:15 PM ET',
        status: 'Mon • 8:15 PM ET'
      })
    ]
  },
  {
    week: 9,
    season: 2026,
    label: 'Week 9',
    range: 'Nov 5 – Nov 9, 2026',
    opensAt: '2026-11-03T06:00:00-05:00',
    byes: ['PIT', 'TEN'],
    games: [
      game({
        id: 'w9-jax-bal',
        week: 9,
        away: 'JAX',
        home: 'BAL',
        awayName: 'Jaguars',
        homeName: 'Ravens',
        kickoff: '2026-11-05T20:15:00-05:00',
        time: 'Thu 8:15 PM ET',
        status: 'Thu • 8:15 PM ET'
      }),
      game({
        id: 'w9-cin-atl',
        week: 9,
        away: 'CIN',
        home: 'ATL',
        awayName: 'Bengals',
        homeName: 'Falcons',
        kickoff: '2026-11-08T09:30:00-05:00',
        time: 'Sun 9:30 AM ET',
        status: 'Sun • 9:30 AM ET'
      }),
      game({
        id: 'w9-den-car',
        week: 9,
        away: 'DEN',
        home: 'CAR',
        awayName: 'Broncos',
        homeName: 'Panthers',
        kickoff: '2026-11-08T13:00:00-05:00',
        time: 'Sun 1:00 PM ET',
        status: 'Sun • 1:00 PM ET'
      }),
      game({
        id: 'w9-dal-ind',
        week: 9,
        away: 'DAL',
        home: 'IND',
        awayName: 'Cowboys',
        homeName: 'Colts',
        kickoff: '2026-11-08T13:00:00-05:00',
        time: 'Sun 1:00 PM ET',
        status: 'Sun • 1:00 PM ET'
      }),
      game({
        id: 'w9-nyj-kc',
        week: 9,
        away: 'NYJ',
        home: 'KC',
        awayName: 'Jets',
        homeName: 'Chiefs',
        kickoff: '2026-11-08T13:00:00-05:00',
        time: 'Sun 1:00 PM ET',
        status: 'Sun • 1:00 PM ET'
      }),
      game({
        id: 'w9-det-mia',
        week: 9,
        away: 'DET',
        home: 'MIA',
        awayName: 'Lions',
        homeName: 'Dolphins',
        kickoff: '2026-11-08T13:00:00-05:00',
        time: 'Sun 1:00 PM ET',
        status: 'Sun • 1:00 PM ET'
      }),
      game({
        id: 'w9-cle-no',
        week: 9,
        away: 'CLE',
        home: 'NO',
        awayName: 'Browns',
        homeName: 'Saints',
        kickoff: '2026-11-08T13:00:00-05:00',
        time: 'Sun 1:00 PM ET',
        status: 'Sun • 1:00 PM ET'
      }),
      game({
        id: 'w9-nyg-phi',
        week: 9,
        away: 'NYG',
        home: 'PHI',
        awayName: 'Giants',
        homeName: 'Eagles',
        kickoff: '2026-11-08T13:00:00-05:00',
        time: 'Sun 1:00 PM ET',
        status: 'Sun • 1:00 PM ET'
      }),
      game({
        id: 'w9-lar-was',
        week: 9,
        away: 'LAR',
        home: 'WAS',
        awayName: 'Rams',
        homeName: 'Commanders',
        kickoff: '2026-11-08T13:00:00-05:00',
        time: 'Sun 1:00 PM ET',
        status: 'Sun • 1:00 PM ET'
      }),
      game({
        id: 'w9-hou-lac',
        week: 9,
        away: 'HOU',
        home: 'LAC',
        awayName: 'Texans',
        homeName: 'Chargers',
        kickoff: '2026-11-08T16:05:00-05:00',
        time: 'Sun 4:05 PM ET',
        status: 'Sun • 4:05 PM ET'
      }),
      game({
        id: 'w9-lv-sf',
        week: 9,
        away: 'LV',
        home: 'SF',
        awayName: 'Raiders',
        homeName: '49ers',
        kickoff: '2026-11-08T16:05:00-05:00',
        time: 'Sun 4:05 PM ET',
        status: 'Sun • 4:05 PM ET'
      }),
      game({
        id: 'w9-gb-ne',
        week: 9,
        away: 'GB',
        home: 'NE',
        awayName: 'Packers',
        homeName: 'Patriots',
        kickoff: '2026-11-08T16:25:00-05:00',
        time: 'Sun 4:25 PM ET',
        status: 'Sun • 4:25 PM ET'
      }),
      game({
        id: 'w9-ari-sea',
        week: 9,
        away: 'ARI',
        home: 'SEA',
        awayName: 'Cardinals',
        homeName: 'Seahawks',
        kickoff: '2026-11-08T16:25:00-05:00',
        time: 'Sun 4:25 PM ET',
        status: 'Sun • 4:25 PM ET'
      }),
      game({
        id: 'w9-tb-chi',
        week: 9,
        away: 'TB',
        home: 'CHI',
        awayName: 'Buccaneers',
        homeName: 'Bears',
        kickoff: '2026-11-08T20:20:00-05:00',
        time: 'Sun 8:20 PM ET',
        status: 'Sun • 8:20 PM ET'
      }),
      game({
        id: 'w9-buf-min',
        week: 9,
        away: 'BUF',
        home: 'MIN',
        awayName: 'Bills',
        homeName: 'Vikings',
        kickoff: '2026-11-09T20:15:00-05:00',
        time: 'Mon 8:15 PM ET',
        status: 'Mon • 8:15 PM ET'
      })
    ]
  }
];

export function selectActiveWeek(weeks, now = new Date()) {
  const instant = now instanceof Date ? now.getTime() : new Date(now).getTime();
  const sorted = [...(weeks || [])].sort(
    (a, b) => Date.parse(a.opensAt) - Date.parse(b.opensAt)
  );
  if (!sorted.length) return null;
  let active = sorted[0];
  sorted.forEach((week) => {
    if (instant >= Date.parse(week.opensAt)) active = week;
  });
  return active;
}

export function getSlateByWeek(week) {
  const number = Number(week);
  return NFL_WEEKS_2026.find((slate) => slate.week === number) || null;
}

export function byeTeamsForGames(games, known = []) {
  const listed = (known || []).map((team) => canonTeam(team)).filter(Boolean);
  if (listed.length) return listed;
  const playing = new Set();
  (games || []).forEach((game) => {
    if (game?.away) playing.add(canonTeam(game.away));
    if (game?.home) playing.add(canonTeam(game.home));
  });
  if (playing.size < 24) return [];
  return NFL_TEAM_CODES.filter((team) => !playing.has(team));
}

export function getActiveSlate(now = new Date()) {
  return selectActiveWeek(NFL_WEEKS_2026, now) || getSlateByWeek(FALLBACK_NFL_WEEK);
}

export function getActiveSlateGames(now = new Date()) {
  return getActiveSlate(now).games;
}
