import React, { useState } from 'react';

const availablePlatforms = [
  { id: 'sleeper', name: 'Sleeper', icon: '⚡' },
  { id: 'yahoo', name: 'Yahoo', icon: '🟣' },
  { id: 'espn', name: 'ESPN', icon: '🔴' }
];

export default function ConnectModal({ isOpen, onClose, onAddLeague }) {
  const [selectedPlatform, setSelectedPlatform] = useState('Sleeper');
  const [leagueInputId, setLeagueInputId] = useState('');

  if (!isOpen) return null;

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!leagueInputId.trim()) return;
    const cleanId = leagueInputId.trim();
    const newLeague = {
      id: 'custom_' + Date.now(),
      name: selectedPlatform + ' League #' + cleanId.slice(-4),
      platform: selectedPlatform,
      myTeam: 'My Roster',
      myScore: 0.0,
      oppTeam: 'Opponent Squad',
      oppScore: 0.0,
      status: 'SYNCED',
      projSpread: '0.0'
    };
    onAddLeague(newLeague);
    setLeagueInputId('');
    onClose();
  };

  return (
    <div 
      onClick={onClose}
      className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4"
    >
      <div 
        onClick={(e) => e.stopPropagation()}
        className="bg-slate-900 border border-slate-700 w-full max-w-[400px] rounded-t-3xl sm:rounded-3xl p-5 shadow-2xl space-y-4"
      >
        <div className="flex justify-between items-center border-b border-slate-800 pb-3">
          <div>
            <h3 className="text-base font-black text-white">Connect Fantasy League</h3>
            <p className="text-[11px] text-slate-400">Sync rosters & live scoring feeds</p>
          </div>
          <button 
            onClick={onClose}
            className="w-7 h-7 rounded-full bg-slate-800 hover:bg-slate-700 text-slate-400 flex items-center justify-center font-bold text-xs"
          >
            ✕
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="text-xs font-bold text-slate-300 block mb-1.5">Select Platform</label>
            <div className="grid grid-cols-3 gap-2">
              {availablePlatforms.map(p => (
                <button
                  type="button"
                  key={p.id}
                  onClick={() => setSelectedPlatform(p.name)}
                  className={`py-2 px-1 text-center rounded-xl border text-xs font-bold transition flex flex-col items-center gap-1 ${
                    selectedPlatform === p.name 
                      ? 'bg-emerald-950/60 border-emerald-500 text-emerald-400' 
                      : 'bg-slate-800/60 border-slate-700 text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <span className="text-sm">{p.icon}</span>
                  <span>{p.name}</span>
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="text-xs font-bold text-slate-300 block mb-1.5">League ID or Public Username</label>
            <input
              type="text"
              value={leagueInputId}
              onChange={(e) => setLeagueInputId(e.target.value)}
              placeholder="e.g., 104859203"
              className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500"
            />
          </div>

          <div className="flex gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-2.5 bg-slate-800 hover:bg-slate-700 rounded-xl text-xs font-bold text-slate-300 transition"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="flex-1 py-2.5 bg-emerald-500 hover:bg-emerald-400 text-slate-950 rounded-xl text-xs font-black transition"
            >
              Sync League
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}