import React from 'react';

export default function SyncInspector({ data, onClose }) {
  if (!data) return null;
  return (
    <div className="bg-slate-900 border border-purple-500 rounded-2xl p-3 space-y-2">
      <div className="flex justify-between items-center text-xs font-bold text-purple-400">
        <span>Yahoo Response Payload:</span>
        <button onClick={onClose} className="text-slate-400 hover:text-white px-2">✕</button>
      </div>
      <pre className="text-[10px] font-mono text-slate-300 bg-slate-950 p-2 rounded-xl overflow-x-auto max-h-48 border border-slate-800">
        {JSON.stringify(data, null, 2)}
      </pre>
    </div>
  );
}
