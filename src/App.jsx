import React, { useState, useEffect, useMemo } from 'react';
import { mockGames as initialGames, mockH2H as initialH2H } from './data/mockSlate';
import { calculatePlayerLeverage } from './utils/leverageEngine';
import ConnectModal from './components/ConnectModal';
import PlayerAvatar from './components/PlayerAvatar';
import { getSleeperPlayerDirectory, buildRootsFromSleeper } from './services/sleeperApi';
import { fetchLiveNFLSlate } from './services/espnScoreboard';

export default function App() {
  const [view, setView] = useState('all-leagues');
  const [sortOrder, setSortOrder] = useState('leverage');
  const [selectedPlayerId, setSelectedPlayerId] = useState(null);
  const [drawerPlayer, setDrawerPlayer] = useState(null);
  const [activeLeagueDrawer, setActiveLeagueDrawer] = useState(null);
  const [showConnectModal, setShowConnectModal] = useState(false);
  const [syncStatus, setSyncStatus] = useState('');

  const defaultH2H = [
    { id: 'lg_1', leagueName: 'Main League H2H', opponent: 'Cisco/Bloom', myScore: 112.4, oppScore: 104.8 },
    { id: 'lg_2', leagueName: 'Yannocone vs Gelardi', opponent: 'Gelardi', myScore: 98.6, oppScore: 92.1 },
    { id: 'lg_3', leagueName: 'High Stakes Dynasty', opponent: 'Stern/Bloom', myScore: 84.2, oppScore: 101.5 }
  ];

  const [games, setGames] = useState(() => {
    try {
      const saved = localStorage.getItem('rootmap_games');
      const parsed = saved ? JSON.parse(saved) : null;
      return (Array.isArray(parsed) && parsed.length > 0) ? parsed : (initialGames || []);
    } catch {
      return initialGames || [];
    }
  });

  const [h2hData, setH2HData] = useState(() => {
    try {
      const saved = localStorage.getItem('rootmap_h2h');
      const parsed = saved ? JSON.parse(saved) : null;
      return (Array.isArray(parsed) && parsed.length > 0) ? parsed : defaultH2H;
    } catch {
      return defaultH2H;
    }
  });

  const [leagues, setLeagues] = useState(() => {
    try {
      const saved = localStorage.getItem('rootmap_leagues');
      const parsed = saved ? JSON.parse(saved) : null;
      return (Array.isArray(parsed) && parsed.length > 0) ? parsed : [];
    } catch {
      return [];
    }
  });

  const [playerDirectory, setPlayerDirectory] = useState(null);

  const refreshLiveSlate = async () => {
    try {
      const liveGames = await fetchLiveNFLSlate();
      if (Array.isArray(liveGames) && liveGames.length > 0) {
        setGames(liveGames);
        try {
          localStorage.setItem('rootmap_games', JSON.stringify(liveGames));
        } catch (e) {}
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

  useEffect(() => {
    async function loadDirectory() {
      try {
        if (typeof getSleeperPlayerDirectory === 'function') {
          const dir = await getSleeperPlayerDirectory();
          setPlayerDirectory(dir);
        }
      } catch (err) {}
    }
    loadDirectory();
  }, []);

  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      const yahooToken = params.get('yahoo_token');

      if (yahooToken) {
        window.history.replaceState({}, document.title, window.location.pathname);
        setSyncStatus('Importing Yahoo rosters...');

        async function syncYahoo() {
          try {
            const res = await fetch('/api/yahoo/rosters', {
              headers: { Authorization: `Bearer ${yahooToken}` }
            });
            const data = await res.json();

            if (Array.isArray(data?.leagues) && data.leagues.length > 0) {
              setLeagues(data.leagues);
              localStorage.setItem('rootmap_leagues', JSON.stringify(data.leagues));
              alert(`Imported ${data.leagues.length} Yahoo League(s) with rosters!`);
              setSyncStatus(`Connected: ${data.leagues.length} leagues`);
            }
          } catch (e) {
            setSyncStatus('Sync error');
          }
        }
        syncYahoo();
      }
    } catch (e) {}
  }, []);

  // Map Yahoo Starters into Live Slate Matches
  const liveRoots = useMemo(() => {
    const list = [];
    for (const lg of leagues) {
      for (const st of (lg.starters || [])) {
        list.push({
          id: `${lg.id}_${st.name}`,
          name: st.name,
          position: st.position,
          nflTeam: st.nflTeam,
          shares: 1,
          leagues: [{ leagueName: lg.name, type: 'ROSTERED' }]
        });
      }
    }
    return list.length > 0 ? list : null;
  }, [leagues]);

  useEffect(() => {
    try {
      localStorage.setItem('rootmap_h2h', JSON.stringify(h2hData));
      localStorage.setItem('rootmap_leagues', JSON.stringify(leagues));
    } catch (e) {}
  }, [h2hData, leagues]);

  const handleResetSlate = () => {
    try {
      localStorage.removeItem('rootmap_leagues');
    } catch (e) {}
    setLeagues([]);
    alert('Cleared leagues.');
  };

  const getGamePlayers = (game) => {
    if (!game) return [];
    if (!liveRoots || liveRoots.length === 0) {
      return Array.isArray(game.players) ? game.players : [];
    }
    const matching = liveRoots.filter(p => p && (p.nflTeam === game.away || p.nflTeam === game.home));
    return matching.length > 0 ? matching : (Array.isArray(game.players) ? game.players : []);
  };

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100 pb-28">
      {/* Header */}
      <header className="sticky top-0 z-40 bg-slate-950/90 backdrop-blur-md border-b border-slate-800 px-4 py-3 flex justify-between items-center max-w-md mx-auto">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center font-black text-emerald-400 text-sm">
            RM
          </div>
          <div>
            <span className="font-black text-lg tracking-tight bg-gradient-to-r from-white via-slate-200 to-slate-400 bg-clip-text text-transparent block">
              RootMap
            </span>
            {syncStatus && (
              <span className="text-[10px] font-semibold text-emerald-400 block">
                {syncStatus}
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button 
            onClick={() => setShowConnectModal(true)}
            className="px-2.5 py-1 text-xs font-semibold rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white transition"
          >
            + Link
          </button>
          <button 
            onClick={handleResetSlate}
            className="px-2 py-1 text-xs font-semibold rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 transition"
          >
            Reset
          </button>
        </div>
      </header>

      {/* Main Views */}
      <main className="max-w-md mx-auto p-4 space-y-3">
        {view === 'all-leagues' && (
          <div className="space-y-3">
            <div className="flex justify-between items-center mb-2">
              <h2 className="text-sm font-bold text-slate-300 uppercase tracking-wider">
                Connected Leagues ({leagues.length})
              </h2>
              <button
                onClick={() => setShowConnectModal(true)}
                className="px-3 py-1.5 bg-emerald-500 hover:bg-emerald-600 text-slate-950 font-bold rounded-lg text-xs transition"
              >
                + Add / Link
              </button>
            </div>

            {leagues.length === 0 ? (
              <div className="bg-slate-800/40 rounded-2xl border border-dashed border-slate-700 p-6 text-center space-y-3">
                <div className="text-3xl">🏈</div>
                <div className="text-slate-300 text-sm font-bold">No Leagues Connected</div>
                <button
                  onClick={() => setShowConnectModal(true)}
                  className="w-full py-2 bg-purple-600 hover:bg-purple-500 text-white font-bold rounded-xl text-xs transition"
                >
                  🟣 Re-Sync with Yahoo
                </button>
              </div>
            ) : (
              leagues.map((lg, idx) => (
                <div 
                  key={lg.id || idx} 
                  onClick={() => setActiveLeagueDrawer(lg)}
                  className="bg-slate-800/80 hover:bg-slate-700/60 active:scale-[0.99] cursor-pointer rounded-2xl border border-slate-700/80 p-4 space-y-2 transition shadow-md"
                >
                  <div className="flex justify-between items-center">
                    <div>
                      <div className="font-black text-white text-sm">{lg.name}</div>
                      <div className="text-[11px] text-slate-400 font-semibold">Tap to view roster →</div>
                    </div>
                    <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-full bg-purple-900/60 text-purple-300 border border-purple-700">
                      {lg.platform || 'Yahoo'}
                    </span>
                  </div>
                  <div className="flex justify-between text-xs text-slate-400 pt-1 border-t border-slate-700/40">
                    <span>{lg.starters ? `${lg.starters.length} Players Synced` : '12 Teams'}</span>
                    <span className="font-bold text-emerald-400">Active</span>
                  </div>
                </div>
              ))
            )}
          </div>
        )}

        {view === 'per-game' && (
          <div className="space-y-3">
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
                            key={player.id} 
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
                                +1.0x
                              </div>
                              <div className="text-[10px] text-slate-400 font-semibold">
                                Rostered
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
            <div className="bg-slate-800/80 rounded-2xl border border-slate-700/80 p-4">
              <h3 className="font-bold text-white text-sm mb-1">Blended H2H Perspective</h3>
              <p className="text-xs text-slate-400 mb-4">Combined live portfolio equity across all active matchups.</p>
              
              <div className="space-y-3">
                {((h2hData && h2hData.length > 0) ? h2hData : defaultH2H).map((match, idx) => {
                  const myScore = parseFloat(match.myScore ?? match.userPoints ?? 0) || 0;
                  const oppScore = parseFloat(match.oppScore ?? match.opponentScore ?? match.oppPoints ?? 0) || 0;
                  const diff = myScore - oppScore;
                  const isWinning = diff >= 0;

                  return (
                    <div key={match.id || idx} className="bg-slate-900/60 rounded-xl p-3 border border-slate-800 flex justify-between items-center text-xs">
                      <div>
                        <div className="font-bold text-slate-200">{match.leagueName || `League ${idx + 1}`}</div>
                        <div className="text-slate-400">vs {match.opponent || 'Opponent'}</div>
                      </div>
                      <div className="text-right">
                        <div className="font-black text-emerald-400 text-sm">
                          {myScore.toFixed(2)} pts
                        </div>
                        <div className="text-[10px] text-slate-400">
                          Opp: {oppScore.toFixed(2)} 
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

      {/* Navigation */}
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

      {showConnectModal && ConnectModal && (
        <ConnectModal
          isOpen={showConnectModal}
          onClose={() => setShowConnectModal(false)}
          onAddLeague={(lg) => setLeagues(prev => [...prev, lg])}
        />
      )}

      {/* Roster Drilldown Drawer */}
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
                <div className="text-xs text-purple-400 font-semibold">Yahoo Fantasy Roster</div>
              </div>
              <button
                onClick={() => setActiveLeagueDrawer(null)}
                className="w-7 h-7 rounded-full bg-slate-800 text-slate-400 flex items-center justify-center font-bold text-xs"
              >
                ✕
              </button>
            </div>

            <div className="overflow-y-auto space-y-2 py-3">
              {(!activeLeagueDrawer.starters || activeLeagueDrawer.starters.length === 0) ? (
                <div className="text-center text-xs text-slate-400 py-6">
                  No rostered players parsed yet. Tap Re-Sync in the header.
                </div>
              ) : (
                activeLeagueDrawer.starters.map((p, idx) => (
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
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* Player Detail Drawer */}
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
                    ROSTERED
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
