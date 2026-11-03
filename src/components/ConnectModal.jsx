import React, { useState } from 'react';
import { openYahooLogin } from '../utils/openYahooLogin';

export default function ConnectModal({ isOpen, onClose, onAddLeague }) {
  const [platform, setPlatform] = useState('yahoo');
  const [leagueName, setLeagueName] = useState('');
  const [opponentName, setOpponentName] = useState('');

  if (!isOpen) return null;

  const handleYahooLogin = () => {
    openYahooLogin();
  };

  const handleManualAdd = (e) => {
    e.preventDefault();
    if (!leagueName.trim()) return;

    if (typeof onAddLeague === 'function') {
      onAddLeague({
        id: `manual_${Date.now()}`,
        name: leagueName.trim(),
        platform: platform === 'espn' ? 'ESPN' : 'Custom',
        opponentName: opponentName.trim() || 'Opponent',
        userPoints: 0,
        oppPoints: 0,
        starters: []
      });
    }

    setLeagueName('');
    setOpponentName('');
    if (typeof onClose === 'function') onClose();
  };

  return (
    <div 
      className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={() => { if (typeof onClose === 'function') onClose(); }}
    >
      <div 
        onClick={(e) => e.stopPropagation()}
        className="bg-slate-900 border border-slate-700/80 rounded-3xl p-6 max-w-sm w-full space-y-5 shadow-2xl"
      >
        <div className="flex justify-between items-center border-b border-slate-800 pb-3">
          <h3 className="text-base font-black text-white">Link Fantasy Platform</h3>
          <button
            type="button"
            onClick={() => { if (typeof onClose === 'function') onClose(); }}
            className="w-7 h-7 rounded-full bg-slate-800 hover:bg-slate-700 text-slate-400 flex items-center justify-center font-bold text-xs"
          >
            ✕
          </button>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => setPlatform('yahoo')}
            className={`py-2 px-3 rounded-xl text-xs font-bold border transition ${
              platform === 'yahoo' 
                ? 'bg-purple-950/60 border-purple-500 text-purple-300 shadow-sm' 
                : 'bg-slate-800/40 border-slate-700 text-slate-400 hover:text-slate-200'
            }`}
          >
            🟣 Yahoo Sports
          </button>
          <button
            type="button"
            onClick={() => setPlatform('espn')}
            className={`py-2 px-3 rounded-xl text-xs font-bold border transition ${
              platform === 'espn' 
                ? 'bg-red-950/60 border-red-500 text-red-300 shadow-sm' 
                : 'bg-slate-800/40 border-slate-700 text-slate-400 hover:text-slate-200'
            }`}
          >
            🔴 ESPN / Custom
          </button>
        </div>

        {platform === 'yahoo' ? (
          <div className="space-y-4 py-2">
            <p className="text-xs text-slate-400 leading-relaxed">
              Connect your Yahoo account directly via OAuth 2.0 to automatically import all active 2026 fantasy football leagues and starters.
            </p>
            <button
              type="button"
              onClick={handleYahooLogin}
              className="w-full py-3 bg-purple-600 hover:bg-purple-500 text-white font-bold rounded-xl text-xs transition flex items-center justify-center gap-2 shadow-lg shadow-purple-600/30"
            >
              <span>Sign in with Yahoo</span>
              <span>→</span>
            </button>
          </div>
        ) : (
          <form onSubmit={handleManualAdd} className="space-y-3">
            <div>
              <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block mb-1">
                League Name
              </label>
              <input
                type="text"
                placeholder="e.g. ESPN Championship League"
                value={leagueName}
                onChange={(e) => setLeagueName(e.target.value)}
                className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-xl text-xs text-white placeholder-slate-500 focus:outline-none focus:border-red-500"
              />
            </div>
            <div>
              <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block mb-1">
                Opponent Name
              </label>
              <input
                type="text"
                placeholder="e.g. Team Gelardi"
                value={opponentName}
                onChange={(e) => setOpponentName(e.target.value)}
                className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-xl text-xs text-white placeholder-slate-500 focus:outline-none focus:border-red-500"
              />
            </div>
            <button
              type="submit"
              className="w-full py-2.5 bg-red-600 hover:bg-red-500 text-white font-bold rounded-xl text-xs transition mt-2 shadow-lg shadow-red-600/30"
            >
              Add League
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
