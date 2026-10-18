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

  const [h2hData, setH2hData] = useState(() => {
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
  const liveRoots = useMemo(() => {
    const sleeperLeaguesWithStarters = leagues.filter(
      lg => lg.platform === 'Sleeper' && lg.starters && lg.starters.length > 0
    );

    if (sleeperLeaguesWithStarters.length > 0 && playerDirectory) {
      return buildRootsFromSleeper(sleeperLeaguesWithStarters, playerDirectory);
    }

    return null;
  }, [leagues, playerDirectory]);
  
      {/* Main Views */}
      <main className="max-w-md mx-auto p-4 space-y-3">
        {/* VIEW 1: Per-Game Roots */}
        {view === 'per-game' && (
          <div className="space-y-3">
            {games.map(game => (
              <div key={game.id} className="bg-slate-800/80 rounded-2xl border border-slate-700/80 shadow-md overflow-hidden">
                <div className="bg-slate-950/60 px-3.5 py-2.5 border-b border-slate-700/80 flex justify-between items-center text-xs font-semibold text-slate-400">
                  <span className="font-bold text-slate-300">{game.away} @ {game.home}</span>
                  <span className={game.status.includes('LIVE') ? 'text-emerald-400 font-bold' : ''}>
                    {game.status} • {game.time}
                  </span>
                </div>
                <div className="divide-y divide-slate-700/50">
                {game.players.slice().sort((a, b) => {
                    if (sortOrder !== 'leverage') return 0;
                    const levA = Math.abs(calculatePlayerLeverage(a.leagueDetails || []).netMultiplier);
                    const levB = Math.abs(calculatePlayerLeverage(b.leagueDetails || []).netMultiplier);
                    return levB - levA;
                  }).map(player => {
                    const isTarget = player.id === selectedPlayerId;
                    const isFlashing = recentFlash?.id === player.id;
                    const leverage = calculatePlayerLeverage(player.leagueDetails || []);

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
                        <div>
                        <div className="flex items-center gap-2.5">

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
      localStorage.removeItem('rootmap_games');
      localStorage.removeItem('rootmap_h2h');
      localStorage.removeItem('rootmap_leagues');
      setGames(initialGames);
      setH2hData(initialH2H);
      setLeagues(initialLeagues);
    }
  };

  const handleSimulatePlay = (eventType, label) => {
    const basePts = calculatePlayBasePoints(eventType);
    const activeObj = games.flatMap(g => g.players).find(p => p.id === selectedPlayerId);
    const leverage = calculatePlayerLeverage(activeObj?.leagueDetails || []);
    const portfolioDelta = +(basePts * leverage.netMultiplier).toFixed(1);

    setGames(prevGames =>
      prevGames.map(game => ({
        ...game,
        players: game.players.map(p => {
          if (p.id === selectedPlayerId) {
            return { ...p, pts: Math.max(0, +(p.pts + basePts).toFixed(1)) };
          }
          return p;
        })
      }))
    );

    setH2hData(prev => ({
      myRoster: prev.myRoster.map(p => 
        p.id === selectedPlayerId ? { ...p, pts: Math.max(0, +(p.pts + basePts).toFixed(1)) } : p
      ),
      opponents: prev.opponents.map(p => 
        p.id === selectedPlayerId ? { ...p, pts: Math.max(0, +(p.pts + basePts).toFixed(1)) } : p
      )
    }));

    setLeagues(prevLeagues =>
      prevLeagues.map(lg => {
        const matchDetail = activeObj?.leagueDetails?.find(d => d.name === lg.name);
        if (matchDetail?.status === 'STARTER') {
          return { ...lg, myScore: +(lg.myScore + basePts).toFixed(1) };
        } else if (matchDetail?.status === 'OPPONENT') {
          return { ...lg, oppScore: +(lg.oppScore + basePts).toFixed(1) };
        }
        return lg;
      })
    );

    setRecentFlash({ 
      id: selectedPlayerId, 
      label, 
      basePts, 
      portfolioDelta,
      multiplier: leverage.netMultiplier 
    });
    setTimeout(() => setRecentFlash(null), 2400);
  };

  const handleAddLeague = (newLeague) => {
    setLeagues(prev => [newLeague, ...prev]);
  };

  const linearPlayers = games.flatMap(g => g.players);
  const allSelectable = [
    ...linearPlayers,
    ...h2hData.opponents.filter(o => !linearPlayers.some(lp => lp.id === o.id)).map(o => ({
      id: o.id,
      name: o.name,
      team: 'OPP',
      pos: o.pos,
      pts: o.pts,
      leagueDetails: o.leagueDetails || []
    }))
  ];
  const activePlayer = allSelectable.find(p => p.id === selectedPlayerId) || allSelectable[0];
  const activeLeverage = calculatePlayerLeverage(activePlayer?.leagueDetails || []);

  const totalMyPts = h2hData.myRoster.reduce((sum, p) => sum + p.pts, 0).toFixed(1);
  const totalMyProj = h2hData.myRoster.reduce((sum, p) => sum + p.proj, 0).toFixed(1);
  const totalOppPts = h2hData.opponents.reduce((sum, p) => sum + p.pts, 0).toFixed(1);
  const totalOppProj = h2hData.opponents.reduce((sum, p) => sum + p.proj, 0).toFixed(1);
  const netMargin = (totalMyPts - totalOppPts).toFixed(1);

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100 pb-32 font-sans antialiased selection:bg-emerald-500 selection:text-white">
      {/* Header */}
      {/* Header */}
      <header className="sticky top-0 z-30 bg-slate-950/90 backdrop-blur border-b border-slate-800 px-4 py-3 shadow-md flex items-center justify-between">
        <div>
          <h1 className="text-xl font-black tracking-tight text-white flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse"></span>
            ROOTMAP
          </h1>
          <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
            {view === 'per-game' ? 'Per-Game Roots' : view === 'combined' ? 'Blended H2H Roots' : 'Linked League Matchups'}
          </p>
        </div>
        <div className="flex items-center gap-1.5">
          {view === 'per-game' && (
            <button
              type="button"
              onClick={() => setSortOrder(s => s === 'leverage' ? 'default' : 'leverage')}
              className={`px-2 py-1.5 text-xs font-bold rounded-lg border transition active:scale-95 ${
                sortOrder === 'leverage'
                  ? 'border-emerald-500 bg-emerald-950/70 text-emerald-400'
                  : 'border-slate-700 bg-slate-800 text-slate-400 hover:text-slate-200'
              }`}
              title="Toggle High-Impact Leverage Sort"
            >
              {sortOrder === 'leverage' ? '⚡ Leverage' : '🕒 Default'}
            </button>
          )}
          <button 
            type="button"
            onClick={() => setFilter(f => f === 'all' ? 'mine' : f === 'mine' ? 'opp' : 'all')}
            className="px-2.5 py-1.5 text-xs font-bold rounded-lg border border-slate-700 bg-slate-800 hover:bg-slate-700 text-slate-300 transition active:scale-95"
          >
            {filter.toUpperCase()}
          </button>
          <button
            type="button"
            onClick={handleResetSlate}
            className="px-2 py-1.5 text-xs font-bold rounded-lg border border-slate-700 bg-slate-800 hover:bg-rose-950/50 hover:text-rose-400 text-slate-400 transition active:scale-95"
            title="Reset All Live Data"
          >
            ↺
          </button>
        </div>
      </header>

      {/* Simulator Dock */}
      <section className="max-w-md mx-auto px-4 pt-3">
        <div className="bg-slate-800/90 border border-slate-700 rounded-2xl p-3 shadow-lg">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-black uppercase tracking-wider text-slate-400">Play Simulator</span>
              <span className={`text-[10px] font-black px-1.5 py-0.5 rounded ${
                activeLeverage.color === 'green' ? 'bg-emerald-950 text-emerald-400 border border-emerald-800' :
                activeLeverage.color === 'red' ? 'bg-rose-950 text-rose-400 border border-rose-800' :
                'bg-slate-900 text-slate-400 border border-slate-700'
              }`}>
                {activeLeverage.label}
              </span>
            </div>
            <select
              value={selectedPlayerId}
              onChange={(e) => setSelectedPlayerId(e.target.value)}
              className="bg-slate-950 text-emerald-400 border border-slate-700 text-xs font-bold rounded px-2 py-1 outline-none focus:ring-1 focus:ring-emerald-500"
            >
              {allSelectable.map(p => (
                <option key={p.id} value={p.id}>
                  {p.name} ({p.team || p.pos})
                </option>
              ))}
            </select>
          </div>

          {/* Context-Aware Play Buttons */}
          {['LB', 'DL', 'DB'].includes(activePlayer?.pos) ? (
            <div className="grid grid-cols-4 gap-1.5">
              <button
                type="button"
                onClick={() => handleSimulatePlay('IDP_SOLO_TACKLE', '+1.5 Tackle')}
                className="py-2 px-1 bg-slate-700/70 hover:bg-slate-600 rounded-xl text-[11px] font-bold text-slate-200 transition active:scale-90"
              >
                +1.5 Tkl
              </button>
              <button
                type="button"
                onClick={() => handleSimulatePlay('IDP_TFL', '+2.0 TFL')}
                className="py-2 px-1 bg-slate-700/70 hover:bg-slate-600 rounded-xl text-[11px] font-bold text-slate-200 transition active:scale-90"
              >
                +2.0 TFL
              </button>
              <button
                type="button"
                onClick={() => handleSimulatePlay('IDP_SACK', '+4.0 Sack')}
                className="py-2 px-1 bg-emerald-600/80 hover:bg-emerald-500 rounded-xl text-[11px] font-black text-white transition active:scale-90 shadow-sm shadow-emerald-950"
              >
                +4.0 Sack
              </button>
              <button
                type="button"
                onClick={() => handleSimulatePlay('IDP_INT', '+5.0 INT')}
                className="py-2 px-1 bg-emerald-500 hover:bg-emerald-400 rounded-xl text-[11px] font-black text-slate-950 transition active:scale-90 shadow-sm"
              >
                +5.0 INT
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-4 gap-1.5">
              <button
                type="button"
                onClick={() => handleSimulatePlay('RUSH_10YD', '+10y Rush')}
                className="py-2 px-1 bg-slate-700/70 hover:bg-slate-600 rounded-xl text-[11px] font-bold text-slate-200 transition active:scale-90"
              >
                +10y Run
              </button>
              <button
                type="button"
                onClick={() => handleSimulatePlay('REC_15YD', '+15y Rec')}
                className="py-2 px-1 bg-slate-700/70 hover:bg-slate-600 rounded-xl text-[11px] font-bold text-slate-200 transition active:scale-90"
              >
                +15y Rec
              </button>
              <button
                type="button"
                onClick={() => handleSimulatePlay('TOUCHDOWN', 'Touchdown')}
                className="py-2 px-1 bg-emerald-600/80 hover:bg-emerald-500 rounded-xl text-[11px] font-black text-white transition active:scale-90 shadow-sm shadow-emerald-950"
              >
                +6 TD
              </button>
              <button
                type="button"
                onClick={() => handleSimulatePlay('TURNOVER', 'Turnover')}
                className="py-2 px-1 bg-rose-600/80 hover:bg-rose-500 rounded-xl text-[11px] font-black text-white transition active:scale-90 shadow-sm shadow-rose-950"
              >
                -2 TO
              </button>
            </div>
          )}

          {recentFlash && (
            <div className="mt-2 text-center text-xs font-bold text-emerald-400 bg-emerald-950/40 border border-emerald-800/60 rounded-lg py-1 px-2 animate-in fade-in">
              ⚡ {activePlayer?.name}: {recentFlash.label} → 
              <span className="text-white ml-1 font-black">
                {recentFlash.portfolioDelta >= 0 ? `+${recentFlash.portfolioDelta}` : recentFlash.portfolioDelta} Net Pts
              </span>
              <span className="text-slate-400 text-[10px] ml-1">({recentFlash.multiplier}x leverage)</span>
            </div>
          )}
        </div>
      </section>

      {/* Main Views */}
      <main className="max-w-md mx-auto p-4 space-y-3">
        {/* VIEW 1: Per-Game Roots */}
        {view === 'per-game' && (
          <div className="space-y-3">
            {games.map(game => (
              <div key={game.id} className="bg-slate-800/80 rounded-2xl border border-slate-700/80 shadow-md overflow-hidden">
                <div className="bg-slate-950/60 px-3.5 py-2.5 border-b border-slate-700/80 flex justify-between items-center text-xs font-semibold text-slate-400">
                  <span className="font-bold text-slate-300">{game.away} @ {game.home}</span>
                  <span className={game.status.includes('LIVE') ? 'text-emerald-400 font-bold' : ''}>
                    {game.status} • {game.time}
                  </span>
                </div>
                <div className="divide-y divide-slate-700/50">
                {getGamePlayers(game).slice().sort((a, b) => {
                    if (sortOrder !== 'leverage') return 0;
                    const levA = Math.abs(calculatePlayerLeverage(a.leagueDetails || a.leagues || []).netMultiplier);
                    const levB = Math.abs(calculatePlayerLeverage(b.leagueDetails || b.leagues || []).netMultiplier);
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
                        <div>
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
                          <div className="text-xs text-slate-400 mt-1 flex items-center gap-1.5">
                            <span>{player.leaguesSummary}</span>
                            <span className="text-[10px] text-emerald-400 font-bold border-b border-dotted border-emerald-500">Breakdown →</span>
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="text-sm font-black text-slate-200">
                            {player.pts} <span className="text-[10px] font-normal text-slate-400">pts</span>
                          </div>
                          <span className={`inline-block text-[11px] font-black px-2 py-0.5 rounded-full mt-1 ${
                            leverage.color === 'green' 
                              ? 'bg-emerald-950 text-emerald-400 border border-emerald-700' 
                              : leverage.color === 'red'
                              ? 'bg-rose-950 text-rose-400 border border-rose-700'
                              : 'bg-slate-800 text-slate-400 border border-slate-700'
                          }`}>
                            {leverage.label}
                          </span>
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
        {view === 'combined' && (
          <div className="space-y-3">
            <div className="bg-slate-950 border border-slate-800 rounded-2xl p-4 shadow-lg">
              <div className="flex items-center justify-between border-b border-slate-800/80 pb-3 mb-3">
                <div>
                  <div className="text-[10px] font-black uppercase tracking-wider text-slate-400">Total Portfolio Score</div>
                  <div className="text-2xl font-black text-white mt-0.5 flex items-baseline gap-2">
                    {totalMyPts} <span className="text-xs font-semibold text-slate-500">/ {totalMyProj} proj</span>
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-[10px] font-black uppercase tracking-wider text-slate-400">Net Opposition</div>
                  <div className="text-2xl font-black text-slate-300 mt-0.5 flex items-baseline gap-2 justify-end">
                    {totalOppPts} <span className="text-xs font-semibold text-slate-500">/ {totalOppProj} proj</span>
                  </div>
                </div>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-slate-400 font-semibold">Net Portfolio Margin:</span>
                <span className={`font-black px-2 py-0.5 rounded text-xs ${
                  netMargin >= 0 
                    ? 'bg-emerald-950 text-emerald-400 border border-emerald-800' 
                    : 'bg-rose-950 text-rose-400 border border-rose-800'
                }`}>
                  {netMargin >= 0 ? `+${netMargin}` : netMargin} pts
                </span>
              </div>
            </div>

            {/* Sub-Tabs: Starters / IDP / Bench */}
            <div className="flex gap-1.5 p-1 bg-slate-950 rounded-xl border border-slate-800 text-xs font-bold">
              <button
                type="button"
                onClick={() => setRosterTab('starters')}
                className={`flex-1 py-1.5 rounded-lg transition ${
                  rosterTab === 'starters' ? 'bg-emerald-600 text-white' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Starters
              </button>
              <button
                type="button"
                onClick={() => setRosterTab('idp')}
                className={`flex-1 py-1.5 rounded-lg transition ${
                  rosterTab === 'idp' ? 'bg-emerald-600 text-white' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                IDP Defense
              </button>
              <button
                type="button"
                onClick={() => setRosterTab('bench')}
                className={`flex-1 py-1.5 rounded-lg transition ${
                  rosterTab === 'bench' ? 'bg-emerald-600 text-white' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Bench
              </button>
            </div>

            {/* Starters List */}
            <div className="bg-slate-800/80 rounded-2xl border border-slate-700 p-3.5 shadow-sm">
              <div className="flex items-center justify-between mb-2.5">
                <h2 className="text-xs font-bold uppercase tracking-wider text-emerald-400">Portfolio Starters</h2>
                <span className="text-xs font-black text-slate-300">{totalMyPts} pts total</span>
              </div>
              <div className="space-y-2">
                {h2hData.myRoster
                  .filter(p => {
                    if (rosterTab === 'starters') return p.slot !== 'BENCH' && !['LB', 'DL', 'DB'].includes(p.pos);
                    if (rosterTab === 'idp') return ['LB', 'DL', 'DB'].includes(p.pos);
                    if (rosterTab === 'bench') return p.slot === 'BENCH';
                    return true;
                  })
                  .map((player) => {
                    const isTarget = player.id === selectedPlayerId;
                    const isFlashing = recentFlash?.id === player.id;
                    const leverage = calculatePlayerLeverage(player.leagueDetails || []);

                    return (
                      <div 
                        key={player.id}
                        onClick={() => {
                          setSelectedPlayerId(player.id);
                          setDrawerPlayer(player);
                        }}
                        className={`flex justify-between items-center p-2.5 rounded-xl border cursor-pointer transition select-none active:scale-[0.99] ${
                          isTarget ? 'bg-slate-700/60 border-slate-600' : 'bg-slate-900/60 border-slate-700/50 hover:bg-slate-700/30'
                        } ${isFlashing ? 'ring-2 ring-emerald-500 bg-emerald-950/30' : ''}`}
                      >
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-bold text-slate-100">{player.name}</span>
                            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-slate-700 text-slate-300">
                              {player.pos}
                            </span>
                          </div>
                          <div className="text-[11px] text-slate-400 mt-1 flex items-center gap-1.5">
                            <span>{player.league}</span>
                            <span className="text-[10px] text-emerald-400 font-bold border-b border-dotted border-emerald-500">Breakdown →</span>
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="text-sm font-black text-emerald-400">{player.pts} pts</div>
                          <span className="text-[10px] font-bold text-slate-400">{leverage.label}</span>
                        </div>
                      </div>
                    );
                  })}
              </div>
            </div>

            {/* Opposition Threats */}
            <div className="bg-slate-800/80 rounded-2xl border border-slate-700 p-3.5 shadow-sm">
              <div className="flex items-center justify-between mb-2.5">
                <h2 className="text-xs font-bold uppercase tracking-wider text-rose-400">Opposition Threats</h2>
                <span className="text-xs font-black text-slate-300">{totalOppPts} pts total</span>
              </div>
              <div className="space-y-2">
                {h2hData.opponents
                  .filter(p => {
                    if (rosterTab === 'starters') return p.slot !== 'BENCH' && !['LB', 'DL', 'DB'].includes(p.pos);
                    if (rosterTab === 'idp') return ['LB', 'DL', 'DB'].includes(p.pos);
                    if (rosterTab === 'bench') return p.slot === 'BENCH';
                    return true;
                  })
                  .map((player) => {
                    const isTarget = player.id === selectedPlayerId;
                    const isFlashing = recentFlash?.id === player.id;
                    const leverage = calculatePlayerLeverage(player.leagueDetails || []);

                    return (
                      <div 
                        key={player.id}
                        onClick={() => setSelectedPlayerId(player.id)}
                        className={`flex justify-between items-center p-2.5 rounded-xl border cursor-pointer transition select-none active:scale-[0.99] ${
                          isTarget ? 'bg-rose-950/40 border-rose-800' : 'bg-rose-950/20 border-rose-900/30 hover:bg-rose-950/30'
                        } ${isFlashing ? 'ring-2 ring-rose-500 bg-rose-950/40' : ''}`}
                      >
                        <div>
                          <span className="text-sm font-bold text-slate-100">{player.name} ({player.pos})</span>
                          <div className="text-[10px] text-slate-400">{player.league} • {player.proj} proj</div>
                        </div>
                        <div className="text-right">
                          <div className="text-sm font-black text-rose-400">{player.pts} pts</div>
                          <span className="text-[10px] font-bold text-rose-400">{leverage.label}</span>
                        </div>
                      </div>
                    );
                  })}
              </div>
            </div>
          </div>
        )}

        {/* VIEW 3: All Linked Leagues */}
        {view === 'leagues' && (
          <div className="space-y-3">
            <div className="px-1 flex justify-between items-center text-xs text-slate-400 font-semibold">
              <span>{leagues.length} Linked Leagues</span>
              <button
                type="button"
                onClick={() => setShowConnectModal(true)}
                className="px-2.5 py-1 bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-400 border border-emerald-500/40 rounded-lg font-bold text-[11px] transition active:scale-95 flex items-center gap-1 cursor-pointer"
              >
                <span>+</span> Link Platform
              </button>
            </div>

            {leagues.map(lg => {
              const diff = (lg.myScore - lg.oppScore).toFixed(1);
              const isWinning = diff >= 0;
              return (
                <div key={lg.id} className="bg-slate-800/90 border border-slate-700/80 rounded-2xl p-4 shadow-md space-y-3 select-none">
                  <div className="flex justify-between items-center border-b border-slate-700/60 pb-2">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-black text-white">{lg.name}</span>
                      <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-slate-900 text-slate-400 border border-slate-700">
                        {lg.platform}
                      </span>
                    </div>
                    <span className="text-[11px] font-extrabold text-emerald-400 animate-pulse">{lg.status}</span>
                  </div>

                  <div className="grid grid-cols-2 gap-2.5 text-center">
                    <div className="bg-slate-900/70 p-2.5 rounded-xl border border-slate-700/40">
                      <div className="text-[11px] font-bold text-slate-400 truncate">{lg.myTeam}</div>
                      <div className="text-xl font-black text-white mt-1">{lg.myScore}</div>
                    </div>
                    <div className="bg-slate-900/70 p-2.5 rounded-xl border border-slate-700/40">
                      <div className="text-[11px] font-bold text-slate-400 truncate">{lg.oppTeam}</div>
                      <div className="text-xl font-black text-slate-300 mt-1">{lg.oppScore}</div>
                    </div>
                  </div>

                  <div className="flex justify-between items-center text-xs pt-1">
                    <span className="text-slate-400">Matchup Margin:</span>
                    <span className={`font-black px-2 py-0.5 rounded text-xs ${
                      isWinning ? 'bg-emerald-950 text-emerald-400 border border-emerald-800' : 'bg-rose-950 text-rose-400 border border-rose-800'
                    }`}>
                      {isWinning ? `+${diff}` : diff} pts
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </main>

      {/* Connect Platform Modal */}
      <ConnectModal 
        isOpen={showConnectModal} 
        onClose={() => setShowConnectModal(false)} 
        onAddLeague={handleAddLeague} 
      />

      {/* Slide-Up Drawer */}
      {drawerPlayer && (
        <div 
          onClick={() => setDrawerPlayer(null)}
          className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-end justify-center"
        >
          <div 
            onClick={(e) => e.stopPropagation()}
            className="bg-slate-900 border-t sm:border border-slate-700 w-full max-w-[420px] rounded-t-3xl sm:rounded-3xl p-5 shadow-2xl space-y-4 max-h-[85vh] overflow-y-auto"
          >
            <div className="w-12 h-1.5 bg-slate-700 rounded-full mx-auto mb-1 cursor-grab" onClick={() => setDrawerPlayer(null)}></div>

            <div className="flex justify-between items-start border-b border-slate-800 pb-3">
              <div>
                <h3 className="text-lg font-black text-white flex items-center gap-2">
                  {drawerPlayer.name}
                  <span className="text-xs font-bold px-2 py-0.5 rounded bg-slate-800 text-slate-300">
                    {drawerPlayer.team || drawerPlayer.pos}
                  </span>
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">League Portfolio Breakdown</p>
              </div>
              <button 
                type="button"
                onClick={() => setDrawerPlayer(null)}
                className="w-8 h-8 rounded-full bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white flex items-center justify-center font-bold text-sm active:scale-90 transition"
              >
                ✕
              </button>
            </div>

            <div className="space-y-2.5">
              {drawerPlayer.leagueDetails?.map((item, idx) => (
                <div key={idx} className="p-3 rounded-xl bg-slate-800/60 border border-slate-700/60 flex items-center justify-between">
                  <div>
                    <div className="text-sm font-bold text-slate-100">{item.name}</div>
                    <div className="text-[11px] text-slate-400 mt-0.5">vs. {item.opponent}</div>
                  </div>
                  <div className="text-right">
                    <span className={`text-[10px] font-black px-2 py-0.5 rounded ${
                      item.status === 'STARTER' ? 'bg-emerald-950 text-emerald-400 border border-emerald-800' :
                      item.status === 'OPPONENT' ? 'bg-rose-950 text-rose-400 border border-rose-800' :
                      'bg-slate-800 text-slate-400'
                    }`}>
                      {item.status}
                    </span>
                    <div className="text-[11px] font-semibold text-slate-300 mt-1">{item.impact}</div>
                  </div>
                </div>
              ))}
            </div>

            <button
              type="button"
              onClick={() => setDrawerPlayer(null)}
              className="w-full py-3 bg-slate-800 hover:bg-slate-700 active:scale-98 rounded-xl text-xs font-bold text-slate-200 transition"
            >
              Done
            </button>
          </div>
        </div>
      )}

      {/* Bottom Sticky Navigation */}
      <nav className="fixed bottom-0 inset-x-0 bg-slate-950/95 backdrop-blur border-t border-slate-800 px-3 py-3 flex justify-around items-center z-40 shadow-2xl">
        <button
          type="button"
          onClick={() => setView('per-game')}
          className={`flex-1 text-center py-2 transition active:scale-95 ${view === 'per-game' ? 'text-emerald-400 font-black' : 'text-slate-400 hover:text-slate-200 font-bold'}`}
        >
          <span className="text-xs">Per-Game Roots</span>
        </button>
        <div className="h-4 w-px bg-slate-800" />
        <button
          type="button"
          onClick={() => setView('combined')}
          className={`flex-1 text-center py-2 transition active:scale-95 ${view === 'combined' ? 'text-emerald-400 font-black' : 'text-slate-400 hover:text-slate-200 font-bold'}`}
        >
          <span className="text-xs">Blended H2H Roots</span>
        </button>
        <div className="h-4 w-px bg-slate-800" />
        <button
          type="button"
          onClick={() => setView('leagues')}
          className={`flex-1 text-center py-2 transition active:scale-95 ${view === 'leagues' ? 'text-emerald-400 font-black' : 'text-slate-400 hover:text-slate-200 font-bold'}`}
        >
          <span className="text-xs">All Leagues</span>
        </button>
      </nav>
    </div>
  );
}