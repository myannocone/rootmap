import React, { useState } from 'react';
import { mockGames, mockH2H } from './data/mockSlate';

export default function App() {
  const [view, setView] = useState('linear');
  const [filter, setFilter] = useState('all');

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 pb-24 font-sans antialiased">
      {/* Header */}
      <header className="sticky top-0 z-30 bg-white/95 backdrop-blur border-b border-slate-200 px-4 py-3 shadow-sm flex items-center justify-between">
        <div>
          <h1 className="text-xl font-black tracking-tight text-slate-950 flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse"></span>
            ROOTMAP
          </h1>
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Sunday Live Slate</p>
        </div>
        <button 
          onClick={() => setFilter(f => f === 'all' ? 'mine' : f === 'mine' ? 'opp' : 'all')}
          className="px-3 py-1.5 text-xs font-bold rounded-lg border border-slate-200 bg-slate-100 hover:bg-slate-200 text-slate-700 transition"
        >
          Filter: {filter.toUpperCase()}
        </button>
      </header>

      {/* Main View Container */}
      <main className="max-w-md mx-auto p-4 space-y-4">
        {view === 'linear' ? (
          /* Linear Portfolio Slate */
          <div className="space-y-4">
            {mockGames.map(game => (
              <div key={game.id} className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
                <div className="bg-slate-100 px-3.5 py-2 border-b border-slate-200 flex justify-between items-center text-xs font-semibold text-slate-600">
                  <span>{game.away} @ {game.home}</span>
                  <span className={game.status.includes('LIVE') ? 'text-emerald-600 font-bold' : ''}>
                    {game.status} • {game.time}
                  </span>
                </div>
                <div className="divide-y divide-slate-100">
                  {game.players.map(player => (
                    <div key={player.id} className="p-3.5 flex items-center justify-between">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-bold text-slate-900">{player.name}</span>
                          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-slate-100 text-slate-600">
                            {player.team} - {player.pos}
                          </span>
                        </div>
                        <div className="text-xs text-slate-500 mt-0.5">{player.leagues}</div>
                      </div>
                      <div className="text-right">
                        <div className="text-xs font-semibold text-slate-500">{player.pts} pts</div>
                        <span className={`inline-block text-xs font-black px-2 py-0.5 rounded-full mt-1 ${
                          player.exposureColor === 'green' 
                            ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' 
                            : 'bg-rose-50 text-rose-700 border border-rose-200'
                        }`}>
                          {player.exposure}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        ) : (
          /* H2H Matchups Grid */
          <div className="space-y-4">
            <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm">
              <h2 className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-3">Portfolio Starters</h2>
              <div className="space-y-2">
                {mockH2H.myRoster.map((player, idx) => (
                  <div key={idx} className="flex justify-between items-center p-2 rounded-lg bg-slate-50 border border-slate-100">
                    <span className="text-sm font-bold text-slate-800">{player.name} ({player.pos})</span>
                    <span className="text-xs font-semibold text-emerald-600">{player.proj} proj</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm">
              <h2 className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-3">Opposition Threats</h2>
              <div className="space-y-2">
                {mockH2H.opponents.map((player, idx) => (
                  <div key={idx} className="flex justify-between items-center p-2 rounded-lg bg-rose-50/50 border border-rose-100">
                    <div>
                      <span className="text-sm font-bold text-slate-800">{player.name} ({player.pos})</span>
                      <div className="text-[10px] text-slate-500">{player.league}</div>
                    </div>
                    <span className="text-xs font-semibold text-rose-600">{player.proj} proj</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </main>

      {/* Bottom Sticky Navigation */}
      <nav className="fixed bottom-0 inset-x-0 bg-white border-t border-slate-200 px-6 py-3 flex justify-around items-center z-40 shadow-lg">
        <button
          onClick={() => setView('linear')}
          className={`flex flex-col items-center gap-1 ${view === 'linear' ? 'text-emerald-600' : 'text-slate-400 hover:text-slate-600'}`}
        >
          <span className="text-xs font-bold">Linear Slate</span>
        </button>
        <div className="h-5 w-px bg-slate-200" />
        <button
          onClick={() => setView('h2h')}
          className={`flex flex-col items-center gap-1 ${view === 'h2h' ? 'text-emerald-600' : 'text-slate-400 hover:text-slate-600'}`}
        >
          <span className="text-xs font-bold">H2H Portfolio</span>
        </button>
      </nav>
    </div>
  );
}