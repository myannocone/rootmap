import React from 'react';

export default function SyncInspector({ data, onClose }) {
  if (!data) return null;

  let parsedDetails = null;
  if (data.details) {
    try {
      parsedDetails = typeof data.details === 'string' ? JSON.parse(data.details) : data.details;
    } catch {
      parsedDetails = data.details;
    }
  }

  const errorMessage = parsedDetails?.error?.description 
    || parsedDetails?.error 
    || (typeof parsedDetails === 'string' ? parsedDetails : null)
    || data.error;

  return (
    <div className="bg-slate-900 border border-purple-500 rounded-2xl p-4 space-y-3">
      <div className="flex justify-between items-center text-xs font-bold text-purple-400">
        <span>Yahoo Diagnostic Message:</span>
        <button onClick={onClose} className="text-slate-400 hover:text-white px-2">✕</button>
      </div>

      {errorMessage && (
        <div className="bg-rose-950/80 border border-rose-700/60 text-rose-200 text-xs font-mono p-3 rounded-xl">
          <strong>Error Description:</strong> {typeof errorMessage === 'object' ? JSON.stringify(errorMessage) : errorMessage}
        </div>
      )}

      <div className="text-[10px] text-slate-400 font-mono">
        <strong>Raw Details:</strong>
        <pre className="text-slate-300 bg-slate-950 p-2 rounded-xl overflow-x-auto max-h-40 border border-slate-800 mt-1 select-all">
          {typeof parsedDetails === 'object' ? JSON.stringify(parsedDetails, null, 2) : String(data.details || JSON.stringify(data, null, 2))}
        </pre>
      </div>
    </div>
  );
}
