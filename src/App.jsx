import React, { useState, useEffect, useMemo } from 'react';
import { mockGames as initialGames, mockH2H as initialH2H, mockLeagues as initialLeagues } from './data/mockSlate';
import { calculatePlayerLeverage, calculatePlayBasePoints } from './utils/leverageEngine';
import ConnectModal from './components/ConnectModal';
import PlayerAvatar from './components/PlayerAvatar';
import { getSleeperPlayerDirectory, buildRootsFromSleeper } from './services/sleeperApi';

export default function App() {
  const [view, setView] = useState('per-game');
  const [filter, setFilter] = useState('all');
  const [sortOrder, setSortOrder] = useState('leverage');
  const [rosterTab, setRosterTab] = useState('starters');
  const [selectedPlayerId, setSelectedPlayerId] = useState('barkley');
  const [drawerPlayer, setDrawerPlayer] = useState(null);
  const [recentFlash, setRecentFlash] = useState(null);
  const [showConnectModal, setShowConnectModal] = useState(false);

  // LocalStorage Persistence
  const [games, setGames] = useState(() => {
    try {
      const saved = localStorage.getItem('rootmap_games');
      return saved ? JSON.parse(saved) : initialGames;
    } catch {
      return initialGames;
    }
  });

  const [h2hData, setH2HData] = useState(() => {
    try {
      const saved = localStorage.getItem('rootmap_h2h');
      return saved ? JSON.parse(saved) : initialH2H;
    } catch {
      return initialH2H;
    }
  });

  const [leagues, setLeagues] = useState(() => {
    try {
      const saved = localStorage.getItem('rootmap_leagues');
      return saved ? JSON.parse(saved) : initialLeagues;
    } catch {
      return initialLeagues;
    }
  });

  const [playerDirectory, setPlayerDirectory] = useState(null);

  // Load Sleeper NFL metadata once on startup
  useEffect(() => {
    async function loadDirectory() {
      try {
        const dir = await getSleeperPlayerDirectory();
        setPlayerDirectory(dir);
      } catch (err) {
        console.warn('Could not load Sleeper player directory:', err);
      }
    }
    loadDirectory();
  }, []);

  // Derive real portfolio roots from connected Sleeper leagues
  const liveRoots = useMemo(() => {
    const sleeperLeaguesWithStarters = leagues.filter(
      lg => lg.platform === 'Sleeper' && lg.starters && lg.starters.length > 0
    );

    if (sleeperLeaguesWithStarters.length > 0 && playerDirectory) {
      return buildRootsFromSleeper(sleeperLeaguesWithStarters, playerDirectory);
    }

    return null;
  }, [leagues, playerDirectory]);

  // Sync to localStorage
  useEffect(() => {
    try {
      localStorage.setItem('rootmap_games', JSON.stringify(games));
      localStorage.setItem('rootmap_h2h', JSON.stringify(h2hData));
      localStorage.setItem('rootmap_leagues', JSON.stringify(leagues));
    } catch (e) {
      console.error('Failed to sync to localStorage', e);
    }
  }, [games, h2hData, leagues]);

  const handleResetSlate = () => {
    if (window.confirm('Reset all simulated points and custom leagues back to default?')) {
      setGames(initialGames);
      setH2HData(initialH2H);
      setLeagues(initialLeagues);
      localStorage.removeItem('rootmap_games');
      localStorage.removeItem('rootmap_h2h');
      localStorage.removeItem('rootmap_leagues');
    }
  };

  const handleAddLeague = (newLeague) => {
    setLeagues(prev => [...prev, newLeague]);
  };

  // Match live starters to game cards, or fall back to mock slate
  const getGamePlayers = (game) => {
    if (!liveRoots || liveRoots.length === 0) {
      return game.players || [];
    }

    const matching = liveRoots.filter(
      p => p.nflTeam === game.away || p.nflTeam === game.home
    );

    return matching.length > 0 ? matching : (game.players || []);
  };

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100 pb-28">
      {/* Top Header */}
      <header className="sticky top-0 z-40 bg-slate-950/90 backdrop-blur-md border-b border-slate-800 px-4 py-3 flex justify-between items-center max-w-md mx-auto">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center font-black text-emerald-400 text-sm">
            RM
          </div>
          <span className="font-black text-lg tracking-tight bg-gradient-to-r from-white via-slate-200 to-slate-400 bg-clip-text text-transparent">
            RootMap
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button 
            onClick={() => setShowConnectModal(true)}
            className="px-2.5 py-1 text-xs font-semibold rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition"
          >
            + Link
          </button>
          <button 
            onClick={handleResetSlate}
            className="px-2 py-1 text-xs font-semibold rounded-lg bg-slate-800/60 hover:bg-slate-800 text-slate-400 border border-slate-800 transition"
          >
            Reset
          </button>
        </div>
      </header>

      {/* Main Views */}
      <main className="max-w-md mx-auto p-4 space-y-3">
        {/* VIEW 1: Per-Game Roots */}
        {view === 'per-game' && (
          <div className="space-y-3">
            {games.map(game => (
              <div key={game.id} className="bg-slate-800/80 rounded-2xl border border-slate-700/80 shadow-md overflow-hidden">
                <div className="bg-slate-950/60 px-3.5 py-2.5 border-b border-slate-700/80 flex justify-between items-center text-xs font-semibold text-slate-400">
                  <span className="font-bold text-slate-300">{game.away} @ {game.home}</span>
                  <span className={game.status?.includes('LIVE') ? 'text-emerald-400 font-bold' : ''}>
                    {game.status} • {game.time}
                  </span>
                </div>
                <div className="divide-y divide-slate-700/50">
                  {getGamePlayers(game).slice().sort((a, b) => {
                    if (sortOrder !== 'leverage') return 0;
                    const levA = Math.abs(calculatePlayerLeverage(a.leagueDetails || a.leagues || []).netMultiplier || 1);
                    const levB = Math.abs(calculatePlayerLeverage(b.leagueDetails || b.leagues || []).netMultiplier || 1);
                    return levB - levA;
                  }).map(player => {
                    const isTarget = player.id === selectedPlayerId;
                    const isFlashing = recentFlash?.id === player.id;
                    const leverage = calculatePlayerLeverage(player.leagueDetails || player.leagues || []);

                    return (
                      <div 
                        key={player.id} 
                        onClick={() => {
                          setSelectedPlayerId(player.id);
                          setDrawerPlayer(player);
                        }}
                        className={`p-3.5 flex items-center justify-between cursor-pointer transition select-none active:scale-[0.99] ${
                          isTarget ? 'bg-slate-700/30' : 'hover:bg-slate-700/20'
                        } ${isFlashing ? 'ring-2 ring-emerald-500 ring-inset bg-emerald-950/20' : ''}`}
                      >
                        <div className="flex items-center gap-2.5">
                          <PlayerAvatar 
                            playerId={player.id} 
                            name={player.name} 
                            position={player.position} 
                            className="w-9 h-9" 
                          />
                          <div>
                            <div className="font-bold text-white text-sm leading-tight">{player.name}</div>
                            <div className="text-[11px] font-semibold text-slate-400">
                              {player.position} • {player.nflTeam || 'NFL'}
                            </div>
                          </div>
                        </div>

                        <div className="text-right">
                          <div className={`text-sm font-black ${
                            (leverage.netMultiplier || 1) >= 0 ? 'text-emerald-400' : 'text-rose-400'
                          }`}>
                            {(leverage.netMultiplier || 1) > 0 ? '+' : ''}{(leverage.netMultiplier || 1).toFixed(1)}x
                          </div>
                          <div className="text-[10px] text-slate-400 font-semibold">
                            {player.shares ? `${player.shares} league shares` : 'High Leverage'}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* VIEW 2: Blended H2H Roots */}
        {view === 'blended' && (
          <div className="space-y-3">
            <div className="bg-slate-800/80 rounded-2xl border border-slate-700/80 p-4">
              <h3 className="font-bold text-white text-sm mb-1">Blended H2H Perspective</h3>
              <p className="text-xs text-slate-400 mb-4">Combined live portfolio equity across all active matchups.</p>
              
              <div className="space-y-3">
                {h2hData.map((match, idx) => (
                  <div key={idx} className="bg-slate-900/60 rounded-xl p-3 border border-slate-800 flex justify-between items-center text-xs">
                    <div>
                      <div className="font-bold text-slate-200">{match.leagueName || `League ${idx + 1}`}</div>
                      <div className="text-slate-400">vs {match.opponent || 'Opponent'}</div>
                    </div>
                    <div className="text-right">
                      <div className="font-black text-emerald-400 text-sm">{match.myScore || '0.0'} pts</div>
                      <div className="text-[10px] text-slate-500">Opp: {match.oppScore || '0.0'}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* VIEW 3: All Leagues */}
        {view === 'all-leagues' && (
          <div className="space-y-3">
            <div className="flex justify-between items-center mb-2">
              <h2 className="text-sm font-bold text-slate-300 uppercase tracking-wider">Connected Leagues ({leagues.length})</h2>
              <button
                onClick={() => setShowConnectModal(true)}
                className="px-3 py-1.5 bg-emerald-500 hover:bg-emerald-600 text-slate-950 font-bold rounded-lg text-xs transition"
              >
                + Link Platform
              </button>
            </div>

            {leagues.map((lg) => (
              <div key={lg.id} className="bg-slate-800/80 rounded-2xl border border-slate-700/80 p-3.5 space-y-2">
                <div className="flex justify-between items-center">
                  <div className="font-bold text-white text-sm">{lg.name}</div>
                  <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-full bg-slate-700/60 text-slate-300">
                    {lg.platform}
                  </span>
                </div>
                <div className="flex justify-between text-xs text-slate-400">
                  <span>Matchup vs {lg.opponentName || 'Opponent'}</span>
                  <span className="font-bold text-slate-200">{lg.userPoints || 0} - {lg.oppPoints || 0}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>

      {/* Sticky Bottom Navigation */}
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

      {/* Connect Platform Modal */}
      <ConnectModal
        isOpen={showConnectModal}
        onClose={() => setShowConnectModal(false)}
        onAddLeague={handleAddLeague}
      />

      {/* Slide-Up Detail Drawer */}
      {drawerPlayer && (
        <div
          onClick={() => setDrawerPlayer(null)}
          className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-end justify-center"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="bg-slate-900 border-t sm:border border-slate-700/80 rounded-t-3xl sm:rounded-3xl p-5 max-w-md w-full space-y-4 shadow-2xl animate-in slide-in-from-bottom-6 duration-200"
          >
            <div className="w-12 h-1.5 bg-slate-700 rounded-full mx-auto" />
            <div className="flex justify-between items-start border-b border-slate-800 pb-3">
              <div className="flex items-center gap-3">
                <PlayerAvatar 
                  playerId={drawerPlayer.id} 
                  name={drawerPlayer.name} 
                  position={drawerPlayer.position} 
                  className="w-12 h-12" 
                />
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