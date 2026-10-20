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
  const [rawDebugLog, setRawDebugLog] = useState(null);

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

  // Capture Yahoo Token and Execute Raw Diagnostic
  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      const yahooToken = params.get('yahoo_token');

      if (yahooToken) {
        window.history.replaceState({}, document.title, window.location.pathname);
        setSyncStatus('Fetching raw diagnostic payload from Yahoo...');

        async function inspectYahooPayload() {
          try {
            const res = await fetch('/api/yahoo/rosters', {
              headers: { Authorization: `Bearer ${yahooToken}` }
            });
            const data = await res.json();

            // Dump raw string directly to developer console
            console.log('=== YAHOO RAW PAYLOAD START ===');
            console.log('HTTP Status:', data.httpStatus);
            console.log('Content-Type:', data.contentType);
            console.log('Payload Length:', data.rawLength);
            console.log('Raw Body:', data.rawPayload);
            console.log('=== YAHOO RAW PAYLOAD END ===');

            setRawDebugLog(data);
            setSyncStatus('Payload captured! View below.');
          } catch (e) {
            console.error('Diagnostic call failed:', e);
            alert('Failed to execute diagnostic endpoint: ' + e.message);
            setSyncStatus('Diagnostic error');
          }
        }
        inspectYahooPayload();
      }
    } catch (e) {}
  }, []);

  const handleResetSlate = () => {
    try {
      localStorage.removeItem('rootmap_leagues');
    } catch (e) {}
    setLeagues([]);
    setRawDebugLog(null);
    alert('Cleared state.');
  };

  const getGamePlayers = (game) => {
    return Array.isArray(game?.players) ? game.players : [];
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
        {/* Raw Payload Diagnostic Modal / Card */}
        {rawDebugLog && (
          <div className="bg-slate-950 border-2 border-emerald-500/60 rounded-2xl p-4 space-y-3 shadow-2xl">
            <div className="flex justify-between items-center border-b border-slate-800 pb-2">
              <div>
                <h3 className="text-xs font-black text-emerald-400 uppercase tracking-wider">
                  Raw Yahoo Response Dump
                </h3>
                <div className="text-[10px] font-mono text-slate-400">
                  Status: {rawDebugLog.httpStatus} | Length: {rawDebugLog.rawLength} chars
                </div>
              </div>
              <button
                onClick={() => setRawDebugLog(null)}
                className="w-6 h-6 rounded-full bg-slate-800 text-slate-300 flex items-center justify-center text-xs font-bold"
              >
                ✕
              </button>
            </div>
            <textarea
              readOnly
              value={rawDebugLog.rawPayload || 'Empty response body received.'}
              className="w-full h-56 bg-slate-900 border border-slate-700 rounded-xl p-2.5 font-mono text-[11px] text-emerald-300 focus:outline-none select-all"
            />
            <div className="text-[10px] text-slate-400">
              Payload also logged to Console (<span className="font-mono text-slate-300">Ctrl + Shift + J</span>).
            </div>
          </div>
        )}

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

            <div className="bg-slate-800/40 rounded-2xl border border-dashed border-slate-700 p-6 text-center space-y-3">
              <div className="text-3xl">📡</div>
              <div className="text-slate-200 text-sm font-bold">Diagnostic Capture Ready</div>
              <p className="text-slate-400 text-xs max-w-xs mx-auto">
                Tap the button below to authorize Yahoo. The exact raw response will output directly on this screen.
              </p>
              <button
                onClick={() => setShowConnectModal(true)}
                className="w-full py-2.5 bg-purple-600 hover:bg-purple-500 text-white font-bold rounded-xl text-xs transition shadow-lg shadow-purple-600/20"
              >
                🟣 Run Yahoo Diagnostic Auth
              </button>
            </div>
          </div>
        )}

        {view === 'per-game' && (
          <div className="space-y-3">
            {(games || []).map(game => (
              <div key={game.id} className="bg-slate-800/80 rounded-2xl border border-slate-700/80 p-3 text-xs">
                <div className="font-bold text-slate-200">{game.away} @ {game.home}</div>
                <div className="text-slate-400">{game.status} • {game.time}</div>
              </div>
            ))}
          </div>
        )}

        {view === 'blended' && (
          <div className="bg-slate-800/80 rounded-2xl border border-slate-700/80 p-4">
            <h3 className="font-bold text-white text-sm mb-1">Blended H2H Perspective</h3>
            <p className="text-xs text-slate-400">Matchups will populate once leagues are normalized.</p>
          </div>
        )}
      </main>

      {/* Navigation */}
      <nav className="fixed bottom-0 left-0 right-0 z-40 bg-slate-950/95 backdrop-blur-lg border-t border-slate-800 max-w-md mx-auto">
        <div className="grid grid-cols-3 py-2 px-3 gap-1">
          <button
            onClick={() => setView('per-game')}
            className={`py-2 flex flex-col items-center justify-center rounded-xl text-xs font-bold transition ${
              view === 'per-game' ? 'bg-slate-800 text-emerald-400' : 'text-slate-400'
            }`}
          >
            <span>🎮 Game Slate</span>
          </button>
          <button
            onClick={() => setView('blended')}
            className={`py-2 flex flex-col items-center justify-center rounded-xl text-xs font-bold transition ${
              view === 'blended' ? 'bg-slate-800 text-emerald-400' : 'text-slate-400'
            }`}
          >
            <span>⚖️ Blended H2H</span>
          </button>
          <button
            onClick={() => setView('all-leagues')}
            className={`py-2 flex flex-col items-center justify-center rounded-xl text-xs font-bold transition ${
              view === 'all-leagues' ? 'bg-slate-800 text-emerald-400' : 'text-slate-400'
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
    </div>
  );
}
