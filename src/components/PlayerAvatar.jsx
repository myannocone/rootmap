import React, { useState } from 'react';
import { getPlayerHeadshotUrl } from '../services/sleeperApi';

export default function PlayerAvatar({ playerId, name, position, className = "w-10 h-10" }) {
  const [hasError, setHasError] = useState(false);
  const headshotUrl = playerId ? getPlayerHeadshotUrl(playerId) : null;

  // Fallback initials (e.g. "Saquon Barkley" -> "SB")
  const initials = name
    ? name
        .split(' ')
        .map(n => n[0])
        .join('')
        .slice(0, 2)
        .toUpperCase()
    : position || 'FB';

  if (!headshotUrl || hasError) {
    return (
      <div className={`${className} rounded-full bg-slate-800 border border-slate-700 flex items-center justify-center font-black text-slate-300 text-xs shrink-0 select-none`}>
        {initials}
      </div>
    );
  }

  return (
    <div className={`${className} rounded-full bg-slate-800 border border-slate-700 overflow-hidden shrink-0 flex items-center justify-center`}>
      <img
        src={headshotUrl}
        alt={name || 'Player'}
        onError={() => setHasError(true)}
        className="w-full h-full object-cover object-top"
        loading="lazy"
      />
    </div>
  );
}