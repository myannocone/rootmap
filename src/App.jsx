import React, { useState, useEffect, useMemo } from 'react';
import { mockGames as initialGames, mockH2H as initialH2H, mockLeagues as initialLeagues } from './data/mockSlate';
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
  const [showConnectModal, setShowConnectModal] = useState(false);
  const [syncStatus, setSyncStatus] = useState('');

  const defaultH2H = [
    { id: 'lg_1', leagueName: 'Yannocone vs Gelardi', opponent: 'Gelardi', myScore: 112.4, oppScore: 104.8 },
    { id: 'lg_2', leagueName: 'Main League H2H', opponent: 'Cisco/Bloom', myScore: 98.6, oppScore: 92.1 },
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
      } catch (err) {
        console.warn('Player directory load warning:', err);
      }
    }
    loadDirectory();
  }, []);

  // Process Yahoo OAuth Return
  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      const yahooToken = params.get('yahoo_token');
      const authError = params.get('auth_error');

      if (authError) {
        alert('Yahoo Authentication Error: ' + authError);
        window.history.replaceState({}, document.title, window.location.pathname);
        return;
      }

      if (yahooToken) {
        window.history.replaceState({}, document.title, window.location.pathname);
        setSyncStatus('Connecting to Yahoo Fantasy API...');

        async function syncYahoo() {
          try {
            const res = await fetch('/api/yahoo/rosters', {
              headers: {
                Authorization: `Bearer ${yahooToken}`
              }
            });
            
            const data = await res.json();

            if (!res.ok) {
              alert('Yahoo Sync Error: ' + (data?.error || res.statusText));
              setSyncStatus('Sync failed.');
              return;
            }

            if (Array.isArray(data?.leagues) && data.leagues.length > 0) {
              setLeagues(data.leagues);
              localStorage.setItem('rootmap_leagues', JSON.stringify(data.leagues));
              setView('all-leagues');
              alert(`Success! Imported ${data.leagues.length} Yahoo League(s).`);
              setSyncStatus(`Connected: ${data.leagues.length} leagues`);
            } else {
              alert('Yahoo authorized successfully, but no active fantasy football leagues were returned for this account.');
              setSyncStatus('0 leagues found.');
            }
          } catch (syncErr) {
            console.error('Yahoo background sync failed:', syncErr);
            alert('Failed to connect to /api/yahoo/rosters endpoint.');
            setSyncStatus('Network error.');
          }
        }
        syncYahoo();
      }
    } catch (e) {
      console.warn('URL parsing error:', e);
    }
  }, []);

  const liveRoots = useMemo(() => {
    try {
      const active = (leagues || []).filter(
        lg => lg && Array.isArray(lg.starters) && lg.starters.length > 0
      );
      if (active.length > 0 && playerDirectory && typeof buildRootsFromSleeper === 'function') {
        return buildRootsFromSleeper(active, playerDirectory) || [];
      }
    } catch (e) {
      console.warn('Error calculating live roots:', e);
    }
    return null;
  }, [leagues, playerDirectory]);

  useEffect(() => {
    try {
      localStorage.setItem('rootmap_h2h', JSON.stringify(h2hData));
      localStorage.setItem('rootmap_leagues', JSON.stringify(leagues));
    } catch (e) {}
  }, [h2hData, leagues]);

  const handleResetSlate = async () => {
    try {
      localStorage.removeItem('rootmap_games');
      localStorage.removeItem('rootmap_h2h');
      localStorage.removeItem('rootmap_leagues');
    } catch (e) {}
    setH2HData(defaultH2H);
    setLeagues([]);
    await refreshLiveSlate();
    alert('Cleared cached storage.');
  };

  const handleAddLeague = (newLeague) => {
    if (newLeague) {
      setLeagues(prev => [...prev, newLeague]);
    }
  };

  const getGamePlayers = (game) => {
    if (!game) return [];
    if (!liveRoots || liveRoots.length === 0) {
      return Array.isArray(game.players) ? game.players : [];
    }
    const matching = liveRoots.filter(
      p => p && (p.nflTeam === game.away || p.nflTeam === game.home)
    );
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
                + Link Platform
              </button>
            </div>

            {leagues.length === 0 ? (
              <div className="bg-slate-800/40 rounded-2xl border border-dashed border-slate-700 p-8 text-center space-y-3">
                <div className="text-3xl">🏈</div>
                <div className="text-slate-300 text-sm font-bold">No Leagues Connected Yet</div>
                <p className="text-slate-500 text-xs max-w-xs mx-auto">
                  Tap "+ Link Platform" above and sign in with Yahoo to automatically import your active teams.
                </p>
                <button
                  onClick={() => setShowConnectModal(true)}
                  className="px-4 py-2 bg-purple-600 hover:bg-purple-500 text-white font-bold rounded-xl text-xs transition inline-block shadow-lg shadow-purple-600/20"
                >
                  Connect Yahoo Sports
                </button>
              </div>
            ) : (
              leagues.map((lg, idx) => (
                <div key={lg.id || idx} className="bg-slate-800/80 rounded-2xl border border-slate-700/80 p-4 space-y-2">
                  <div className="flex justify-between items-center">
                    <div className="font-bold text-white text-sm">{lg.name || `League ${idx + 1}`}</div>
                    <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-full bg-purple-900/60 text-purple-300 border border-purple-700">
                      {lg.platform || 'Yahoo'}
                    </span>
                  </div>
                  <div className="flex justify-between text-xs text-slate-400">
                    <span>{lg.numTeams ? `${lg.numTeams} Teams` : 'Active League'}</span>
                    <span className="font-mono text-slate-300">{lg.season || '2026'}</span>
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
                        const leverage = calculatePlayerLeverage ? calculatePlayerLeverage(player.leagueDetails || player.leagues || []) : { netMultiplier: 1 };
                        const netMult = leverage.netMultiplier ?? 1;

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
                              <div className={`text-sm font-black ${
                                netMult >= 0 ? 'text-emerald-400' : 'text-rose-400'
                              }`}>
                                {netMult > 0 ? '+' : ''}{Number(netMult).toFixed(1)}x
                              </div>
                              <div className="text-[10px] text-slate-400 font-semibold">
                                {player.shares ? `${player.shares} league shares` : 'High Leverage'}
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
                        <div className="text-slate-400">vs {match.opponent || match.opponentName || 'Opponent'}</div>
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
          onAddLeague={handleAddLeague}
        />
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
              <div className="flex items-center gap-3">
                {PlayerAvatar && (
                  <PlayerAvatar 
                    playerId={drawerPlayer.id} 
                    name={drawerPlayer.name} 
                    position={drawerPlayer.position} 
                    className="w-12 h-12" 
                  />
                )}
                <div>
                  <h3 className="text-lg font-black text-white">{drawerPlayer.name}</h3>
                  <div className="text-xs text-slate-400 font-semibold">
                    {drawerPlayer.position} • {drawerPlayer.nflTeam || 'NFL'}
                  </div>
                </div>
              </div>
              <button
                onClick={() => setDrawerPlayer(null)}
                className="w-8 h-8 rounded-full bg-slate-800 hover:bg-slate-700 text-slate-400 flex items-center justify-center font-bold text-sm"
              >
                ✕
              </button>
            </div>

            <div className="space-y-2">
              <div className="text-xs font-bold text-slate-400 uppercase tracking-wider">Portfolio Involvement</div>
              {(drawerPlayer.leagueDetails || drawerPlayer.leagues || []).map((detail, idx) => (
                <div key={idx} className="bg-slate-800/60 rounded-xl p-2.5 flex justify-between items-center text-xs border border-slate-700/40">
                  <span className="font-semibold text-slate-200">{detail.leagueName || `League ${idx + 1}`}</span>
                  <span className={`px-2 py-0.5 rounded text-[10px] font-black uppercase tracking-wider ${
                    detail.type === 'ROSTERED' ? 'bg-emerald-950 text-emerald-400 border border-emerald-800' : 'bg-rose-950 text-rose-400 border border-rose-800'
                  }`}>
                    {detail.type || 'Rostered'}
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
