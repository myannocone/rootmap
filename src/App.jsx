import React, { useState, useEffect, useMemo, useRef, useLayoutEffect } from 'react';
import PlayerAvatar from './components/PlayerAvatar';
import RootMapLogo from './components/Logo';
import { mockGames as initialGames } from './data/mockSlate';
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
      { name: 'Saquon Barkley', nflTeam: 'PHI', position: 'RB', slot: 'RB', points: 24.2 },
      { name: 'Amon-Ra St. Brown', nflTeam: 'DET', position: 'WR', slot: 'WR', points: 16.8 },
      { name: 'CeeDee Lamb', nflTeam: 'DAL', position: 'WR', slot: 'WR', points: 18.2 }
    ]
  }
];

export default function App() {
  const [view, setView] = useState('matchups'); // Default to Battleboard
  const [leagues, setLeagues] = useState(INITIAL_LEAGUES);
  const [games, setGames] = useState(initialGames || []);
  const [selectedPlayer, setSelectedPlayer] = useState(null);
  const [hoveredConflictPlayer, setHoveredConflictPlayer] = useState(null);
  const [activeLeagueDrawer, setActiveLeagueDrawer] = useState(null);

  const containerRef = useRef(null);
  const leftCardRefs = useRef({});
  const rightCardRefs = useRef({});
  const [connectors, setConnectors] = useState([]);

  // Fetch live ESPN scores on mount and every 60s
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

  const totalNetDelta = useMemo(() => {
    return leagues.reduce((acc, lg) => acc + (lg.myScore - lg.oppScore), 0);
  }, [leagues]);

  const playerMasterIndex = useMemo(() => {
    const map = new Map();

    const getOrCreate = (name, nflTeam, position) => {
      if (!map.has(name)) {
        map.set(name, {
          name,
          nflTeam,
          position,
          myShares: 0,
          myLeagues: [],
          oppShares: 0,
          oppLeagues: []
        });
      }
      return map.get(name);
    };

    leagues.forEach(lg => {
      (lg.starters || []).forEach(p => {
        const item = getOrCreate(p.name, p.nflTeam, p.position);
        item.myShares += 1;
        item.myLeagues.push({ league: lg.name, opponent: lg.opponent });
      });
    });

    leagues.forEach(lg => {
      (lg.opponentStarters || []).forEach(p => {
        const item = getOrCreate(p.name, p.nflTeam, p.position);
        item.oppShares += 1;
        item.oppLeagues.push({ league: lg.name, opponent: lg.opponent });
      });
    });

    return map;
  }, [leagues]);

  const myPortfolio = useMemo(() => {
    return Array.from(playerMasterIndex.values())
      .filter(p => p.myShares > 0)
      .sort((a, b) => b.myShares - a.myShares);
  }, [playerMasterIndex]);

  const oppThreats = useMemo(() => {
    return Array.from(playerMasterIndex.values())
      .filter(p => p.oppShares > 0)
      .sort((a, b) => b.oppShares - a.oppShares);
  }, [playerMasterIndex]);

  // Dynamic SVG wire computation
  const updateConnectors = () => {
    if (!containerRef.current) return;
    const containerRect = containerRef.current.getBoundingClientRect();
    const lines = [];

    myPortfolio.forEach(player => {
      if (player.oppShares > 0) {
        const leftEl = leftCardRefs.current[player.name];
        const rightEl = rightCardRefs.current[player.name];

        if (leftEl && rightEl) {
          const lRect = leftEl.getBoundingClientRect();
          const rRect = rightEl.getBoundingClientRect();

          const x1 = lRect.right - containerRect.left;
          const y1 = lRect.top + lRect.height / 2 - containerRect.top;
          const x2 = rRect.left - containerRect.left;
          const y2 = rRect.top + rRect.height / 2 - containerRect.top;

          lines.push({
            name: player.name,
            x1,
            y1,
            x2,
            y2
          });
        }
      }
    });

    setConnectors(lines);
  };

  useLayoutEffect(() => {
    if (view === 'matchups') {
      updateConnectors();
      const timer = setTimeout(updateConnectors, 80);
      window.addEventListener('resize', updateConnectors);
      return () => {
        clearTimeout(timer);
        window.removeEventListener('resize', updateConnectors);
      };
    }
  }, [view, myPortfolio, oppThreats]);

  const getGamePlayers = (game) => {
    if (!game) return [];
    return myPortfolio.filter(
      p => p.nflTeam === game.away || p.nflTeam === game.home
    );
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 pb-28 font-sans select-none">
      {/* Top Header */}
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
        {/* VIEW 1: MATCHUPS (BATTLEBOARD REPLACING BLENDED H2H) */}
        {view === 'matchups' && (
          <div className="space-y-3">
            <div className="flex justify-between items-center px-1">
              <div className="text-xs font-black uppercase tracking-wider text-slate-300">
                Week 7 Portfolio Grid
              </div>
              <div className="text-[11px] font-mono font-bold text-slate-400">
                {myPortfolio.length} Active • {oppThreats.length} Threats
              </div>
            </div>

            {/* Split Column Headers */}
            <div className="grid grid-cols-2 gap-4 text-center text-xs font-black tracking-wider uppercase">
              <div className="bg-slate-900 border border-emerald-500/30 rounded-xl py-2 px-1 text-emerald-400 flex flex-col items-center justify-center">
                <span>Your Portfolio</span>
                <span className="text-[10px] text-slate-400 font-normal">({myPortfolio.length} Active)</span>
              </div>
              <div className="bg-slate-900 border border-rose-500/30 rounded-xl py-2 px-1 text-rose-400 flex flex-col items-center justify-center">
                <span>Opposition Threats</span>
                <span className="text-[10px] text-slate-400 font-normal">({oppThreats.length} Total)</span>
              </div>
            </div>

            {/* Duel Grid Relative Container for SVG Overlay */}
            <div ref={containerRef} className="relative">
              <svg 
                className="pointer-events-none absolute inset-0 w-full h-full z-20 overflow-visible"
              >
                <defs>
                  <linearGradient id="conflictWireGrad" x1="0%" y1="0%" x2="100%" y2="0%">
                    <stop offset="0%" stopColor="#10b981" stopOpacity="0.8" />
                    <stop offset="50%" stopColor="#f59e0b" stopOpacity="1" />
                    <stop offset="100%" stopColor="#f43f5e" stopOpacity="0.8" />
                  </linearGradient>
                  <filter id="wireGlow" x="-20%" y="-20%" width="140%" height="140%">
                    <feDropShadow dx="0" dy="0" stdDeviation="2.5" floodColor="#f59e0b" floodOpacity="0.7"/>
                  </filter>
                </defs>

                {connectors.map((c) => {
                  const isHovered = hoveredConflictPlayer === c.name || selectedPlayer?.name === c.name;
                  const dx = (c.x2 - c.x1) * 0.55;
                  const pathData = `M ${c.x1} ${c.y1} C ${c.x1 + dx} ${c.y1}, ${c.x2 - dx} ${c.y2}, ${c.x2} ${c.y2}`;

                  return (
                    <g key={c.name}>
                      <path
                        d={pathData}
                        fill="none"
                        stroke={isHovered ? "#f59e0b" : "url(#conflictWireGrad)"}
                        strokeWidth={isHovered ? 3.5 : 2}
                        strokeDasharray={isHovered ? "none" : "3,3"}
                        strokeOpacity={isHovered ? 1 : 0.65}
                        filter={isHovered ? "url(#wireGlow)" : undefined}
                      />
                      <circle cx={c.x1} cy={c.y1} r={isHovered ? 3.5 : 2.5} fill="#10b981" />
                      <circle cx={c.x2} cy={c.y2} r={isHovered ? 3.5 : 2.5} fill="#f43f5e" />
                    </g>
                  );
                })}
              </svg>

              <div className="grid grid-cols-2 gap-4 relative z-10">
                {/* LEFT COLUMN: YOUR PORTFOLIO */}
                <div className="space-y-2">
                  {myPortfolio.map((player) => {
                    const isConflict = player.oppShares > 0;
                    const isHovered = hoveredConflictPlayer === player.name;
                    return (
                      <div
                        key={`my_${player.name}`}
                        ref={(el) => { leftCardRefs.current[player.name] = el; }}
                        onClick={() => setSelectedPlayer(player)}
                        onMouseEnter={() => isConflict && setHoveredConflictPlayer(player.name)}
                        onMouseLeave={() => setHoveredConflictPlayer(null)}
                        className={`relative rounded-xl p-2.5 transition active:scale-[0.98] cursor-pointer border shadow-sm ${
                          isConflict
                            ? isHovered
                              ? 'bg-amber-950/40 border-amber-400 ring-1 ring-amber-400'
                              : 'bg-amber-950/20 border-amber-500/50 hover:bg-amber-950/30'
                            : 'bg-emerald-950/20 border-emerald-500/40 hover:bg-emerald-950/30'
                        }`}
                      >
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
                            {player.myShares} {player.myShares === 1 ? 'LEAGUE' : 'LEAGUES'}
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
                    const isConflict = threat.myShares > 0;
                    const isHovered = hoveredConflictPlayer === threat.name;
                    return (
                      <div
                        key={`opp_${threat.name}`}
                        ref={(el) => { rightCardRefs.current[threat.name] = el; }}
                        onClick={() => setSelectedPlayer(threat)}
                        onMouseEnter={() => isConflict && setHoveredConflictPlayer(threat.name)}
                        onMouseLeave={() => setHoveredConflictPlayer(null)}
                        className={`relative rounded-xl p-2.5 transition active:scale-[0.98] cursor-pointer border shadow-sm ${
                          isConflict
                            ? isHovered
                              ? 'bg-amber-950/40 border-amber-400 ring-1 ring-amber-400'
                              : 'bg-amber-950/20 border-amber-500/50 hover:bg-amber-950/30'
                            : 'bg-rose-950/20 border-rose-500/40 hover:bg-rose-950/30'
                        }`}
                      >
                        {isConflict && (
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
                            {threat.oppShares} {threat.oppShares === 1 ? 'LEAGUE' : 'LEAGUES'}
                          </span>
                          {isConflict ? (
                            <span className="text-amber-400 font-bold">HEDGED ({threat.myShares}x)</span>
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
          </div>
        )}

        {/* VIEW 2: GAME SLATE (RESTORED WITH LIVE ESPN SCORES & CLOCKS) */}
        {view === 'game-slate' && (
          <div className="space-y-3">
            <div className="bg-slate-900 rounded-2xl p-3 border border-slate-800 flex justify-between items-center">
              <div>
                <div className="text-xs font-black text-emerald-400 uppercase tracking-wide">
                  Live NFL Scoreboard
                </div>
                <div className="text-[11px] text-slate-400">
                  Real-time ESPN feed polling active game slates
                </div>
              </div>
              <div className="text-right">
                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-950 text-emerald-400 border border-emerald-800">
                  ● LIVE
                </span>
              </div>
            </div>

            {(games || []).map(game => {
              const activeMatchPlayers = getGamePlayers(game);
              return (
                <div key={game.id} className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-sm">
                  {/* Game Status Banner */}
                  <div className="bg-slate-950 px-3.5 py-2.5 border-b border-slate-800 flex justify-between items-center text-xs">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-white">{game.away} @ {game.home}</span>
                      <span className="font-mono text-slate-400 text-[11px]">
                        ({game.awayScore || 0} - {game.homeScore || 0})
                      </span>
                    </div>
                    <span className={`text-[11px] font-bold ${game.status?.includes('LIVE') ? 'text-emerald-400' : 'text-slate-400'}`}>
                      {game.status} • {game.time}
                    </span>
                  </div>

                  {/* Active Roster Players in this Game */}
                  <div className="divide-y divide-slate-800/60 p-1">
                    {activeMatchPlayers.length === 0 ? (
                      <div className="p-3 text-center text-xs text-slate-500 italic">
                        No portfolio starters active in this matchup
                      </div>
                    ) : (
                      activeMatchPlayers.map(player => (
                        <div
                          key={player.name}
                          onClick={() => setSelectedPlayer(player)}
                          className="p-2.5 flex items-center justify-between cursor-pointer hover:bg-slate-800/40 rounded-xl transition"
                        >
                          <div className="flex items-center gap-2.5">
                            {PlayerAvatar && (
                              <PlayerAvatar name={player.name} position={player.position} className="w-8 h-8" />
                            )}
                            <div>
                              <div className="font-bold text-white text-xs">{player.name}</div>
                              <div className="text-[10px] text-slate-400">{player.position} • {player.nflTeam}</div>
                            </div>
                          </div>
                          <div className="text-right font-mono">
                            <div className="text-xs font-black text-emerald-400">
                              {player.myShares} {player.myShares === 1 ? 'League' : 'Leagues'}
                            </div>
                            {player.oppShares > 0 && (
                              <div className="text-[10px] text-amber-400 font-bold">
                                Facing in {player.oppShares}
                              </div>
                            )}
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* VIEW 3: ALL LEAGUES */}
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
      </main>

      {/* Persistent Bottom Navigation: Matchups | Game Slate | All Leagues */}
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
            onClick={() => setView('game-slate')}
            className={`py-2 flex flex-col items-center justify-center rounded-xl text-xs font-bold transition ${
              view === 'game-slate' ? 'bg-slate-800 text-emerald-400' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <span>🎮 Game Slate</span>
          </button>
          <button
            onClick={() => setView('all-leagues')}
            className={`py-2 flex flex-col items-center justify-center rounded-xl text-xs font-bold transition ${
              view === 'all-leagues' ? 'bg-slate-800 text-emerald-400' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <span>🏆 All Leagues</span>
          </button>
        </div>
      </nav>

      {/* Unified Player Conflict Breakdown Drawer */}
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

            <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 flex justify-between items-center text-xs">
              <span className="font-bold text-slate-300">Portfolio Net Stance:</span>
              <span className={`font-mono font-black px-2.5 py-0.5 rounded-full ${
                selectedPlayer.myShares > selectedPlayer.oppShares
                  ? 'bg-emerald-950 text-emerald-400 border border-emerald-800'
                  : selectedPlayer.myShares < selectedPlayer.oppShares
                  ? 'bg-rose-950 text-rose-400 border border-rose-800'
                  : 'bg-amber-950 text-amber-400 border border-amber-800'
              }`}>
                {selectedPlayer.myShares > selectedPlayer.oppShares
                  ? `ROOTING FOR (+${selectedPlayer.myShares - selectedPlayer.oppShares})`
                  : selectedPlayer.myShares < selectedPlayer.oppShares
                  ? `ROOTING AGAINST (-${selectedPlayer.oppShares - selectedPlayer.myShares})`
                  : 'PERFECTLY HEDGED (0)'}
              </span>
            </div>

            <div className="space-y-3">
              <div>
                <div className="text-[11px] font-bold text-emerald-400 uppercase tracking-wider mb-1.5 flex justify-between">
                  <span>Your Roster ({selectedPlayer.myShares} Leagues)</span>
                  <span className="text-[10px] text-slate-500">ROOTING FOR</span>
                </div>
                {selectedPlayer.myShares > 0 ? (
                  <div className="space-y-1.5">
                    {selectedPlayer.myLeagues.map((item, i) => (
                      <div key={i} className="bg-slate-800/60 rounded-xl px-3 py-2 text-xs flex justify-between items-center border border-slate-700/50">
                        <span className="font-semibold text-slate-200">{item.league}</span>
                        <span className="text-[10px] text-slate-400">vs {item.opponent}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="bg-slate-950/40 rounded-xl p-2.5 text-xs text-slate-500 italic text-center border border-slate-800/50">
                    Not rostered on any of your active teams
                  </div>
                )}
              </div>

              <div>
                <div className="text-[11px] font-bold text-rose-400 uppercase tracking-wider mb-1.5 flex justify-between">
                  <span>Opponent Starters ({selectedPlayer.oppShares} Leagues)</span>
                  <span className="text-[10px] text-slate-500">ROOTING AGAINST</span>
                </div>
                {selectedPlayer.oppShares > 0 ? (
                  <div className="space-y-1.5">
                    {selectedPlayer.oppLeagues.map((item, i) => (
                      <div key={i} className="bg-slate-800/60 rounded-xl px-3 py-2 text-xs flex justify-between items-center border border-slate-700/50">
                        <span className="font-semibold text-slate-200">{item.league}</span>
                        <span className="text-[10px] text-rose-400 font-bold">Started by {item.opponent}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="bg-slate-950/40 rounded-xl p-2.5 text-xs text-slate-500 italic text-center border border-slate-800/50">
                    Zero opponent exposure across your leagues
                  </div>
                )}
              </div>
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
