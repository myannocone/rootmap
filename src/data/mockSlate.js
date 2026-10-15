export const mockGames = [
  {
    id: "g1",
    time: "1:00 PM EST",
    home: "PHI",
    away: "NYG",
    status: "LIVE - Q2 8:42",
    players: [
      { id: "barkley", name: "Saquon Barkley", team: "PHI", pos: "RB", pts: 14.8, exposure: "+18.4 pts", exposureColor: "green", leagues: "4/5 Leagues" },
      { id: "brown", name: "A.J. Brown", team: "PHI", pos: "WR", pts: 8.2, exposure: "+6.1 pts", exposureColor: "green", leagues: "2/5 Leagues" }
    ]
  },
  {
    id: "g2",
    time: "4:25 PM EST",
    home: "KC",
    away: "BUF",
    status: "PRE-GAME",
    players: [
      { id: "allen", name: "Josh Allen", team: "BUF", pos: "QB", pts: 0.0, exposure: "+12.0 pts", exposureColor: "green", leagues: "3/5 Leagues" },
      { id: "kelce", name: "Travis Kelce", team: "KC", pos: "TE", pts: 0.0, exposure: "-7.4 pts", exposureColor: "red", leagues: "Opponent Starter (3x)" }
    ]
  },
  {
    id: "g3",
    time: "8:20 PM EST",
    home: "MIN",
    away: "GB",
    status: "PRE-GAME",
    players: [
      { id: "jefferson", name: "Justin Jefferson", team: "MIN", pos: "WR", pts: 0.0, exposure: "+22.5 pts", exposureColor: "green", leagues: "5/5 Leagues" }
    ]
  }
];

export const mockH2H = {
  myRoster: [
    { name: "Josh Allen", pos: "QB", proj: 22.4, status: "Active" },
    { name: "Saquon Barkley", pos: "RB", proj: 18.2, status: "Active" },
    { name: "Justin Jefferson", pos: "WR", proj: 19.5, status: "Active" }
  ],
  opponents: [
    { name: "Patrick Mahomes", pos: "QB", proj: 21.0, league: "Family League" },
    { name: "Travis Kelce", pos: "TE", proj: 14.1, league: "High Stakes 12-Man" },
    { name: "Derrick Henry", pos: "RB", proj: 16.8, league: "Dynasty" }
  ]
};
