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

function game({ id, away, home, awayName, homeName, kickoff, time, status }) {
  return {
    id,
    week: 8,
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

export function getActiveSlate(now = new Date()) {
  return selectActiveWeek(NFL_WEEKS_2026, now);
}

export function getActiveSlateGames(now = new Date()) {
  return getActiveSlate(now).games;
}
