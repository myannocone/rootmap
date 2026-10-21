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
      { name: 'Justin Herbert', nflTeam: 'LAC', position: 'QB', slot: 'QB', points: 18.4, isLive: true, inRedZone: true, gameClock: '3rd 4:12', bigPlay: null },
      { name: 'Saquon Barkley', nflTeam: 'PHI', position: 'RB', slot: 'RB', points: 24.2, isLive: true, inRedZone: false, gameClock: '4th 2:45', bigPlay: '42yd TD' },
      { name: 'Amon-Ra St. Brown', nflTeam: 'DET', position: 'WR', slot: 'WR', points: 16.8, isLive: false, inRedZone: false, gameClock: 'Final', bigPlay: null },
      { name: 'Nico Collins', nflTeam: 'HOU', position: 'WR', slot: 'WR', points: 14.1, isLive: false, inRedZone: false, gameClock: 'Final', bigPlay: null },
      { name: 'Trey McBride', nflTeam: 'ARI', position: 'TE', slot: 'TE', points: 11.6, isLive: true, inRedZone: false, gameClock: '2nd 0:54', bigPlay: null },
      { name: 'Zay Flowers', nflTeam: 'BAL', position: 'WR', slot: 'FLEX', points: 13.9, isLive: false, inRedZone: false, gameClock: 'Final', bigPlay: null },
      { name: 'Roquan Smith', nflTeam: 'BAL', position: 'LB', slot: 'IDP', points: 12.0, isLive: false, inRedZone: false, gameClock: 'Final', bigPlay: null },
      { name: 'Bobby Wagner', nflTeam: 'WAS', position: 'LB', slot: 'IDP', points: 10.5, isLive: false, inRedZone: false, gameClock: 'Final', bigPlay: null }
    ],
    opponentStarters: [
      { name: 'Patrick Mahomes', nflTeam: 'KC', position: 'QB', slot: 'QB', points: 21.6, isLive: true, inRedZone: true, gameClock: '4th 1:15', bigPlay: '35yd PASS' },
      { name: 'Tyreek Hill', nflTeam: 'MIA', position: 'WR', slot: 'WR', points: 19.4, isLive: false, inRedZone: false, gameClock: 'Final', bigPlay: null },
      { name: 'Alvin Kamara', nflTeam: 'NO', position: 'RB', slot: 'RB', points: 15.2, isLive: false, inRedZone: false, gameClock: 'Final', bigPlay: null },
      { name: 'George Kittle', nflTeam: 'SF', position: 'TE', slot: 'TE', points: 13.8, isLive: true, inRedZone: false, gameClock: '3rd 8:20', bigPlay: null },
      { name: 'Fred Warner', nflTeam: 'SF', position: 'LB', slot: 'IDP', points: 9.5, isLive: true, inRedZone: false, gameClock: '3rd 8:20', bigPlay: null }
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
      { name: 'Lamar Jackson', nflTeam: 'BAL', position: 'QB', slot: 'QB', points: 26.4, isLive: false, inRedZone: false, gameClock: 'Final', bigPlay: null },
      { name: 'Bijan Robinson', nflTeam: 'ATL', position: 'RB', slot: 'RB', points: 17.5, isLive: false, inRedZone: false, gameClock: 'Final', bigPlay: null },
      { name: 'Saquon Barkley', nflTeam: 'PHI', position: 'RB', slot: 'RB', points: 24.2, isLive: true, inRedZone: false, gameClock: '4th 2:45', bigPlay: '42yd TD' },
      { name: 'CeeDee Lamb', nflTeam: 'DAL', position: 'WR', slot: 'WR', points: 18.2, isLive: true, inRedZone: true, gameClock: '4th 0:30', bigPlay: '28yd REC' },
      { name: 'George Kittle', nflTeam: 'SF', position: 'TE', slot: 'TE', points: 13.8, isLive: true, inRedZone: false, gameClock: '3rd 8:20', bigPlay: null },
      { name: 'Fred Warner', nflTeam: 'SF', position: 'LB', slot: 'IDP', points: 9.5, isLive: true, inRedZone: false, gameClock: '3rd 8:20', bigPlay: null }
    ],
    opponentStarters: [
      { name: 'Josh Allen', nflTeam: 'BUF', position: 'QB', slot: 'QB', points: 24.8, isLive: false, inRedZone: false, gameClock: 'Final', bigPlay: null },
      { name: 'Justin Jefferson', nflTeam: 'MIN', position: 'WR', slot: 'WR', points: 20.1, isLive: false, inRedZone: false, gameClock: 'Final', bigPlay: null },
      { name: 'Travis Kelce', nflTeam: 'KC', position: 'TE', slot: 'TE', points: 11.2, isLive: true, inRedZone: true, gameClock: '4th 1:15', bigPlay: null },
      { name: 'Roquan Smith', nflTeam: 'BAL', position: 'LB', slot: 'IDP', points: 12.0, isLive: false, inRedZone: false, gameClock: 'Final', bigPlay: null }
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
      { name: 'Josh Allen', nflTeam: 'BUF', position: 'QB', slot: 'QB', points: 24.8, isLive: false, inRedZone: false, gameClock: 'Final', bigPlay: null },
      { name: 'James Cook', nflTeam: 'BUF', position: 'RB', slot: 'RB', points: 16.3, isLive: false, inRedZone: false, gameClock: 'Final', bigPlay: null },
      { name: 'Justin Jefferson', nflTeam: 'MIN', position: 'WR', slot: 'WR', points: 20.1, isLive: false, inRedZone: false, gameClock: 'Final', bigPlay: null },
      { name: 'Davante Adams', nflTeam: 'NYJ', position: 'WR', slot: 'WR', points: 12.4, isLive: false, inRedZone: false, gameClock: 'Final', bigPlay: null },
      { name: 'Brock Bowers', nflTeam: 'LV', position: 'TE', slot: 'TE', points: 14.5, isLive: true, inRedZone: false, gameClock: '2nd 3:10', bigPlay: null }
    ],
    opponentStarters: [
      { name: 'Patrick Mahomes', nflTeam: 'KC', position: 'QB', slot: 'QB', points: 21.6, isLive: true, inRedZone: true, gameClock: '4th 1:15', bigPlay: '35yd PASS' },
      { name: 'Saquon Barkley', nflTeam: 'PHI', position: 'RB', slot: 'RB', points: 24.2, isLive: true, inRedZone: false, gameClock: '4th 2:45', bigPlay: '42yd TD' },
      { name: 'Amon-Ra St. Brown', nflTeam: 'DET', position: 'WR', slot: 'WR', points: 16.8, isLive: false, inRedZone: false, gameClock: 'Final', bigPlay: null },
      { name: 'CeeDee Lamb', nflTeam: 'DAL', position: 'WR', slot: 'WR', points: 18.2, isLive: true, inRedZone: true, gameClock: '4th 0:30', bigPlay: '28yd REC' }
    ]
  }
];

export default function App() {
  const [theme, setTheme] = useState('dark');
  const [view, setView] = useState('matchups');
  const [sortMode, setSortMode] = useState('exposure');
  const [leagues, setLeagues] = useState(INITIAL_LEAGUES);
  const [games, setGames] = useState(initialGames || []);
  const [selectedPlayer, setSelectedPlayer] = useState(null);
  const [hoveredConflictPlayer, setHoveredConflictPlayer] = useState(null);
  const [activeLeagueDrawer, setActiveLeagueDrawer] = useState(null);
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncStatus, setSyncStatus] = useState('');

  const containerRef = useRef(null);
  const leftCardRefs = useRef({});
  const rightCardRefs = useRef({});
  const [connectors, setConnectors] = useState([]);

  const isLight = theme === 'light';

  // Listen for OAuth success message from auth popup window
  useEffect(() => {
    const handleAuthMessage = async (event) => {
      if (event.data?.type === 'YAHOO_AUTH_SUCCESS') {
        const { accessToken } = event.data;
        setIsSyncing(true);
        setSyncStatus('Authenticated! Pulling live rosters from Yahoo...');

        try {
          const res = await fetch('/api/sync', {
            headers: { Authorization: `Bearer ${accessToken}` }
          });
          const data = await res.json();
          console.log('Yahoo Sync Data:', data);
          setSyncStatus('Yahoo Sync Complete!');
          setTimeout(() => setSyncStatus(''), 4000);
        } catch (err) {
          console.error('Sync failed:', err);
          setSyncStatus('Error parsing rosters.');
        } finally {
          setIsSyncing(false);
        }
      }
    };

    window.addEventListener('message', handleAuthMessage);
    return () => window.removeEventListener('message', handleAuthMessage);
  }, []);

  const handleConnectYahoo = () => {
    const w = 600;
    const h = 700;
    const left = window.screen.width / 2 - w / 2;
    const top = window.screen.height / 2 - h / 2;

    window.open(
      '/api/auth/yahoo',
      'YahooAuthPopup',
      `width=${w},height=${h},top=${top},left=${left},scrollbars=yes,status=1`
    );
  };

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

    const getOrCreate = (name, nflTeam, position, points = 0, isLive = false, inRedZone = false, gameClock = 'Scheduled', bigPlay = null) => {
      if (!map.has(name)) {
        map.set(name, {
          name,
          nflTeam,
          position,
          points,
          isLive,
          inRedZone,
          gameClock,
          bigPlay,
          myShares: 0,
          myLeagues: [],
          oppShares: 0,
          oppLeagues: []
        });
      }
      const item = map.get(name);
      if (points) item.points = points;
      if (isLive) item.isLive = true;
      if (inRedZone) item.inRedZone = true;
      if (gameClock && gameClock !== 'Scheduled') item.gameClock = gameClock;
      if (bigPlay) item.bigPlay = bigPlay;
      return item;
    };

    leagues.forEach(lg => {
      (lg.starters || []).forEach(p => {
        const item = getOrCreate(p.name, p.nflTeam, p.position, p.points, p.isLive, p.inRedZone, p.gameClock, p.bigPlay);
        item.myShares += 1;
        item.myLeagues.push({ league: lg.name, opponent: lg.opponent });
      });
    });

    leagues.forEach(lg => {
      (lg.opponentStarters || []).forEach(p => {
        const item = getOrCreate(p.name, p.nflTeam, p.position, p.points, p.isLive, p.inRedZone, p.gameClock, p.bigPlay);
        item.oppShares += 1;
        item.oppLeagues.push({ league: lg.name, opponent: lg.opponent });
      });
    });

    return map;
  }, [leagues]);

  const sortComparator = (a, b, isLeftColumn) => {
    if (sortMode === 'live') {
      if (a.isLive !== b.isLive) return a.isLive ? -1 : 1;
    }
    if (sortMode === 'redzone') {
      if (a.inRedZone !== b.inRedZone) return a.inRedZone ? -1 : 1;
      if (a.isLive !== b.isLive) return a.isLive ? -1 : 1;
    }
    if (sortMode === 'conflict') {
      const aConflict = (a.myShares > 0 && a.oppShares > 0) ? 1 : 0;
      const bConflict = (b.myShares > 0 && b.oppShares > 0) ? 1 : 0;
      if (aConflict !== bConflict) return bConflict - aConflict;
    }
    const aShares = isLeftColumn ? a.myShares : a.oppShares;
    const bShares = isLeftColumn ? b.myShares : b.oppShares;
    return bShares - aShares;
  };

  const myPortfolio = useMemo(() => {
    return Array.from(playerMasterIndex.values())
      .filter(p => p.myShares > 0)
      .sort((a, b) => sortComparator(a, b, true));
  }, [playerMasterIndex, sortMode]);

  const oppThreats = useMemo(() => {
    return Array.from(playerMasterIndex.values())
      .filter(p => p.oppShares > 0)
      .sort((a, b) => sortComparator(a, b, false));
  }, [playerMasterIndex, sortMode]);

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
      const timer = setTimeout(updateConnectors, 60);
      window.addEventListener('resize', updateConnectors);
      return () => {
        clearTimeout(timer);
        window.removeEventListener('resize', updateConnectors);
      };
    }
  }, [view, sortMode, theme, myPortfolio, oppThreats]);

  const getGamePlayers = (game) => {
    if (!game) return [];
    return myPortfolio.filter(
      p => p.nflTeam === game.away || p.nflTeam === game.home
    );
  };

  return (
    <div className={`min-h-screen pb-28 font-sans select-none transition-colors duration-200 ${
      isLight ? 'bg-slate-100 text-slate-800' : 'bg-slate-950 text-slate-100'
    }`}>
      {/* Top Header */}
      <header className={`sticky top-0 z-40 backdrop-blur-md border-b px-4 py-3 max-w-md mx-auto flex items-center justify-between transition-colors ${
        isLight ? 'bg-white/90 border-slate-200 shadow-sm' : 'bg-slate-950/95 border-slate-800/80'
      }`}>
        <div className="flex items-center gap-2.5">
          <RootMapLogo className="w-8 h-8" showWordmark={true} />
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setTheme(prev => prev === 'dark' ? 'light' : 'dark')}
            className={`px-2 py-1 rounded-lg text-xs font-bold border transition ${
              isLight 
                ? 'bg-slate-100 text-slate-700 border-slate-300 hover:bg-slate-200' 
                : 'bg-slate-900 text-slate-300 border-slate-700 hover:bg-slate-800'
            }`}
          >
            {isLight ? '🌙 Dark' : '☀️ Light'}
          </button>

          <div className={`px-2.5 py-1 rounded-full text-xs font-black font-mono border ${
            totalNetDelta >= 0 
              ? isLight ? 'bg-emerald-50 text-emerald-700 border-emerald-300' : 'bg-emerald-950/80 text-emerald-400 border-emerald-700/60'
              : isLight ? 'bg-rose-50 text-rose-700 border-rose-300' : 'bg-rose-950/80 text-rose-400 border-rose-700/60'
          }`}>
            {totalNetDelta >= 0 ? `+${totalNetDelta.toFixed(1)}` : totalNetDelta.toFixed(1)}
          </div>
        </div>
      </header>

      {/* Main Container */}
      <main className="max-w-md mx-auto p-3 space-y-3">
        {syncStatus && (
          <div className="bg-purple-950/90 text-purple-200 border border-purple-700 px-3 py-2 rounded-xl text-xs font-mono font-bold text-center">
            {syncStatus}
          </div>
        )}

        {/* VIEW 1: MATCHUPS (DUEL BATTLEBOARD) */}
        {view === 'matchups' && (
          <div className="space-y-3">
            <div className="space-y-2">
              <div className="flex justify-between items-center px-1">
                <div className={`text-xs font-black uppercase tracking-wider ${isLight ? 'text-slate-700' : 'text-slate-300'}`}>
                  Week 7 Portfolio Grid
                </div>
                <div className={`text-[11px] font-mono font-bold ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>
                  {myPortfolio.length} Active • {oppThreats.length} Threats
                </div>
              </div>

              {/* Dynamic Filter Strip */}
              <div className="flex gap-1.5 overflow-x-auto pb-1 scrollbar-none text-[11px] font-bold">
                <button
                  onClick={() => setSortMode('exposure')}
                  className={`px-2.5 py-1 rounded-lg border whitespace-nowrap transition ${
                    sortMode === 'exposure'
                      ? isLight ? 'bg-slate-900 text-white border-slate-900 shadow-sm' : 'bg-slate-800 text-white border-slate-600 shadow-sm'
                      : isLight ? 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50' : 'bg-slate-900/60 text-slate-400 border-slate-800 hover:text-slate-200'
                  }`}
                >
                  ⚡ Exposure
                </button>
                <button
                  onClick={() => setSortMode('live')}
                  className={`px-2.5 py-1 rounded-lg border whitespace-nowrap transition ${
                    sortMode === 'live'
                      ? isLight ? 'bg-emerald-600 text-white border-emerald-600 shadow-sm' : 'bg-emerald-950 text-emerald-400 border-emerald-700 shadow-sm'
                      : isLight ? 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50' : 'bg-slate-900/60 text-slate-400 border-slate-800 hover:text-slate-200'
                  }`}
                >
                  🟢 Live On Field
                </button>
                <button
                  onClick={() => setSortMode('redzone')}
                  className={`px-2.5 py-1 rounded-lg border whitespace-nowrap transition ${
                    sortMode === 'redzone'
                      ? isLight ? 'bg-rose-600 text-white border-rose-600 shadow-sm' : 'bg-rose-950 text-rose-400 border-rose-700 shadow-sm'
                      : isLight ? 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50' : 'bg-slate-900/60 text-slate-400 border-slate-800 hover:text-slate-200'
                  }`}
                >
                  🔴 Red Zone
                </button>
                <button
                  onClick={() => setSortMode('conflict')}
                  className={`px-2.5 py-1 rounded-lg border whitespace-nowrap transition ${
                    sortMode === 'conflict'
                      ? isLight ? 'bg-amber-500 text-slate-900 border-amber-500 font-black shadow-sm' : 'bg-amber-950 text-amber-400 border-amber-700 shadow-sm'
                      : isLight ? 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50' : 'bg-slate-900/60 text-slate-400 border-slate-800 hover:text-slate-200'
                  }`}
                >
                  🔀 Conflicted First
                </button>
              </div>
            </div>

            {/* Split Column Headers */}
            <div className="grid grid-cols-2 gap-4 text-center text-xs font-black tracking-wider uppercase">
              <div className={`rounded-xl py-2 px-1 flex flex-col items-center justify-center border shadow-sm transition ${
                isLight ? 'bg-emerald-50 border-emerald-200 text-emerald-800' : 'bg-slate-900 border-emerald-500/30 text-emerald-400'
              }`}>
                <span>Your Portfolio</span>
                <span className={`text-[10px] font-normal ${isLight ? 'text-emerald-700' : 'text-slate-400'}`}>
                  ({myPortfolio.length} Active)
                </span>
              </div>
              <div className={`rounded-xl py-2 px-1 flex flex-col items-center justify-center border shadow-sm transition ${
                isLight ? 'bg-rose-50 border-rose-200 text-rose-800' : 'bg-slate-900 border-rose-500/30 text-rose-400'
              }`}>
                <span>Opposition Threats</span>
                <span className={`text-[10px] font-normal ${isLight ? 'text-rose-700' : 'text-slate-400'}`}>
                  ({oppThreats.length} Total)
                </span>
              </div>
            </div>

            {/* Duel Grid Relative Container for SVG Overlay */}
            <div ref={containerRef} className="relative">
              <svg className="pointer-events-none absolute inset-0 w-full h-full z-20 overflow-visible">
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
                        strokeOpacity={isHovered ? 1 : 0.75}
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
                          isLight
                            ? isConflict
                              ? isHovered
                                ? 'bg-amber-50 border-amber-400 ring-2 ring-amber-300'
                                : 'bg-white border-amber-300 hover:bg-amber-50/50'
                              : 'bg-white border-emerald-200 hover:border-emerald-300 hover:shadow'
                            : isConflict
                            ? isHovered
                              ? 'bg-amber-950/40 border-amber-400 ring-1 ring-amber-400'
                              : 'bg-amber-950/20 border-amber-500/50 hover:bg-amber-950/30'
                            : 'bg-emerald-950/20 border-emerald-500/40 hover:bg-emerald-950/30'
                        }`}
                      >
                        <div className="absolute -top-1.5 -right-1 flex gap-1 items-center">
                          {player.inRedZone && (
                            <span className="px-1.5 py-0.5 rounded text-[8px] font-black uppercase bg-rose-600 text-white tracking-wider shadow">
                              RZ
                            </span>
                          )}
                          {player.isLive && (
                            <span className="h-2 w-2 rounded-full bg-emerald-500 ring-2 ring-white" />
                          )}
                        </div>

                        <div className="flex items-start justify-between gap-1 mb-1">
                          <div className="truncate">
                            <div className={`font-black text-xs truncate leading-tight ${isLight ? 'text-slate-900' : 'text-white'}`}>
                              {player.name}
                            </div>
                            <div className={`text-[10px] font-bold flex items-center gap-1 mt-0.5 ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>
                              <span>{player.position} • {player.nflTeam}</span>
                              <span className={`font-mono text-[9px] px-1 py-0.2 rounded ${
                                player.isLive 
                                  ? isLight ? 'bg-emerald-100 text-emerald-800 font-bold' : 'bg-emerald-950/80 text-emerald-300' 
                                  : isLight ? 'text-slate-400' : 'text-slate-500'
                              }`}>
                                {player.gameClock}
                              </span>
                            </div>
                          </div>

                          <div className="text-right shrink-0">
                            <span className={`font-mono font-black text-xs ${isLight ? 'text-emerald-700' : 'text-emerald-400'}`}>
                              {player.points.toFixed(1)}
                            </span>
                            <span className={`text-[9px] font-bold ml-0.5 ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>pts</span>
                          </div>
                        </div>

                        {player.bigPlay && (
                          <div className="mb-1.5">
                            <span className={`inline-flex items-center px-1.5 py-0.2 rounded font-mono text-[9px] font-black border ${
                              isLight ? 'bg-amber-100 text-amber-800 border-amber-300' : 'bg-amber-500/20 text-amber-300 border-amber-500/40'
                            }`}>
                              ⚡ {player.bigPlay}
                            </span>
                          </div>
                        )}

                        <div className={`flex justify-between items-center text-[10px] pt-1.5 border-t font-mono ${
                          isLight ? 'border-slate-100' : 'border-slate-800/80'
                        }`}>
                          <span className={`font-bold ${isLight ? 'text-emerald-700' : 'text-emerald-400'}`}>
                            {player.myShares} {player.myShares === 1 ? 'LEAGUE' : 'LEAGUES'}
                          </span>
                          {isConflict ? (
                            <span className="text-amber-600 font-bold">v {player.oppShares} Opp</span>
                          ) : (
                            <span className={isLight ? 'text-slate-400' : 'text-slate-500'}>PURE</span>
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
                          isLight
                            ? isConflict
                              ? isHovered
                                ? 'bg-amber-50 border-amber-400 ring-2 ring-amber-300'
                                : 'bg-white border-amber-300 hover:bg-amber-50/50'
                              : 'bg-white border-rose-200 hover:border-rose-300 hover:shadow'
                            : isConflict
                            ? isHovered
                              ? 'bg-amber-950/40 border-amber-400 ring-1 ring-amber-400'
                              : 'bg-amber-950/20 border-amber-500/50 hover:bg-amber-950/30'
                            : 'bg-rose-950/20 border-rose-500/40 hover:bg-rose-950/30'
                        }`}
                      >
                        <div className="absolute -top-1.5 -left-1 flex gap-1 items-center">
                          {threat.inRedZone && (
                            <span className="px-1.5 py-0.5 rounded text-[8px] font-black uppercase bg-rose-600 text-white tracking-wider shadow">
                              RZ
                            </span>
                          )}
                          {threat.isLive && (
                            <span className="h-2 w-2 rounded-full bg-rose-500 ring-2 ring-white" />
                          )}
                        </div>

                        <div className="flex items-start justify-between gap-1 mb-1">
                          <div className="truncate">
                            <div className={`font-black text-xs truncate leading-tight ${isLight ? 'text-slate-900' : 'text-white'}`}>
                              {threat.name}
                            </div>
                            <div className={`text-[10px] font-bold flex items-center gap-1 mt-0.5 ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>
                              <span>{threat.position} • {threat.nflTeam}</span>
                              <span className={`font-mono text-[9px] px-1 py-0.2 rounded ${
                                threat.isLive 
                                  ? isLight ? 'bg-rose-100 text-rose-800 font-bold' : 'bg-rose-950/80 text-rose-300' 
                                  : isLight ? 'text-slate-400' : 'text-slate-500'
                              }`}>
                                {threat.gameClock}
                              </span>
                            </div>
                          </div>

                          <div className="text-right shrink-0">
                            <span className={`font-mono font-black text-xs ${isLight ? 'text-rose-700' : 'text-rose-400'}`}>
                              {threat.points.toFixed(1)}
                            </span>
                            <span className={`text-[9px] font-bold ml-0.5 ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>pts</span>
                          </div>
                        </div>

                        {threat.bigPlay && (
                          <div className="mb-1.5">
                            <span className={`inline-flex items-center px-1.5 py-0.2 rounded font-mono text-[9px] font-black border ${
                              isLight ? 'bg-amber-100 text-amber-800 border-amber-300' : 'bg-amber-500/20 text-amber-300 border-amber-500/40'
                            }`}>
                              ⚡ {threat.bigPlay}
                            </span>
                          </div>
                        )}

                        <div className={`flex justify-between items-center text-[10px] pt-1.5 border-t font-mono ${
                          isLight ? 'border-slate-100' : 'border-slate-800/80'
                        }`}>
                          <span className={`font-bold ${isLight ? 'text-rose-700' : 'text-rose-400'}`}>
                            {threat.oppShares} {threat.oppShares === 1 ? 'LEAGUE' : 'LEAGUES'}
                          </span>
                          {isConflict ? (
                            <span className="text-amber-600 font-bold">CONFLICTED ({threat.myShares}x)</span>
                          ) : (
                            <span className={isLight ? 'text-rose-700 font-bold' : 'text-rose-400 font-bold'}>THREAT</span>
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

        {/* VIEW 2: GAME SLATE */}
        {view === 'game-slate' && (
          <div className="space-y-3">
            <div className={`rounded-2xl p-3 border flex justify-between items-center shadow-sm ${
              isLight ? 'bg-white border-slate-200' : 'bg-slate-900 border-slate-800'
            }`}>
              <div>
                <div className={`text-xs font-black uppercase tracking-wide ${isLight ? 'text-emerald-700' : 'text-emerald-400'}`}>
                  Live NFL Scoreboard
                </div>
                <div className={`text-[11px] ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>
                  Real-time ESPN feed polling active game slates
                </div>
              </div>
              <div className="text-right">
                <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold border ${
                  isLight ? 'bg-emerald-50 text-emerald-700 border-emerald-300' : 'bg-emerald-950 text-emerald-400 border-emerald-800'
                }`}>
                  ● LIVE
                </span>
              </div>
            </div>

            {(games || []).map(game => {
              const activeMatchPlayers = getGamePlayers(game);
              return (
                <div key={game.id} className={`rounded-2xl overflow-hidden border shadow-sm ${
                  isLight ? 'bg-white border-slate-200' : 'bg-slate-900 border-slate-800'
                }`}>
                  <div className={`px-3.5 py-2.5 border-b flex justify-between items-center text-xs ${
                    isLight ? 'bg-slate-50 border-slate-200' : 'bg-slate-950 border-slate-800'
                  }`}>
                    <div className="flex items-center gap-2">
                      <span className={`font-bold ${isLight ? 'text-slate-900' : 'text-white'}`}>{game.away} @ {game.home}</span>
                      <span className={`font-mono text-[11px] ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>
                        ({game.awayScore || 0} - {game.homeScore || 0})
                      </span>
                    </div>
                    <span className={`text-[11px] font-bold ${
                      game.status?.includes('LIVE') 
                        ? isLight ? 'text-emerald-700' : 'text-emerald-400' 
                        : isLight ? 'text-slate-500' : 'text-slate-400'
                    }`}>
                      {game.status} • {game.time}
                    </span>
                  </div>

                  <div className={`divide-y p-1 ${isLight ? 'divide-slate-100' : 'divide-slate-800/60'}`}>
                    {activeMatchPlayers.length === 0 ? (
                      <div className="p-3 text-center text-xs text-slate-400 italic">
                        No portfolio starters active in this matchup
                      </div>
                    ) : (
                      activeMatchPlayers.map(player => (
                        <div
                          key={player.name}
                          onClick={() => setSelectedPlayer(player)}
                          className={`p-2.5 flex items-center justify-between cursor-pointer rounded-xl transition ${
                            isLight ? 'hover:bg-slate-50' : 'hover:bg-slate-800/40'
                          }`}
                        >
                          <div className="flex items-center gap-2.5">
                            {PlayerAvatar && (
                              <PlayerAvatar name={player.name} position={player.position} className="w-8 h-8" />
                            )}
                            <div>
                              <div className={`font-bold text-xs ${isLight ? 'text-slate-900' : 'text-white'}`}>{player.name}</div>
                              <div className={`text-[10px] ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>{player.position} • {player.nflTeam}</div>
                            </div>
                          </div>
                          <div className="text-right font-mono">
                            <div className={`text-xs font-black ${isLight ? 'text-emerald-700' : 'text-emerald-400'}`}>
                              {player.points.toFixed(1)} pts
                            </div>
                            <div className={`text-[10px] ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>
                              {player.myShares} {player.myShares === 1 ? 'League' : 'Leagues'}
                            </div>
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

        {/* VIEW 3: ALL LEAGUES & YAHOO SYNC CONTROL */}
        {view === 'all-leagues' && (
          <div className="space-y-3">
            {/* Sync Header Bar */}
            <div className={`p-4 rounded-2xl border flex flex-col gap-3 shadow-sm ${
              isLight ? 'bg-white border-slate-200' : 'bg-slate-900 border-slate-800'
            }`}>
              <div className="flex justify-between items-center">
                <div>
                  <div className={`font-black text-sm ${isLight ? 'text-slate-900' : 'text-white'}`}>
                    Platform Integration
                  </div>
                  <div className={`text-xs ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>
                    Sync all your Yahoo fantasy rosters automatically
                  </div>
                </div>
                <button
                  onClick={handleConnectYahoo}
                  disabled={isSyncing}
                  className="px-3.5 py-2 rounded-xl bg-purple-600 hover:bg-purple-500 active:scale-95 text-white text-xs font-black shadow-lg transition flex items-center gap-1.5"
                >
                  <span>⚡</span>
                  <span>{isSyncing ? 'Connecting...' : 'Connect Yahoo'}</span>
                </button>
              </div>
            </div>

            <div className={`text-xs font-black uppercase tracking-wider ${isLight ? 'text-slate-700' : 'text-slate-300'}`}>
              Connected Leagues ({leagues.length})
            </div>

            {leagues.map((lg) => (
              <div
                key={lg.id}
                onClick={() => setActiveLeagueDrawer(lg)}
                className={`rounded-2xl p-4 space-y-3 cursor-pointer border shadow-sm transition ${
                  isLight 
                    ? 'bg-white border-slate-200 hover:border-slate-300 hover:shadow' 
                    : 'bg-slate-900 border-slate-800 hover:border-slate-700'
                }`}
              >
                <div className="flex justify-between items-start">
                  <div>
                    <div className={`font-black text-base ${isLight ? 'text-slate-900' : 'text-white'}`}>{lg.name}</div>
                    <div className={`text-xs ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>vs {lg.opponent}</div>
                  </div>
                  <span className={`text-[10px] font-mono px-2 py-0.5 rounded-full font-bold border ${
                    isLight ? 'bg-purple-50 text-purple-700 border-purple-200' : 'bg-purple-950 text-purple-300 border-purple-800'
                  }`}>
                    {lg.platform}
                  </span>
                </div>
                <div className={`flex justify-between items-center pt-2 border-t text-xs ${
                  isLight ? 'border-slate-100 text-slate-500' : 'border-slate-800 text-slate-400'
                }`}>
                  <span>{lg.starters.length} Starters Synced</span>
                  <span className={`font-mono font-bold ${isLight ? 'text-slate-800' : 'text-slate-200'}`}>
                    {lg.myScore.toFixed(2)} - {lg.oppScore.toFixed(2)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>

      {/* Persistent Bottom Navigation */}
      <nav className={`fixed bottom-0 left-0 right-0 z-40 backdrop-blur-lg border-t max-w-md mx-auto transition-colors ${
        isLight ? 'bg-white/95 border-slate-200' : 'bg-slate-950/95 border-slate-800'
      }`}>
        <div className="grid grid-cols-3 py-2 px-3 gap-1">
          <button
            onClick={() => setView('matchups')}
            className={`py-2 flex flex-col items-center justify-center rounded-xl text-xs font-bold transition ${
              view === 'matchups' 
                ? isLight ? 'bg-emerald-50 text-emerald-700 shadow-sm' : 'bg-slate-800 text-emerald-400' 
                : isLight ? 'text-slate-500 hover:text-slate-800' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <span>⚔️ Matchups</span>
          </button>
          <button
            onClick={() => setView('game-slate')}
            className={`py-2 flex flex-col items-center justify-center rounded-xl text-xs font-bold transition ${
              view === 'game-slate' 
                ? isLight ? 'bg-emerald-50 text-emerald-700 shadow-sm' : 'bg-slate-800 text-emerald-400' 
                : isLight ? 'text-slate-500 hover:text-slate-800' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <span>🎮 Game Slate</span>
          </button>
          <button
            onClick={() => setView('all-leagues')}
            className={`py-2 flex flex-col items-center justify-center rounded-xl text-xs font-bold transition ${
              view === 'all-leagues' 
                ? isLight ? 'bg-emerald-50 text-emerald-700 shadow-sm' : 'bg-slate-800 text-emerald-400' 
                : isLight ? 'text-slate-500 hover:text-slate-800' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <span>🏆 All Leagues</span>
          </button>
        </div>
      </nav>

      {/* Unified Player Breakdown Drawer */}
      {selectedPlayer && (
        <div
          onClick={() => setSelectedPlayer(null)}
          className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-end justify-center"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className={`border-t sm:border rounded-t-3xl sm:rounded-3xl p-5 max-w-md w-full space-y-4 shadow-2xl transition-colors ${
              isLight ? 'bg-white border-slate-200' : 'bg-slate-900 border-slate-800'
            }`}
          >
            <div className={`w-12 h-1.5 rounded-full mx-auto ${isLight ? 'bg-slate-300' : 'bg-slate-700'}`} />
            
            <div className={`flex justify-between items-start border-b pb-3 ${isLight ? 'border-slate-100' : 'border-slate-800'}`}>
              <div>
                <h3 className={`text-lg font-black flex items-center gap-2 ${isLight ? 'text-slate-900' : 'text-white'}`}>
                  <span>{selectedPlayer.name}</span>
                  {selectedPlayer.bigPlay && (
                    <span className={`px-1.5 py-0.5 rounded text-xs font-mono font-black border ${
                      isLight ? 'bg-amber-100 text-amber-800 border-amber-300' : 'bg-amber-500/20 text-amber-300 border-amber-500/40'
                    }`}>
                      ⚡ {selectedPlayer.bigPlay}
                    </span>
                  )}
                </h3>
                <div className={`text-xs font-semibold flex items-center gap-2 mt-0.5 ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>
                  <span>{selectedPlayer.position} • {selectedPlayer.nflTeam}</span>
                  <span>•</span>
                  <span className={`font-mono font-bold ${isLight ? 'text-emerald-700' : 'text-emerald-400'}`}>
                    {selectedPlayer.points.toFixed(1)} PTS
                  </span>
                  <span>•</span>
                  <span className="font-mono">{selectedPlayer.gameClock}</span>
                </div>
              </div>
              <button
                onClick={() => setSelectedPlayer(null)}
                className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-sm ${
                  isLight ? 'bg-slate-100 text-slate-500 hover:bg-slate-200' : 'bg-slate-800 text-slate-400'
                }`}
              >
                ✕
              </button>
            </div>

            <div className={`p-3 rounded-xl border flex justify-between items-center text-xs ${
              isLight ? 'bg-slate-50 border-slate-200' : 'bg-slate-950 border-slate-800'
            }`}>
              <span className={`font-bold ${isLight ? 'text-slate-700' : 'text-slate-300'}`}>Portfolio Net Stance:</span>
              <span className={`font-mono font-black px-2.5 py-0.5 rounded-full border ${
                selectedPlayer.myShares > selectedPlayer.oppShares
                  ? isLight ? 'bg-emerald-100 text-emerald-800 border-emerald-300' : 'bg-emerald-950 text-emerald-400 border-emerald-800'
                  : selectedPlayer.myShares < selectedPlayer.oppShares
                  ? isLight ? 'bg-rose-100 text-rose-800 border-rose-300' : 'bg-rose-950 text-rose-400 border-rose-800'
                  : isLight ? 'bg-amber-100 text-amber-800 border-amber-300' : 'bg-amber-950 text-amber-400 border-amber-800'
              }`}>
                {selectedPlayer.myShares > selectedPlayer.oppShares
                  ? `ROOTING FOR (+${selectedPlayer.myShares - selectedPlayer.oppShares})`
                  : selectedPlayer.myShares < selectedPlayer.oppShares
                  ? `ROOTING AGAINST (-${selectedPlayer.oppShares - selectedPlayer.myShares})`
                  : 'PERFECTLY CONFLICTED (0)'}
              </span>
            </div>

            <div className="space-y-3">
              <div>
                <div className={`text-[11px] font-bold uppercase tracking-wider mb-1.5 flex justify-between ${
                  isLight ? 'text-emerald-700' : 'text-emerald-400'
                }`}>
                  <span>Your Roster ({selectedPlayer.myShares} Leagues)</span>
                  <span className={`text-[10px] ${isLight ? 'text-slate-400' : 'text-slate-500'}`}>ROOTING FOR</span>
                </div>
                {selectedPlayer.myShares > 0 ? (
                  <div className="space-y-1.5">
                    {selectedPlayer.myLeagues.map((item, i) => (
                      <div key={i} className={`rounded-xl px-3 py-2 text-xs flex justify-between items-center border ${
                        isLight ? 'bg-slate-50 border-slate-200 text-slate-800' : 'bg-slate-800/60 border-slate-700/50 text-slate-200'
                      }`}>
                        <span className="font-semibold">{item.league}</span>
                        <span className={`text-[10px] ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>vs {item.opponent}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className={`rounded-xl p-2.5 text-xs italic text-center border ${
                    isLight ? 'bg-slate-50 border-slate-200 text-slate-400' : 'bg-slate-950/40 border-slate-800/50 text-slate-500'
                  }`}>
                    Not rostered on any of your active teams
                  </div>
                )}
              </div>

              <div>
                <div className={`text-[11px] font-bold uppercase tracking-wider mb-1.5 flex justify-between ${
                  isLight ? 'text-rose-700' : 'text-rose-400'
                }`}>
                  <span>Opponent Starters ({selectedPlayer.oppShares} Leagues)</span>
                  <span className={`text-[10px] ${isLight ? 'text-slate-400' : 'text-slate-500'}`}>ROOTING AGAINST</span>
                </div>
                {selectedPlayer.oppShares > 0 ? (
                  <div className="space-y-1.5">
                    {selectedPlayer.oppLeagues.map((item, i) => (
                      <div key={i} className={`rounded-xl px-3 py-2 text-xs flex justify-between items-center border ${
                        isLight ? 'bg-slate-50 border-slate-200 text-slate-800' : 'bg-slate-800/60 border-slate-700/50 text-slate-200'
                      }`}>
                        <span className="font-semibold">{item.league}</span>
                        <span className={`text-[10px] font-bold ${isLight ? 'text-rose-700' : 'text-rose-400'}`}>
                          Started by {item.opponent}
                        </span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className={`rounded-xl p-2.5 text-xs italic text-center border ${
                    isLight ? 'bg-slate-50 border-slate-200 text-slate-400' : 'bg-slate-950/40 border-slate-800/50 text-slate-500'
                  }`}>
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
          className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-end justify-center"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className={`border-t sm:border rounded-t-3xl sm:rounded-3xl p-5 max-w-md w-full max-h-[80vh] flex flex-col shadow-2xl transition-colors ${
              isLight ? 'bg-white border-slate-200' : 'bg-slate-900 border-slate-800'
            }`}
          >
            <div className={`w-12 h-1.5 rounded-full mx-auto mb-3 ${isLight ? 'bg-slate-300' : 'bg-slate-700'}`} />
            <div className={`flex justify-between items-center border-b pb-3 ${isLight ? 'border-slate-100' : 'border-slate-800'}`}>
              <div>
                <h3 className={`text-base font-black ${isLight ? 'text-slate-900' : 'text-white'}`}>{activeLeagueDrawer.name}</h3>
                <div className={`text-xs ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>vs {activeLeagueDrawer.opponent}</div>
              </div>
              <button
                onClick={() => setActiveLeagueDrawer(null)}
                className={`w-7 h-7 rounded-full flex items-center justify-center font-bold text-xs ${
                  isLight ? 'bg-slate-100 text-slate-500 hover:bg-slate-200' : 'bg-slate-800 text-slate-400'
                }`}
              >
                ✕
              </button>
            </div>
            <div className="overflow-y-auto space-y-2 py-3">
              {activeLeagueDrawer.starters.map((p, idx) => (
                <div key={idx} className={`rounded-xl p-2.5 flex justify-between items-center text-xs border ${
                  isLight ? 'bg-slate-50 border-slate-200' : 'bg-slate-800/60 border-slate-700/40'
                }`}>
                  <div className="flex items-center gap-2">
                    <span className={`font-mono text-[10px] px-1.5 py-0.5 rounded font-bold ${
                      isLight ? 'bg-slate-200 text-slate-700' : 'bg-slate-700 text-slate-300'
                    }`}>
                      {p.slot}
                    </span>
                    <span className={`font-bold ${isLight ? 'text-slate-900' : 'text-white'}`}>{p.name}</span>
                    <span className={`text-[11px] ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>{p.nflTeam}</span>
                  </div>
                  <span className={`font-mono font-bold ${isLight ? 'text-emerald-700' : 'text-emerald-400'}`}>{p.points} pts</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
