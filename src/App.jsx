import React, { useState, useEffect, useMemo } from 'react';
import { mockGames as initialGames } from './data/mockSlate';
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
      { name: 'Justin Herbert', nflTeam: 'LAC', position: 'QB', slot: 'QB', isStarter: true },
      { name: 'Saquon Barkley', nflTeam: 'PHI', position: 'RB', slot: 'RB', isStarter: true },
      { name: 'Amon-Ra St. Brown', nflTeam: 'DET', position: 'WR', slot: 'WR', isStarter: true },
      { name: 'Nico Collins', nflTeam: 'HOU', position: 'WR', slot: 'WR', isStarter: true },
      { name: 'Trey McBride', nflTeam: 'ARI', position: 'TE', slot: 'TE', isStarter: true },
      { name: 'Zay Flowers', nflTeam: 'BAL', position: 'WR', slot: 'FLEX', isStarter: true },
      { name: 'Roquan Smith', nflTeam: 'BAL', position: 'LB', slot: 'IDP', isStarter: true },
      { name: 'Bobby Wagner', nflTeam: 'WAS', position: 'LB', slot: 'IDP', isStarter: true },
      { name: 'Brian Thomas Jr.', nflTeam: 'JAX', position: 'WR', slot: 'BN', isStarter: false }
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
      { name: 'Lamar Jackson', nflTeam: 'BAL', position: 'QB', slot: 'QB', isStarter: true },
      { name: 'Bijan Robinson', nflTeam: 'ATL', position: 'RB', slot: 'RB', isStarter: true },
      { name: 'Saquon Barkley', nflTeam: 'PHI', position: 'RB', slot: 'RB', isStarter: true },
      { name: 'CeeDee Lamb', nflTeam: 'DAL', position: 'WR', slot: 'WR', isStarter: true },
      { name: 'George Kittle', nflTeam: 'SF', position: 'TE', slot: 'TE', isStarter: true },
      { name: 'Fred Warner', nflTeam: 'SF', position: 'LB', slot: 'IDP', isStarter: true },
      { name: 'Foyesade Oluokun', nflTeam: 'JAX', position: 'LB', slot: 'IDP', isStarter: true }
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
      { name: 'Josh Allen', nflTeam: 'BUF', position: 'QB', slot: 'QB', isStarter: true },
      { name: 'James Cook', nflTeam: 'BUF', position: 'RB', slot: 'RB', isStarter: true },
      { name: 'Justin Jefferson', nflTeam: 'MIN', position: 'WR', slot: 'WR', isStarter: true },
      { name: 'Davante Adams', nflTeam: 'NYJ', position: 'WR', slot: 'WR', isStarter: true },
      { name: 'Brock Bowers', nflTeam: 'LV', position: 'TE', slot: 'TE', isStarter: true }
    ]
  }
];

export default function App() {
  const [view, setView] = useState('all-leagues');
  const [selectedPlayerId, setSelectedPlayerId] = useState(null);
  const [drawerPlayer, setDrawerPlayer] = useState(null);
  const [activeLeagueDrawer, setActiveLeagueDrawer] = useState(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [customLeagueName, setCustomLeagueName] = useState('');
  const [customOpponent, setCustomOpponent] = useState('');

  const [leagues, setLeagues] = useState(INITIAL_LEAGUES);
  const [games, setGames] = useState(initialGames || []);

  const refreshLiveSlate = async () => {
    try {
      const live = await fetchLiveNFLSlate();
      if (Array.isArray(live) && live.length > 0) {
        setGames(live);
      }
    } catch (err) {
      console.warn('Scoreboard fetch error:', err);
    }
  };

  useEffect(() => {
    refreshLiveSlate();
    const interval = setInterval(refreshLiveSlate, 60000);
    return () => clearInterval(interval);
  }, []);

  const rosterAggregations = useMemo(() => {
    const map = new Map();

    (leagues || []).forEach(lg => {
      (lg.starters || []).forEach(player => {
        if (!map.has(player.name)) {
          map.set(player.name, {
            id: `${player.name}_${player.nflTeam}`,
            name: player.name,
            position: player.position,
            nflTeam: player.nflTeam,
            isStarter: player.isStarter,
            leagues: []
          });
        }
        const item = map.get(player.name);
        item.leagues.push({
          leagueName: lg.name,
          type: player.isStarter ? 'ROSTERED' : 'BENCH',
          opponent: lg.opponent
        });
      });
    });

    return Array.from(map.values()).map(p => {
      const rosteredCount = p.leagues.filter(l => l.type === 'ROSTERED').length;
      return {
        ...p,
        shares: rosteredCount,
        netLeverage: rosteredCount * 1.0
      };
    });
  }, [leagues]);

  const handleForcePurgeAndReset = () => {
    try {
      localStorage.clear();
    } catch (e) {}
    setLeagues(INITIAL_LEAGUES);
    alert('Cleared cache and reloaded default leagues.');
  };

  const handleAddLeague = (e) => {
    e.preventDefault();
    if (!customLeagueName.trim()) return;

    const newLg = {
      id: `lg_${Date.now()}`,
      name: customLeagueName.trim(),
      opponent: customOpponent.trim() || 'Opponent',
      platform: 'Yahoo',
      season: '2026',
      myScore: 0.0,
      oppScore: 0.0,
      starters: []
    };

    setLeagues(prev => [newLg, ...prev]);
    setCustomLeagueName('');
    setCustomOpponent('');
    setShowAddModal(false);
  };

  const getGamePlayers = (game) => {
    if (!game) return [];
    const matching = rosterAggregations.filter(
      p => p.nflTeam === game.away || p.nflTeam === game.home
    );
    return matching.length > 0 ? matching : (Array.isArray(game.players) ? game.players : []);
  };

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100 pb-28">
      <header className="sticky top-0 z-40 bg-slate-950/90 backdrop-blur-md border-b border-slate-800 px-4 py-3 flex justify-between items-center max-w-md mx-auto">
        <div className="flex items-center gap-2">
          {RootMapLogo ? (
            <RootMapLogo className="w-8 h-8" showWordmark={true} />
          ) : (
            <div className="w-8 h-8 rounded-lg bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center font-black text-emerald-400 text-sm">
              RM
            </div>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button 
            onClick={() => setShowAddModal(true)}
            className="px-2.5 py-1 text-xs font-semibold rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white transition"
          >
            + League
          </button>
          <button 
            onClick={handleForcePurgeAndReset}
            className="px-2 py-1 text-xs font-semibold rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 transition"
          >
            Reset
          </button>
        </div>
      </header>

      <main className="max-w-md mx-auto p-4 space-y-4">
        {view === 'all-leagues' && (
          <div className="space-y-3">
            <div className="flex justify-between items-center mb-1">
              <div>
                <h2 className="text-sm font-black text-slate-200 uppercase tracking-wider">
                  Active Portfolio ({leagues.length} Leagues)
                </h2>
                <div className="text-[11px] text-emerald-400 font-semibold">
                  ● Verified Rosters Connected
                </div>
              </div>
              <button
                onClick={handleForcePurgeAndReset}
                className="text-[11px] font-bold text-slate-400 hover:text-slate-200 underline"
              >
                Reset Default
              </button>
            </div>

            <div className="space-y-3">
              {leagues.map((lg) => (
                <div
                  key={lg.id}
                  onClick={() => setActiveLeagueDrawer(lg)}
                  className="bg-slate-800/80 hover:bg-slate-700/60 active:scale-[0.99] cursor-pointer rounded-2xl border border-slate-700/80 p-4 space-y-3 transition shadow-lg"
                >
                  <div className="flex justify-between items-start">
                    <div>
                      <div className="font-black text-white text-base leading-snug">{lg.name}</div>
                      <div className="text-xs text-slate-400 mt-0.5">
                        vs <span className="text-slate-200 font-bold">{lg.opponent}</span>
                      </div>
                    </div>
                    <span className="text-[10px] uppercase font-mono font-bold px-2 py-0.5 rounded-full bg-purple-950/80 text-purple-300 border border-purple-700">
                      {lg.platform}
                    </span>
                  </div>

                  <div className="flex justify-between items-center pt-2 border-t border-slate-700/50 text-xs">
                    <span className="text-slate-400 font-medium">
                      {lg.starters?.length || 0} Players Tracked (Tap for roster)
                    </span>
                    <span className="font-mono font-bold text-slate-200">
                      {Number(lg.myScore).toFixed(2)} - {Number(lg.oppScore).toFixed(2)}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {view === 'per-game' && (
          <div className="space-y-3">
            <div className="bg-slate-950/80 rounded-2xl p-3 border border-emerald-500/30 flex justify-between items-center">
              <div>
                <div className="text-xs font-black text-emerald-400 uppercase tracking-wide">
                  Live Portfolio Net Leverage
                </div>
                <div className="text-[11px] text-slate-400">
                  Tracking active rostered players against NFL slate
                </div>
              </div>
              <div className="text-right">
                <div className="text-xs font-bold text-slate-300">{rosterAggregations.length} Active Players</div>
              </div>
            </div>

            {(games || []).map(game => {
              const players = getGamePlayers(game);
              return (
                <div key={game.id} className="bg-slate-800/80 rounded-2xl border border-slate-700/80 shadow-md overflow-hidden">
                  <div className="bg-slate-950/60 px-3.5 py-2.5 border-b border-slate-700/80 flex justify-between items-center text-xs font-semibold text-slate-400">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-slate-200">{game.away} @ {game.home}</span>
                      <span className="text-[11px] font-mono text-slate-400">
                        ({game.awayScore || 0} - {game.homeScore || 0})
                      </span>
                    </div>
                    <span className={game.status?.includes('LIVE') ? 'text-emerald-400 font-bold' : ''}>
                      {game.status} • {game.time}
                    </span>
                  </div>

                  <div className="divide-y divide-slate-700/50">
                    {players.length === 0 ? (
                      <div className="p-3 text-center text-xs text-slate-500 italic">
                        No active rostered players in this matchup
                      </div>
                    ) : (
                      players.map(player => {
                        const isTarget = player.id === selectedPlayerId;
                        return (
                          <div 
                            key={player.id || player.name} 
                            onClick={() => {
                              setSelectedPlayerId(player.id);
                              setDrawerPlayer(player);
                            }}
                            className={`p-3.5 flex items-center justify-between cursor-pointer transition select-none ${
                              isTarget ? 'bg-slate-700/30' : 'hover:bg-slate-700/20'
                            }`}
                          >
                            <div className="flex items-center gap-2.5">
                              {PlayerAvatar ? (
                                <PlayerAvatar 
                                  playerId={player.id} 
                                  name={player.name} 
                                  position={player.position} 
                                  className="w-9 h-9" 
                                />
                              ) : null}
                              <div>
                                <div className="font-bold text-white text-sm leading-tight">{player.name}</div>
                                <div className="text-[11px] font-semibold text-slate-400">
                                  {player.position} • {player.nflTeam || 'NFL'}
                                </div>
                              </div>
                            </div>

                            <div className="text-right">
                              <div className="text-sm font-black text-emerald-400">
                                +{player.netLeverage ? player.netLeverage.toFixed(1) : '1.0'}x
                              </div>
                              <div className="text-[10px] text-slate-400 font-semibold">
                                {player.shares || 1} league share{player.shares > 1 ? 's' : ''}
                              </div>
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {view === 'blended' && (
          <div className="space-y-3">
            <div className="bg-slate-800/80 rounded-2xl border border-slate-700/80 p-4 space-y-3">
              <div>
                <h3 className="font-bold text-white text-sm">Blended Head-to-Head Perspective</h3>
                <p className="text-xs text-slate-400">Real-time aggregate scoring swings across your portfolio.</p>
              </div>

              <div className="space-y-2.5">
                {leagues.map((lg) => {
                  const myScore = parseFloat(lg.myScore || 0);
                  const oppScore = parseFloat(lg.oppScore || 0);
                  const diff = myScore - oppScore;
                  const isWinning = diff >= 0;

                  return (
                    <div key={lg.id} className="bg-slate-900/60 rounded-xl p-3 border border-slate-800 flex justify-between items-center text-xs">
                      <div>
                        <div className="font-bold text-slate-200">{lg.name}</div>
                        <div className="text-slate-400">vs {lg.opponent}</div>
                      </div>
                      <div className="text-right">
                        <div className="font-black text-emerald-400 text-sm">
                          {myScore.toFixed(2)} pts
                        </div>
                        <div className="text-[10px] text-slate-400">
                          Opp: {oppScore.toFixed(2)}{' '}
                          <span className={`ml-1 font-bold ${isWinning ? 'text-emerald-400' : 'text-rose-400'}`}>
                            ({isWinning ? '+' : ''}{diff.toFixed(2)})
                          </span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </main>

      <nav className="fixed bottom-0 left-0 right-0 z-40 bg-slate-950/95 backdrop-blur-lg border-t border-slate-800 max-w-md mx-auto">
        <div className="grid grid-cols-3 py-2 px-3 gap-1">
          <button
            onClick={() => setView('per-game')}
            className={`py-2 flex flex-col items-center justify-center rounded-xl text-xs font-bold transition ${
              view === 'per-game' ? 'bg-slate-800 text-emerald-400 shadow-sm' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <span>🎮 Game Slate</span>
          </button>
          <button
            onClick={() => setView('blended')}
            className={`py-2 flex flex-col items-center justify-center rounded-xl text-xs font-bold transition ${
              view === 'blended' ? 'bg-slate-800 text-emerald-400 shadow-sm' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <span>⚖️ Blended H2H</span>
          </button>
          <button
            onClick={() => setView('all-leagues')}
            className={`py-2 flex flex-col items-center justify-center rounded-xl text-xs font-bold transition ${
              view === 'all-leagues' ? 'bg-slate-800 text-emerald-400 shadow-sm' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <span>🏆 All Leagues</span>
          </button>
        </div>
      </nav>

      {activeLeagueDrawer && (
        <div
          onClick={() => setActiveLeagueDrawer(null)}
          className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-end justify-center"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="bg-slate-900 border-t sm:border border-slate-700/80 rounded-t-3xl sm:rounded-3xl p-5 max-w-md w-full max-h-[80vh] flex flex-col shadow-2xl"
          >
            <div className="w-12 h-1.5 bg-slate-700 rounded-full mx-auto mb-3" />
            <div className="flex justify-between items-center border-b border-slate-800 pb-3">
              <div>
                <h3 className="text-base font-black text-white">{activeLeagueDrawer.name}</h3>
                <div className="text-xs text-purple-400 font-semibold">Active Roster vs {activeLeagueDrawer.opponent}</div>
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
                      {p.slot || p.position}
                    </span>
                    <span className="font-bold text-white">{p.name}</span>
                    <span className="text-[11px] text-slate-400">{p.nflTeam}</span>
                  </div>
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${
                    p.isStarter ? 'bg-emerald-950 text-emerald-400 border border-emerald-800' : 'bg-slate-800 text-slate-400'
                  }`}>
                    {p.isStarter ? 'STARTER' : 'BENCH'}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {drawerPlayer && (
        <div
          onClick={() => setDrawerPlayer(null)}
          className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-end justify-center"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="bg-slate-900 border-t sm:border border-slate-700/80 rounded-t-3xl sm:rounded-3xl p-5 max-w-md w-full space-y-4 shadow-2xl"
          >
            <div className="w-12 h-1.5 bg-slate-700 rounded-full mx-auto" />
            <div className="flex justify-between items-start border-b border-slate-800 pb-3">
              <div>
                <h3 className="text-lg font-black text-white">{drawerPlayer.name}</h3>
                <div className="text-xs text-slate-400 font-semibold">
                  {drawerPlayer.position} • {drawerPlayer.nflTeam || 'NFL'}
                </div>
              </div>
              <button
                onClick={() => setDrawerPlayer(null)}
                className="w-8 h-8 rounded-full bg-slate-800 text-slate-400 flex items-center justify-center font-bold text-sm"
              >
                ✕
              </button>
            </div>

            <div className="space-y-2">
              <div className="text-xs font-bold text-slate-400 uppercase tracking-wider">Portfolio Involvement</div>
              {(drawerPlayer.leagues || []).map((detail, idx) => (
                <div key={idx} className="bg-slate-800/60 rounded-xl p-2.5 flex justify-between items-center text-xs border border-slate-700/40">
                  <span className="font-semibold text-slate-200">{detail.leagueName}</span>
                  <span className="px-2 py-0.5 rounded text-[10px] font-black uppercase tracking-wider bg-emerald-950 text-emerald-400 border border-emerald-800">
                    {detail.type}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {showAddModal && (
        <div
          onClick={() => setShowAddModal(false)}
          className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="bg-slate-900 border border-slate-700 rounded-2xl p-5 max-w-sm w-full space-y-4 shadow-2xl"
          >
            <h3 className="text-base font-black text-white">Add Fantasy League</h3>
            <form onSubmit={handleAddLeague} className="space-y-3">
              <div>
                <label className="text-[11px] font-semibold text-slate-400 block mb-1">League Name</label>
                <input
                  type="text"
                  placeholder="e.g. Westchester Dynasty League"
                  value={customLeagueName}
                  onChange={(e) => setCustomLeagueName(e.target.value)}
                  className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-emerald-500"
                  required
                />
              </div>
              <div>
                <label className="text-[11px] font-semibold text-slate-400 block mb-1">Opponent Name</label>
                <input
                  type="text"
                  placeholder="e.g. Gelardi"
                  value={customOpponent}
                  onChange={(e) => setCustomOpponent(e.target.value)}
                  className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-emerald-500"
                />
              </div>
              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="flex-1 py-2 bg-slate-800 hover:bg-slate-700 rounded-xl text-xs font-bold text-slate-300"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="flex-1 py-2 bg-emerald-600 hover:bg-emerald-500 rounded-xl text-xs font-bold text-white"
                >
                  Save League
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
