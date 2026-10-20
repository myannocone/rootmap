import React, { useState, useEffect, useMemo } from 'react';
import PlayerAvatar from './components/PlayerAvatar';
import RootMapLogo from './components/Logo';
import { fetchLiveNFLSlate } from './services/espnScoreboard';

const INITIAL_LEAGUES = [
  {
    id: 'lg_1',
    name: 'Yannocone/Scheir',
    opponent: 'Gelardi',
    platform: 'Yahoo',
    season: '2026',
    myScore: 126.28,
    oppScore: 126.44,
    starters: [
      { name: 'Justin Herbert', nflTeam: 'LAC', position: 'QB', slot: 'QB', points: 18.4 },
      { name: 'Saquon Barkley', nflTeam: 'PHI', position: 'RB', slot: 'RB', points: 24.2 },
      { name: 'Amon-Ra St. Brown', nflTeam: 'DET', position: 'WR', slot: 'WR', points: 16.8 },
      { name: 'Nico Collins', nflTeam: 'HOU', position: 'WR', slot: 'WR', points: 14.1 },
      { name: 'Trey McBride', nflTeam: 'ARI', position: 'TE', slot: 'TE', points: 11.6 },
      { name: 'Zay Flowers', nflTeam: 'BAL', position: 'WR', slot: 'FLEX', points: 13.9 },
      { name: 'Roquan Smith', nflTeam: 'BAL', position: 'LB', slot: 'IDP', points: 12.0 },
      { name: 'Bobby Wagner', nflTeam: 'WAS', position: 'LB', slot: 'IDP', points: 10.5 }
    ],
    opponentStarters: [
      { name: 'Patrick Mahomes', nflTeam: 'KC', position: 'QB', slot: 'QB', points: 21.6 },
      { name: 'Tyreek Hill', nflTeam: 'MIA', position: 'WR', slot: 'WR', points: 19.4 },
      { name: 'Alvin Kamara', nflTeam: 'NO', position: 'RB', slot: 'RB', points: 15.2 },
      { name: 'George Kittle', nflTeam: 'SF', position: 'TE', slot: 'TE', points: 13.8 },
      { name: 'Fred Warner', nflTeam: 'SF', position: 'LB', slot: 'IDP', points: 9.5 }
    ]
  },
  {
    id: 'lg_2',
    name: 'Westchester Main H2H',
    opponent: 'Cisco/Bloom',
    platform: 'Yahoo',
    season: '2026',
    myScore: 114.60,
    oppScore: 108.20,
    starters: [
      { name: 'Lamar Jackson', nflTeam: 'BAL', position: 'QB', slot: 'QB', points: 26.4 },
      { name: 'Bijan Robinson', nflTeam: 'ATL', position: 'RB', slot: 'RB', points: 17.5 },
      { name: 'Saquon Barkley', nflTeam: 'PHI', position: 'RB', slot: 'RB', points: 24.2 },
      { name: 'CeeDee Lamb', nflTeam: 'DAL', position: 'WR', slot: 'WR', points: 18.2 },
      { name: 'George Kittle', nflTeam: 'SF', position: 'TE', slot: 'TE', points: 13.8 },
      { name: 'Fred Warner', nflTeam: 'SF', position: 'LB', slot: 'IDP', points: 9.5 }
    ],
    opponentStarters: [
      { name: 'Josh Allen', nflTeam: 'BUF', position: 'QB', slot: 'QB', points: 24.8 },
      { name: 'Justin Jefferson', nflTeam: 'MIN', position: 'WR', slot: 'WR', points: 20.1 },
      { name: 'Travis Kelce', nflTeam: 'KC', position: 'TE', slot: 'TE', points: 11.2 },
      { name: 'Roquan Smith', nflTeam: 'BAL', position: 'LB', slot: 'IDP', points: 12.0 }
    ]
  },
  {
    id: 'lg_3',
    name: 'High Stakes Dynasty',
    opponent: 'Stern/Bloom',
    platform: 'Yahoo',
    season: '2026',
    myScore: 98.40,
    oppScore: 112.50,
    starters: [
      { name: 'Josh Allen', nflTeam: 'BUF', position: 'QB', slot: 'QB', points: 24.8 },
      { name: 'James Cook', nflTeam: 'BUF', position: 'RB', slot: 'RB', points: 16.3 },
      { name: 'Justin Jefferson', nflTeam: 'MIN', position: 'WR', slot: 'WR', points: 20.1 },
      { name: 'Davante Adams', nflTeam: 'NYJ', position: 'WR', slot: 'WR', points: 12.4 },
      { name: 'Brock Bowers', nflTeam: 'LV', position: 'TE', slot: 'TE', points: 14.5 }
    ],
    opponentStarters: [
      { name: 'Patrick Mahomes', nflTeam: 'KC', position: 'QB', slot: 'QB', points: 21.6 },
      { name: 'Saquon Barkley', nflTeam: 'PHI', position: 'RB', slot: 'RB', points: 24.2 }, // Conflict!
      { name: 'Amon-Ra St. Brown', nflTeam: 'DET', position: 'WR', slot: 'WR', points: 16.8 }, // Conflict!
      { name: 'CeeDee Lamb', nflTeam: 'DAL', position: 'WR', slot: 'WR', points: 18.2 }
    ]
  }
];

export default function App() {
  const [view, setView] = useState('matchups'); // Default directly to the Duel Matchups grid
  const [leagues, setLeagues] = useState(INITIAL_LEAGUES);
  const [selectedPlayer, setSelectedPlayer] = useState(null);
  const [activeLeagueDrawer, setActiveLeagueDrawer] = useState(null);

  // Calculate Net Portfolio Scoring Delta across all leagues
  const totalNetDelta = useMemo(() => {
    return leagues.reduce((acc, lg) => acc + (lg.myScore - lg.oppScore), 0);
  }, [leagues]);

  // Aggregate "Your Portfolio" (Left Column)
  const myPortfolio = useMemo(() => {
    const map = new Map();
    leagues.forEach(lg => {
      (lg.starters || []).forEach(p => {
        if (!map.has(p.name)) {
          map.set(p.name, {
            ...p,
            id: `${p.name}_${p.nflTeam}`,
            leagueShares: 0,
            leagues: [],
            oppShares: 0,
            oppLeagues: []
          });
        }
        const item = map.get(p.name);
        item.leagueShares += 1;
        item.leagues.push(lg.name);
      });
    });

    // Check if any opponent is starting your players (Conflicts / Hedged)
    leagues.forEach(lg => {
      (lg.opponentStarters || []).forEach(oppP => {
        if (map.has(oppP.name)) {
          const item = map.get(oppP.name);
          item.oppShares += 1;
          item.oppLeagues.push(`${lg.opponent} (${lg.name})`);
        }
      });
    });

    return Array.from(map.values()).sort((a, b) => b.leagueShares - a.leagueShares);
  }, [leagues]);

  // Aggregate "Opposition Threats" (Right Column)
  const oppThreats = useMemo(() => {
    const map = new Map();
    leagues.forEach(lg => {
      (lg.opponentStarters || []).forEach(p => {
        if (!map.has(p.name)) {
          map.set(p.name, {
            ...p,
            id: `opp_${p.name}_${p.nflTeam}`,
            threatShares: 0,
            oppLeagues: [],
            isConflicted: false
          });
        }
        const item = map.get(p.name);
        item.threatShares += 1;
        item.oppLeagues.push(`${lg.opponent} (${lg.name})`);
      });
    });

    // Flag if you also own this opponent player
    const myNames = new Set(myPortfolio.map(p => p.name));
    return Array.from(map.values())
      .map(p => ({ ...p, isConflicted: myNames.has(p.name) }))
      .sort((a, b) => b.threatShares - a.threatShares);
  }, [leagues, myPortfolio]);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 pb-28 font-sans select-none">
      {/* Top Brand Header */}
      <header className="sticky top-0 z-40 bg-slate-950/95 backdrop-blur-md border-b border-slate-800/80 px-4 py-3 max-w-md mx-auto flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <RootMapLogo className="w-8 h-8" showWordmark={true} />
        </div>
        <div className="flex items-center gap-2">
          <div className={`px-2.5 py-1 rounded-full text-xs font-black font-mono border ${
            totalNetDelta >= 0 
              ? 'bg-emerald-950/80 text-emerald-400 border-emerald-700/60' 
              : 'bg-rose-950/80 text-rose-400 border-rose-700/60'
          }`}>
            {totalNetDelta >= 0 ? `+${totalNetDelta.toFixed(1)}` : totalNetDelta.toFixed(1)}
          </div>
        </div>
      </header>

      {/* Main Container */}
      <main className="max-w-md mx-auto p-3 space-y-3">
        {/* VIEW 1: MATCHUPS (THE TWO-COLUMN DUEL GRID) */}
        {view === 'matchups' && (
          <div className="space-y-3">
            {/* Header Titles */}
            <div className="flex justify-between items-center px-1">
              <div className="text-xs font-black uppercase tracking-wider text-slate-300">
                Week 7 Portfolio Grid
              </div>
              <div className="text-[11px] font-mono font-bold text-slate-400">
                {myPortfolio.length} Active • {oppThreats.length} Threats
              </div>
            </div>

            {/* Split Column Headers */}
            <div className="grid grid-cols-2 gap-2 text-center text-xs font-black tracking-wider uppercase">
              <div className="bg-slate-900 border border-emerald-500/30 rounded-xl py-2 px-1 text-emerald-400 flex flex-col items-center justify-center">
                <span>Your Portfolio</span>
                <span className="text-[10px] text-slate-400 font-normal">({myPortfolio.length} Active)</span>
              </div>
              <div className="bg-slate-900 border border-rose-500/30 rounded-xl py-2 px-1 text-rose-400 flex flex-col items-center justify-center">
                <span>Opposition Threats</span>
                <span className="text-[10px] text-slate-400 font-normal">({oppThreats.length} Total)</span>
              </div>
            </div>

            {/* Duel Grid Body */}
            <div className="grid grid-cols-2 gap-2 relative">
              {/* LEFT COLUMN: YOUR PORTFOLIO */}
              <div className="space-y-2">
                {myPortfolio.map((player) => {
                  const isConflict = player.oppShares > 0;
                  return (
                    <div
                      key={player.id}
                      onClick={() => setSelectedPlayer(player)}
                      className={`relative rounded-xl p-2.5 transition active:scale-[0.98] cursor-pointer border shadow-sm ${
                        isConflict
                          ? 'bg-amber-950/20 border-amber-500/50 hover:bg-amber-950/30'
                          : 'bg-emerald-950/20 border-emerald-500/40 hover:bg-emerald-950/30'
                      }`}
                    >
                      {/* Conflict Indicator Dot */}
                      {isConflict && (
                        <span className="absolute -top-1 -right-1 flex h-3 w-3">
                          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75"></span>
                          <span className="relative inline-flex rounded-full h-3 w-3 bg-amber-500"></span>
                        </span>
                      )}

                      <div className="flex items-center justify-between gap-1 mb-1.5">
                        <div className="truncate">
                          <div className="font-black text-xs text-white truncate leading-tight">
                            {player.name}
                          </div>
                          <div className="text-[10px] font-bold text-slate-400">
                            {player.position} • {player.nflTeam}
                          </div>
                        </div>
                        {PlayerAvatar && (
                          <PlayerAvatar 
                            name={player.name} 
                            position={player.position} 
                            className="w-7 h-7 shrink-0" 
                          />
                        )}
                      </div>

                      <div className="flex justify-between items-center text-[10px] pt-1.5 border-t border-slate-800/80 font-mono">
                        <span className="font-bold text-emerald-400">
                          {player.leagueShares} {player.leagueShares === 1 ? 'LEAGUE' : 'LEAGUES'}
                        </span>
                        {isConflict ? (
                          <span className="text-amber-400 font-bold">v {player.oppShares} Opp</span>
                        ) : (
                          <span className="text-slate-500">PURE</span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* RIGHT COLUMN: OPPOSITION THREATS */}
              <div className="space-y-2">
                {oppThreats.map((threat) => {
                  return (
                    <div
                      key={threat.id}
                      onClick={() => setSelectedPlayer(threat)}
                      className={`relative rounded-xl p-2.5 transition active:scale-[0.98] cursor-pointer border shadow-sm ${
                        threat.isConflicted
                          ? 'bg-amber-950/20 border-amber-500/50 hover:bg-amber-950/30'
                          : 'bg-rose-950/20 border-rose-500/40 hover:bg-rose-950/30'
                      }`}
                    >
                      {threat.isConflicted && (
                        <span className="absolute -top-1 -left-1 flex h-3 w-3">
                          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75"></span>
                          <span className="relative inline-flex rounded-full h-3 w-3 bg-amber-500"></span>
                        </span>
                      )}

                      <div className="flex items-center justify-between gap-1 mb-1.5">
                        <div className="truncate">
                          <div className="font-black text-xs text-white truncate leading-tight">
                            {threat.name}
                          </div>
                          <div className="text-[10px] font-bold text-slate-400">
                            {threat.position} • {threat.nflTeam}
                          </div>
                        </div>
                        {PlayerAvatar && (
                          <PlayerAvatar 
                            name={threat.name} 
                            position={threat.position} 
                            className="w-7 h-7 shrink-0" 
                          />
                        )}
                      </div>

                      <div className="flex justify-between items-center text-[10px] pt-1.5 border-t border-slate-800/80 font-mono">
                        <span className="font-bold text-rose-400">
                          {threat.threatShares} {threat.threatShares === 1 ? 'LEAGUE' : 'LEAGUES'}
                        </span>
                        {threat.isConflicted ? (
                          <span className="text-amber-400 font-bold">HEDGED</span>
                        ) : (
                          <span className="text-rose-400 font-bold">THREAT</span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {/* VIEW 2: ALL LEAGUES */}
        {view === 'all-leagues' && (
          <div className="space-y-3">
            <div className="text-xs font-black uppercase tracking-wider text-slate-300">
              Connected Leagues ({leagues.length})
            </div>
            {leagues.map((lg) => (
              <div
                key={lg.id}
                onClick={() => setActiveLeagueDrawer(lg)}
                className="bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-3 cursor-pointer hover:border-slate-700 transition"
              >
                <div className="flex justify-between items-start">
                  <div>
                    <div className="font-black text-white text-base">{lg.name}</div>
                    <div className="text-xs text-slate-400">vs {lg.opponent}</div>
                  </div>
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-purple-950 text-purple-300 border border-purple-800 font-bold">
                    {lg.platform}
                  </span>
                </div>
                <div className="flex justify-between items-center pt-2 border-t border-slate-800 text-xs">
                  <span className="text-slate-400">{lg.starters.length} Starters Synced</span>
                  <span className="font-mono font-bold text-slate-200">
                    {lg.myScore.toFixed(2)} - {lg.oppScore.toFixed(2)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* VIEW 3: BLENDED H2H */}
        {view === 'blended' && (
          <div className="space-y-3">
            <div className="text-xs font-black uppercase tracking-wider text-slate-300">
              Blended Head-to-Head Margin
            </div>
            {leagues.map((lg) => {
              const diff = lg.myScore - lg.oppScore;
              const isWinning = diff >= 0;
              return (
                <div key={lg.id} className="bg-slate-900 border border-slate-800 rounded-xl p-3 flex justify-between items-center text-xs">
                  <div>
                    <div className="font-bold text-slate-200">{lg.name}</div>
                    <div className="text-slate-400">vs {lg.opponent}</div>
                  </div>
                  <div className="text-right">
                    <div className="font-mono font-black text-emerald-400 text-sm">{lg.myScore.toFixed(2)} pts</div>
                    <div className={`text-[10px] font-bold ${isWinning ? 'text-emerald-400' : 'text-rose-400'}`}>
                      {isWinning ? `+${diff.toFixed(2)}` : diff.toFixed(2)}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </main>

      {/* Persistent Bottom Navigation */}
      <nav className="fixed bottom-0 left-0 right-0 z-40 bg-slate-950/95 backdrop-blur-lg border-t border-slate-800 max-w-md mx-auto">
        <div className="grid grid-cols-3 py-2 px-3 gap-1">
          <button
            onClick={() => setView('matchups')}
            className={`py-2 flex flex-col items-center justify-center rounded-xl text-xs font-bold transition ${
              view === 'matchups' ? 'bg-slate-800 text-emerald-400' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <span>⚔️ Matchups</span>
          </button>
          <button
            onClick={() => setView('blended')}
            className={`py-2 flex flex-col items-center justify-center rounded-xl text-xs font-bold transition ${
              view === 'blended' ? 'bg-slate-800 text-emerald-400' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <span>⚖️ Blended H2H</span>
          </button>
          <button
            onClick={() => setView('all-leagues')}
            className={`py-2 flex flex-col items-center justify-center rounded-xl text-xs font-bold transition ${
              view === 'all-leagues' ? 'bg-slate-800 text-emerald-400' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <span>🏆 Leagues</span>
          </button>
        </div>
      </nav>

      {/* Player Detail / Conflict Breakdown Drawer */}
      {selectedPlayer && (
        <div
          onClick={() => setSelectedPlayer(null)}
          className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-end justify-center"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="bg-slate-900 border-t sm:border border-slate-800 rounded-t-3xl sm:rounded-3xl p-5 max-w-md w-full space-y-4 shadow-2xl"
          >
            <div className="w-12 h-1.5 bg-slate-700 rounded-full mx-auto" />
            <div className="flex justify-between items-start border-b border-slate-800 pb-3">
              <div>
                <h3 className="text-lg font-black text-white">{selectedPlayer.name}</h3>
                <div className="text-xs text-slate-400 font-semibold">
                  {selectedPlayer.position} • {selectedPlayer.nflTeam}
                </div>
              </div>
              <button
                onClick={() => setSelectedPlayer(null)}
                className="w-8 h-8 rounded-full bg-slate-800 text-slate-400 flex items-center justify-center font-bold text-sm"
              >
                ✕
              </button>
            </div>

            <div className="space-y-3">
              {selectedPlayer.leagues && selectedPlayer.leagues.length > 0 && (
                <div>
                  <div className="text-[11px] font-bold text-emerald-400 uppercase tracking-wider mb-1">
                    Your Roster ({selectedPlayer.leagues.length} Leagues)
                  </div>
                  <div className="space-y-1">
                    {selectedPlayer.leagues.map((lgName, i) => (
                      <div key={i} className="bg-slate-800/60 rounded-lg px-2.5 py-1.5 text-xs text-slate-200 border border-slate-700/50">
                        {lgName}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {selectedPlayer.oppLeagues && selectedPlayer.oppLeagues.length > 0 && (
                <div>
                  <div className="text-[11px] font-bold text-rose-400 uppercase tracking-wider mb-1">
                    Opponent Matchup Exposure ({selectedPlayer.oppLeagues.length})
                  </div>
                  <div className="space-y-1">
                    {selectedPlayer.oppLeagues.map((opp, i) => (
                      <div key={i} className="bg-slate-800/60 rounded-lg px-2.5 py-1.5 text-xs text-slate-200 border border-slate-700/50">
                        {opp}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* League Matchup Drawer */}
      {activeLeagueDrawer && (
        <div
          onClick={() => setActiveLeagueDrawer(null)}
          className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-end justify-center"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="bg-slate-900 border-t sm:border border-slate-800 rounded-t-3xl sm:rounded-3xl p-5 max-w-md w-full max-h-[80vh] flex flex-col shadow-2xl"
          >
            <div className="w-12 h-1.5 bg-slate-700 rounded-full mx-auto mb-3" />
            <div className="flex justify-between items-center border-b border-slate-800 pb-3">
              <div>
                <h3 className="text-base font-black text-white">{activeLeagueDrawer.name}</h3>
                <div className="text-xs text-slate-400">vs {activeLeagueDrawer.opponent}</div>
              </div>
              <button
                onClick={() => setActiveLeagueDrawer(null)}
                className="w-7 h-7 rounded-full bg-slate-800 text-slate-400 flex items-center justify-center font-bold text-xs"
              >
                ✕
              </button>
            </div>
            <div className="overflow-y-auto space-y-2 py-3">
              {activeLeagueDrawer.starters.map((p, idx) => (
                <div key={idx} className="bg-slate-800/60 rounded-xl p-2.5 flex justify-between items-center text-xs border border-slate-700/40">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-slate-700 text-slate-300 font-bold">
                      {p.slot}
                    </span>
                    <span className="font-bold text-white">{p.name}</span>
                    <span className="text-[11px] text-slate-400">{p.nflTeam}</span>
                  </div>
                  <span className="font-mono font-bold text-emerald-400">{p.points} pts</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
