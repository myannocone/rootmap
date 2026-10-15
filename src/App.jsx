import React, { useState } from 'react';
import { mockGames as initialGames, mockH2H as initialH2H } from './data/mockSlate';

export default function App() {
  const [view, setView] = useState('linear');
  const [filter, setFilter] = useState('all');
  const [games, setGames] = useState(initialGames);
  const [h2hData, setH2hData] = useState(initialH2H);
  const [selectedPlayerId, setSelectedPlayerId] = useState('barkley');
  const [drawerPlayer, setDrawerPlayer] = useState(null);
  const [recentFlash, setRecentFlash] = useState(null);

  // Synchronized Scoring Engine
  const handleSimulatePlay = (ptsDelta, label) => {
    setGames(prevGames =>
      prevGames.map(game => ({
        ...game,
        players: game.players.map(p => {
          if (p.id === selectedPlayerId) {
            const updatedPts = Math.max(0, +(p.pts + ptsDelta).toFixed(1));
            return { ...p, pts: updatedPts };
          }
          return p;
        })
      }))
    );

    setH2hData(prev => ({
      myRoster: prev.myRoster.map(p => 
        p.id === selectedPlayerId ? { ...p, pts: Math.max(0, +(p.pts + ptsDelta).toFixed(1)) } : p
      ),
      opponents: prev.opponents.map(p => 
        p.id === selectedPlayerId ? { ...p, pts: Math.max(0, +(p.pts + ptsDelta).toFixed(1)) } : p
      )
    }));

    setRecentFlash({ id: selectedPlayerId, label, delta: ptsDelta });
    setTimeout(() => setRecentFlash(null), 1800);
  };

  const linearPlayers = games.flatMap(g => g.players);
  const allSelectable = [
    ...linearPlayers,
    ...h2hData.opponents.filter(o => !linearPlayers.some(lp => lp.id === o.id)).map(o => ({
      id: o.id,
      name: o.name,
      team: 'OPP',
      pos: o.pos,
      pts: o.pts
    }))
  ];
  const activePlayer = allSelectable.find(p => p.id === selectedPlayerId) || allSelectable[0];

  const totalMyPts = h2hData.myRoster.reduce((sum, p) => sum + p.pts, 0).toFixed(1);
  const totalMyProj = h2hData.myRoster.reduce((sum, p) => sum + p.proj, 0).toFixed(1);
  const totalOppPts = h2hData.opponents.reduce((sum, p) => sum + p.pts, 0).toFixed(1);
  const totalOppProj = h2hData.opponents.reduce((sum, p) => sum + p.proj, 0).toFixed(1);
  const netMargin = (totalMyPts - totalOppPts).toFixed(1);

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100 pb-36 font-sans antialiased selection:bg-emerald-500 selection:text-white">
      {/* Top Header */}
      <header className="sticky top-0 z-30 bg-slate-950/90 backdrop-blur border-b border-slate-800 px-4 py-3 shadow-md flex items-center justify-between">
        <div>
          <h1 className="text-xl font-black tracking-tight text-white flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse"></span>
            ROOTMAP
          </h1>
          <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">Net Rooting Leverage</p>
        </div>
        <button 
          onClick={() => setFilter(f => f === 'all' ? 'mine' : f === 'mine' ? 'opp' : 'all')}
          className="px-3 py-1.5 text-xs font-bold rounded-lg border border-slate-700 bg-slate-800 hover:bg-slate-700 text-slate-300 transition"
        >
          Scope: {filter.toUpperCase()}
        </button>
      </header>

      {/* Floating Simulation Dock */}
      <section className="max-w-md mx-auto px-4 pt-4">
        <div className="bg-slate-800/90 border border-slate-700 rounded-xl p-3 shadow-lg">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[11px] font-extrabold uppercase tracking-wider text-slate-400">Live Simulator</span>
            <select
              value={selectedPlayerId}
              onChange={(e) => setSelectedPlayerId(e.target.value)}
              className="bg-slate-950 text-emerald-400 border border-slate-700 text-xs font-bold rounded px-2 py-1 outline-none focus:ring-1 focus:ring-emerald-500"
            >
              {allSelectable.map(p => (
                <option key={p.id} value={p.id}>
                  {p.name} ({p.team || p.pos}) - {p.pts} pts
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-4 gap-1.5">
            <button
              onClick={() => handleSimulatePlay(1.5, '+15 yd rush')}
              className="py-1.5 px-1 bg-slate-700/70 hover:bg-slate-600 rounded text-[11px] font-bold text-slate-200 transition active:scale-95"
            >
              +15y Run
            </button>
            <button
              onClick={() => handleSimulatePlay(2.5, '+25 yd pass')}
              className="py-1.5 px-1 bg-slate-700/70 hover:bg-slate-600 rounded text-[11px] font-bold text-slate-200 transition active:scale-95"
            >
              +25y Pass
            </button>
            <button
              onClick={() => handleSimulatePlay(6.0, 'Touchdown!')}
              className="py-1.5 px-1 bg-emerald-600/80 hover:bg-emerald-500 rounded text-[11px] font-black text-white transition active:scale-95 shadow-sm shadow-emerald-950"
            >
              +6 TD
            </button>
            <button
              onClick={() => handleSimulatePlay(-2.0, 'Turnover')}
              className="py-1.5 px-1 bg-rose-600/80 hover:bg-rose-500 rounded text-[11px] font-black text-white transition active:scale-95 shadow-sm shadow-rose-950"
            >
              -2 TO
            </button>
          </div>

          {recentFlash && (
            <div className="mt-2 text-center text-xs font-bold text-emerald-400 animate-bounce">
              ⚡ {activePlayer?.name}: {recentFlash.label} ({recentFlash.delta > 0 ? `+${recentFlash.delta}` : recentFlash.delta} pts)
            </div>
          )}
        </div>
      </section>

      {/* Main View Area */}
      <main className="max-w-md mx-auto p-4 space-y-4">
        {view === 'linear' ? (
          /* Linear Slate View */
          <div className="space-y-4">
            {games.map(game => (
              <div key={game.id} className="bg-slate-800/80 rounded-xl border border-slate-700/80 shadow-md overflow-hidden">
                <div className="bg-slate-950/60 px-3.5 py-2 border-b border-slate-700/80 flex justify-between items-center text-xs font-semibold text-slate-400">
                  <span className="font-bold text-slate-300">{game.away} @ {game.home}</span>
                  <span className={game.status.includes('LIVE') ? 'text-emerald-400 font-bold' : ''}>
                    {game.status} • {game.time}
                  </span>
                </div>
                <div className="divide-y divide-slate-700/50">
                  {game.players.map(player => {
                    const isTarget = player.id === selectedPlayerId;
                    const isFlashing = recentFlash?.id === player.id;
                    return (
                      <div 
                        key={player.id} 
                        onClick={() => {
                          setSelectedPlayerId(player.id);
                          setDrawerPlayer(player);
                        }}
                        className={`p-3.5 flex items-center justify-between cursor-pointer transition ${
                          isTarget ? 'bg-slate-700/30' : 'hover:bg-slate-700/20'
                        } ${isFlashing ? 'ring-2 ring-emerald-500 ring-inset bg-emerald-950/20' : ''}`}
                      >
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-bold text-white hover:text-emerald-400 transition">{player.name}</span>
                            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-slate-700 text-slate-300">
                              {player.team} - {player.pos}
                            </span>
                          </div>
                          <div className="text-xs text-slate-400 mt-0.5 flex items-center gap-1.5">
                            <span>{player.leaguesSummary}</span>
                            <span className="text-[10px] text-emerald-400 font-bold border-b border-dotted border-emerald-500">View Leagues →</span>
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="text-sm font-black text-slate-200">
                            {player.pts} <span className="text-[10px] font-normal text-slate-400">pts</span>
                          </div>
                          <span className={`inline-block text-xs font-black px-2 py-0.5 rounded-full mt-1 ${
                            player.exposureColor === 'green' 
                              ? 'bg-emerald-950 text-emerald-400 border border-emerald-700' 
                              : 'bg-rose-950 text-rose-400 border border-rose-700'
                          }`}>
                            {player.exposure}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        ) : (
          /* H2H Matchups View */
          <div className="space-y-4">
            <div className="bg-slate-950 border border-slate-800 rounded-xl p-4 shadow-lg">
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
                <span className="text-slate-400 font-semibold">Net Slate Spread:</span>
                <span className={`font-black px-2 py-0.5 rounded ${
                  netMargin >= 0 
                    ? 'bg-emerald-950 text-emerald-400 border border-emerald-800' 
                    : 'bg-rose-950 text-rose-400 border border-rose-800'
                }`}>
                  {netMargin >= 0 ? `+${netMargin}` : netMargin} pts
                </span>
              </div>
            </div>

            {/* My Starters */}
            <div className="bg-slate-800/80 rounded-xl border border-slate-700 p-4 shadow-sm">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-xs font-bold uppercase tracking-wider text-emerald-400">Portfolio Starters</h2>
                <span className="text-xs font-black text-slate-300">{totalMyPts} pts total</span>
              </div>
              <div className="space-y-2">
                {h2hData.myRoster.map((player) => {
                  const isTarget = player.id === selectedPlayerId;
                  const isFlashing = recentFlash?.id === player.id;
                  return (
                    <div 
                      key={player.id}
                      onClick={() => {
                        setSelectedPlayerId(player.id);
                        setDrawerPlayer(player);
                      }}
                      className={`flex justify-between items-center p-2.5 rounded-lg border cursor-pointer transition ${
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
                        <div className="text-[11px] text-slate-400 mt-0.5 flex items-center gap-1.5">
                          <span>{player.league}</span>
                          <span className="text-[10px] text-emerald-400 font-bold border-b border-dotted border-emerald-500">Breakdown →</span>
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="text-sm font-black text-emerald-400">{player.pts} pts</div>
                        <span className="text-[10px] text-slate-400 font-semibold">{player.proj} proj</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Opponents */}
            <div className="bg-slate-800/80 rounded-xl border border-slate-700 p-4 shadow-sm">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-xs font-bold uppercase tracking-wider text-rose-400">Opposition Threats</h2>
                <span className="text-xs font-black text-slate-300">{totalOppPts} pts total</span>
              </div>
              <div className="space-y-2">
                {h2hData.opponents.map((player) => {
                  const isTarget = player.id === selectedPlayerId;
                  const isFlashing = recentFlash?.id === player.id;
                  return (
                    <div 
                      key={player.id}
                      onClick={() => setSelectedPlayerId(player.id)}
                      className={`flex justify-between items-center p-2.5 rounded-lg border cursor-pointer transition ${
                        isTarget ? 'bg-rose-950/40 border-rose-800' : 'bg-rose-950/20 border-rose-900/30 hover:bg-rose-950/30'
                      } ${isFlashing ? 'ring-2 ring-rose-500 bg-rose-950/40' : ''}`}
                    >
                      <div>
                        <span className="text-sm font-bold text-slate-100">{player.name} ({player.pos})</span>
                        <div className="text-[10px] text-slate-400">{player.league} • {player.proj} proj</div>
                      </div>
                      <div className="text-right">
                        <div className="text-sm font-black text-rose-400">{player.pts} pts</div>
                        <span className="text-[10px] text-slate-400">Threat</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </main>

      {/* Slide-Up League Details Drawer */}
      {drawerPlayer && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-end justify-center p-0 sm:p-4 animate-in fade-in">
          <div className="bg-slate-900 border border-slate-700 w-full max-w-md rounded-t-2xl sm:rounded-2xl p-5 shadow-2xl space-y-4 max-h-[85vh] overflow-y-auto">
            <div className="flex justify-between items-start border-b border-slate-800 pb-3">
              <div>
                <h3 className="text-lg font-black text-white flex items-center gap-2">
                  {drawerPlayer.name}
                  <span className="text-xs font-bold px-2 py-0.5 rounded bg-slate-800 text-slate-300">
                    {drawerPlayer.team} - {drawerPlayer.pos}
                  </span>
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">League Portfolio Breakdown</p>
              </div>
              <button 
                onClick={() => setDrawerPlayer(null)}
                className="w-8 h-8 rounded-full bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white flex items-center justify-center font-bold text-sm"
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
              onClick={() => setDrawerPlayer(null)}
              className="w-full py-2.5 bg-slate-800 hover:bg-slate-700 rounded-xl text-xs font-bold text-slate-200 transition"
            >
              Close Ledger
            </button>
          </div>
        </div>
      )}

      {/* Bottom Sticky Navigation */}
      <nav className="fixed bottom-0 inset-x-0 bg-slate-950/95 backdrop-blur border-t border-slate-800 px-6 py-3.5 flex justify-around items-center z-40 shadow-2xl">
        <button
          onClick={() => setView('linear')}
          className={`flex flex-col items-center gap-1 ${view === 'linear' ? 'text-emerald-400' : 'text-slate-500 hover:text-slate-300'}`}
        >
          <span className="text-xs font-bold">Linear Slate</span>
        </button>
        <div className="h-5 w-px bg-slate-800" />
        <button
          onClick={() => setView('h2h')}
          className={`flex flex-col items-center gap-1 ${view === 'h2h' ? 'text-emerald-400' : 'text-slate-500 hover:text-slate-300'}`}
        >
          <span className="text-xs font-bold">H2H Portfolio</span>
        </button>
      </nav>
    </div>
  );
}
