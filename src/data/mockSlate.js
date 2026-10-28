export const mockGames = [
  {
    id: "g1",
    time: "1:00 PM EST",
    home: "PHI",
    away: "NYG",
    status: "LIVE - Q2 8:42",
    players: [
      {
        id: "barkley",
        name: "Saquon Barkley",
        team: "PHI",
        pos: "RB",
        pts: 14.8,
        exposure: "+18.4 pts",
        exposureColor: "green",
        leaguesSummary: "4/5 Leagues",
        leagueDetails: [
          { name: "Family League", status: "STARTER", impact: "+1.0x (For Me)", opponent: "Cisco/Bloom" },
          { name: "High Stakes 12-Man", status: "STARTER", impact: "+1.0x (For Me)", opponent: "Gelardi" },
          { name: "Work Dynasty", status: "STARTER", impact: "+1.0x (For Me)", opponent: "Stoiber" },
          { name: "Friends PPR", status: "STARTER", impact: "+1.0x (For Me)", opponent: "Taxin" },
          { name: "Eliminator", status: "UNOWNED", impact: "0.0x Neutral", opponent: "N/A" }
        ]
      },
      {
        id: "brown",
        name: "A.J. Brown",
        team: "PHI",
        pos: "WR",
        pts: 8.2,
        exposure: "+6.1 pts",
        exposureColor: "green",
        leaguesSummary: "2/5 Leagues",
        leagueDetails: [
          { name: "Family League", status: "STARTER", impact: "+1.0x (For Me)", opponent: "Cisco/Bloom" },
          { name: "High Stakes 12-Man", status: "BENCH", impact: "0.0x (Benched)", opponent: "Gelardi" },
          { name: "Work Dynasty", status: "OPPONENT", impact: "-1.0x (Against Me)", opponent: "Stoiber" },
          { name: "Friends PPR", status: "STARTER", impact: "+1.0x (For Me)", opponent: "Taxin" }
        ]
      }
    ]
  },
  {
    id: "g2",
    time: "4:25 PM EST",
    home: "KC",
    away: "BUF",
    status: "PRE-GAME",
    players: [
      {
        id: "allen",
        name: "Josh Allen",
        team: "BUF",
        pos: "QB",
        pts: 0.0,
        exposure: "+12.0 pts",
        exposureColor: "green",
        leaguesSummary: "3/5 Leagues",
        leagueDetails: [
          { name: "Family League", status: "STARTER", impact: "+1.0x (For Me)", opponent: "Cisco/Bloom" },
          { name: "Friends PPR", status: "STARTER", impact: "+1.0x (For Me)", opponent: "Taxin" },
          { name: "Work Dynasty", status: "STARTER", impact: "+1.0x (For Me)", opponent: "Stoiber" }
        ]
      },
      {
        id: "kelce",
        name: "Travis Kelce",
        team: "KC",
        pos: "TE",
        pts: 0.0,
        exposure: "-7.4 pts",
        exposureColor: "red",
        leaguesSummary: "Opponent Starter (3x)",
        leagueDetails: [
          { name: "High Stakes 12-Man", status: "OPPONENT", impact: "-1.0x (Against Me)", opponent: "Gelardi" },
          { name: "Work Dynasty", status: "OPPONENT", impact: "-1.0x (Against Me)", opponent: "Stoiber" },
          { name: "Friends PPR", status: "OPPONENT", impact: "-1.0x (Against Me)", opponent: "Taxin" }
        ]
      }
    ]
  },
  {
    id: "g3",
    time: "8:20 PM EST",
    home: "MIN",
    away: "GB",
    status: "PRE-GAME",
    players: [
      {
        id: "jefferson",
        name: "Justin Jefferson",
        team: "MIN",
        pos: "WR",
        pts: 0.0,
        exposure: "+22.5 pts",
        exposureColor: "green",
        leaguesSummary: "5/5 Leagues",
        leagueDetails: [
          { name: "Family League", status: "STARTER", impact: "+1.0x (For Me)", opponent: "Cisco/Bloom" },
          { name: "High Stakes 12-Man", status: "STARTER", impact: "+1.0x (For Me)", opponent: "Gelardi" },
          { name: "Work Dynasty", status: "STARTER", impact: "+1.0x (For Me)", opponent: "Stoiber" },
          { name: "Friends PPR", status: "STARTER", impact: "+1.0x (For Me)", opponent: "Taxin" },
          { name: "Eliminator", status: "STARTER", impact: "+1.0x (For Me)", opponent: "Shifren" }
        ]
      }
    ]
  }
];

export const mockH2H = {
  myRoster: [
    {
      id: 'barkley',
      name: 'Saquon Barkley',
      pos: 'RB',
      slot: 'RB',
      pts: 21.4,
      proj: 18.2,
      league: 'Family League',
      leagueDetails: [
        { name: 'Family League', status: 'STARTER', opponent: 'Cisco / Bloom', impact: '+1.0x Win Prob' },
        { name: 'High Stakes 12-Man', status: 'STARTER', opponent: 'Team Gelardi', impact: '+1.0x Win Prob' },
        { name: 'Work Dynasty', status: 'STARTER', opponent: 'Stoiber Squad', impact: '+1.0x Win Prob' },
        { name: 'Friends PPR', status: 'STARTER', opponent: 'Byrnes / Siegel', impact: '+1.0x Win Prob' }
      ]
    },
    {
      id: 'brown',
      name: 'A.J. Brown',
      pos: 'WR',
      slot: 'WR',
      pts: 14.8,
      proj: 15.6,
      league: 'High Stakes 12-Man',
      leagueDetails: [
        { name: 'High Stakes 12-Man', status: 'STARTER', opponent: 'Team Gelardi', impact: '+1.0x Win Prob' },
        { name: 'Family League', status: 'STARTER', opponent: 'Cisco / Bloom', impact: '+1.0x Win Prob' },
        { name: 'Work Dynasty', status: 'OPPONENT', opponent: 'Stoiber Squad', impact: '-1.0x Win Prob' }
      ]
    },
    {
      id: 'warner',
      name: 'Fred Warner',
      pos: 'LB',
      slot: 'LB',
      pts: 8.5,
      proj: 9.2,
      league: 'Work Dynasty',
      leagueDetails: [
        { name: 'Work Dynasty', status: 'STARTER', opponent: 'Stoiber Squad', impact: '+1.0x Win Prob' }
      ]
    },
    {
      id: 'breece',
      name: 'Breece Hall',
      pos: 'RB',
      slot: 'BENCH',
      pts: 0.0,
      proj: 14.0,
      league: 'Family League',
      leagueDetails: [
        { name: 'Family League', status: 'BENCH', opponent: 'Cisco / Bloom', impact: '0.0x Inactive' }
      ]
    }
  ],
  opponents: [
    {
      id: 'kelce',
      name: 'Travis Kelce',
      pos: 'TE',
      slot: 'TE',
      pts: 6.2,
      proj: 13.5,
      league: 'Family League',
      leagueDetails: [
        { name: 'Family League', status: 'OPPONENT', opponent: 'Yanno Dynasty', impact: '-1.0x Risk' },
        { name: 'High Stakes 12-Man', status: 'OPPONENT', opponent: 'Briarcliff Bombers', impact: '-1.0x Risk' },
        { name: 'Work Dynasty', status: 'OPPONENT', opponent: 'ArrowMark Alpha', impact: '-1.0x Risk' }
      ]
    },
    {
      id: 'watt',
      name: 'T.J. Watt',
      pos: 'DL',
      slot: 'DL',
      pts: 11.0,
      proj: 7.8,
      league: 'Work Dynasty',
      leagueDetails: [
        { name: 'Work Dynasty', status: 'OPPONENT', opponent: 'ArrowMark Alpha', impact: '-1.0x Risk' }
      ]
    }
  ]
};