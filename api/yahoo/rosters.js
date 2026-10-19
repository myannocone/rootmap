import React, { useState, useEffect, useMemo } from 'react';
import { mockGames as initialGames, mockH2H as initialH2H, mockLeagues as initialLeagues } from './data/mockSlate';
import { calculatePlayerLeverage } from './utils/leverageEngine';
import ConnectModal from './components/ConnectModal';
import PlayerAvatar from './components/PlayerAvatar';
import { getSleeperPlayerDirectory, buildRootsFromSleeper } from './services/sleeperApi';
import { fetchLiveNFLSlate } from './services/espnScoreboard';

export default function App() {
  const [view, setView] = useState('per-game');
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
      return (Array.isArray(parsed) && parsed.length > 0) ? parsed : (initialLeagues || []);
    } catch {
      return initialLeagues || [];
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

  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      const yahooToken = params.get('yahoo_token');

      if (yahooToken) {
        window.history.replaceState({}, document.title, window.location.pathname);
        setSyncStatus('Importing Yahoo leagues...');

        async function syncYahoo() {
          try {
            const res = await fetch('/api/yahoo/rosters', {
              headers: {
                Authorization: `Bearer ${yahooToken}`
              }
            });
            if (!res.ok) {
              setSyncStatus('Failed to import leagues from Yahoo.');
              return;
            }
            const data = await res.json();
            if (Array.isArray(data?.leagues) && data.leagues.length > 0) {
              setLeagues(data.leagues);
              localStorage.setItem('rootmap_leagues', JSON.stringify(data.leagues));
              setSyncStatus(`Imported ${data.leagues.length} Yahoo League(s)`);
              setTimeout(() => setSyncStatus(''), 4000);
            } else {
              setSyncStatus('No active leagues found in Yahoo account.');
              setTimeout(() => setSyncStatus(''), 4000);
            }
          } catch (syncErr) {
            console.warn('Yahoo background sync failed:', syncErr);
            setSyncStatus('Error syncing Yahoo rosters.');
            setTimeout(() => setSyncStatus(''), 4000);
          }
        }
        syncYahoo();
      }
    } catch (e) {
      console.warn('URL parameter parsing failed:', e);
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
    setSyncStatus('Cache cleared. Relink to import.');
    setTimeout(() => setSyncStatus(''), 3000);
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
              <span className="text-[10px] font-semibold text-emerald-400 block animate-pulse">
                {syncStatus}
              </span>
            )}
          </div>
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
            className="px-2 py-1 text-xs font-semibold rounded-lg bg-rose-950/40 hover:bg-rose-900/60 text-rose-300 border border-rose-800/60 transition"
          >
            Clear / Sync
          </button>
        </div>
      </header>

      {/* Main Views */}
      <main className="max-w-md mx-auto p-4 space-y-3">
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
                      players.slice().sort((a, b) => {
                        if (sortOrder !== 'leverage' || !calculatePlayerLeverage) return 0;
                        const levA = Math.abs(calculatePlayerLeverage(a.leagueDetails || a.leagues || []).netMultiplier || 1);
                        const levB = Math.abs(calculatePlayerLeverage(b.leagueDetails || b.leagues || []).netMultiplier || 1);
                        return levB - levA;
                      }).map(player => {
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
                            className={`p-3.5 flex items-center justify-between cursor-pointer transition select-none active:scale-[0.99] ${
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

        {view === 'all-leagues' && (
          <div className="space-y-3">
            <div className="flex justify-between items-center mb-2">
              <h2 className="text-sm font-bold text-slate-300 uppercase tracking-wider">Connected Leagues ({leagues.length})</h2>
              <button
                onClick={() => setShowConnectModal(true)}
@'
export default async function handler(req, res) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.statusCode = 401;
    res.setHeader('Content-Type', 'application/json');
    return res.end(JSON.stringify({ error: 'Missing or malformed Authorization token' }));
  }

  const token = authHeader.split(' ')[1];

  try {
    const leaguesUrl = 'https://fantasysports.yahooapis.com/fantasy/v2/users;use_login=1/games;game_keys=nfl/leagues?format=json';
    const leaguesRes = await fetch(leaguesUrl, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/json'
      }
    });

    if (!leaguesRes.ok) {
      const errBody = await leaguesRes.text();
      res.statusCode = leaguesRes.status;
      res.setHeader('Content-Type', 'application/json');
      return res.end(JSON.stringify({ error: 'Failed to fetch Yahoo leagues', details: errBody }));
    }

    const data = await leaguesRes.json();
    const leaguesList = [];

    // Helper to recursively locate any object with league_key
    function findLeagues(obj) {
      if (!obj || typeof obj !== 'object') return;
      if (obj.league_key && obj.name) {
        leaguesList.push({
          id: String(obj.league_key),
          name: String(obj.name),
          season: obj.season ? String(obj.season) : '2026',
          numTeams: obj.num_teams || 12,
          platform: 'Yahoo',
          starters: []
        });
        return;
      }
      for (const key of Object.keys(obj)) {
        findLeagues(obj[key]);
      }
    }

    findLeagues(data);

    // Deduplicate by league id
    const uniqueMap = new Map();
    for (const lg of leaguesList) {
      if (!uniqueMap.has(lg.id)) {
        uniqueMap.set(lg.id, lg);
      }
    }

    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json');
    return res.end(JSON.stringify({ leagues: Array.from(uniqueMap.values()) }));
  } catch (err) {
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json');
    return res.end(JSON.stringify({ error: 'Internal Server Error', message: err.message }));
  }
}
