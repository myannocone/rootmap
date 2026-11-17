import React from 'react';

/**
 * RootMap brand mark from /logo.png (stadium-route R + wordmark).
 */
export default function RootMapLogo({
  className = 'w-8 h-8',
  showWordmark = false,
  alt = 'RootMap'
}) {
  return (
    <div className="flex items-center gap-2 min-w-0">
      <img
        src="/logo.png"
        alt={alt}
        draggable={false}
        className={`object-contain shrink-0 select-none ${className}`}
      />
      {showWordmark && (
        <span className="font-extrabold text-xl tracking-tight bg-gradient-to-r from-white via-slate-200 to-slate-400 bg-clip-text text-transparent">
          Root<span className="text-emerald-400">Map</span>
        </span>
      )}
    </div>
  );
}
