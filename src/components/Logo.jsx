import React from 'react';

export default function RootMapLogo({ className = "w-8 h-8", showWordmark = false }) {
  return (
    <div className="flex items-center gap-2">
      <svg
        viewBox="0 0 100 100"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className={className}
      >
        <defs>
          <linearGradient id="rmPlate" x1="0" y1="0" x2="100" y2="100" gradientUnits="userSpaceOnUse">
            <stop stopColor="#0f172a" />
            <stop offset="1" stopColor="#020617" />
          </linearGradient>
          <linearGradient id="rmRoute" x1="15" y1="20" x2="85" y2="80" gradientUnits="userSpaceOnUse">
            <stop stopColor="#34d399" />
            <stop offset="0.6" stopColor="#10b981" />
            <stop offset="1" stopColor="#059669" />
          </linearGradient>
        </defs>
        <rect x="4" y="4" width="92" height="92" rx="22" fill="url(#rmPlate)" stroke="#1e293b" strokeWidth="2" />
        <path d="M 28 78 L 28 26 L 50 26 C 62 26 62 44 50 44 L 28 44" stroke="url(#rmRoute)" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M 44 44 L 62 78 M 62 38 L 74 26 L 74 78" stroke="url(#rmRoute)" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx="28" cy="26" r="4" fill="#a7f3d0" />
        <circle cx="50" cy="26" r="3.5" fill="#10b981" />
        <circle cx="50" cy="44" r="3.5" fill="#10b981" />
        <circle cx="28" cy="78" r="4" fill="#10b981" />
        <circle cx="62" cy="78" r="4.5" fill="#34d399" />
        <circle cx="74" cy="26" r="3.5" fill="#10b981" />
        <circle cx="74" cy="78" r="4" fill="#10b981" />
      </svg>
      {showWordmark && (
        <span className="font-black text-lg tracking-tight bg-gradient-to-r from-white via-slate-200 to-slate-400 bg-clip-text text-transparent">
          Root<span className="text-emerald-400">Map</span>
        </span>
      )}
    </div>
  );
}
