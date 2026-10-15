import { useMemo, useState } from 'react'

const ESPN = 'https://a.espncdn.com/i/headshots/nfl/players/full'
const TEAM = 'https://a.espncdn.com/i/teamlogos/nfl/500'

const players = {
  barkley: {
    id: 'barkley',
    name: 'S. BARKLEY',
    pos: 'RB',
    team: 'PHI',
    photo: `${ESPN}/3929630.png`,
    leagues: 3,
    vsOpps: 4,
  },
  jefferson: {
    id: 'jefferson',
    name: 'J. JEFFERSON',
    pos: 'WR',
    team: 'MIN',
    photo: `${ESPN}/4262921.png`,
    leagues: 3,
    vsOpps: 4,
  },
  brown: {
    id: 'brown',
    name: 'A. BROWN',
    pos: 'WR',
    team: 'PHI',
    photo: `${ESPN}/4047650.png`,
    leagues: 3,
  },
  kelce: {
    id: 'kelce',
    name: 'T. KELCE',
    pos: 'TE',
    team: 'KC',
    photo: `${ESPN}/15847.png`,
    leagues: 2,
  },
  hurts: {
    id: 'hurts',
    name: 'J. HURTS',
    pos: 'QB',
    team: 'PHI',
    photo: `${ESPN}/4040715.png`,
    leagues: 2,
  },
  mahomes: {
    id: 'mahomes',
    name: 'P. MAHOMES',
    pos: 'QB',
    team: 'KC',
    photo: `${ESPN}/3139477.png`,
    leagues: 5,
    vsOpps: 4,
  },
  hill: {
    id: 'hill',
    name: 'T. HILL',
    pos: 'WR',
    team: 'MIA',
    photo: `${ESPN}/3116406.png`,
    leagues: 5,
    vsOpps: 4,
  },
  allen: {
    id: 'allen',
    name: 'J. ALLEN',
    pos: 'QB',
    team: 'BUF',
    photo: `${ESPN}/3918298.png`,
    leagues: 5,
  },
  kamara: {
    id: 'kamara',
    name: 'A. KAMARA',
    pos: 'RB',
    team: 'NO',
    photo: `${ESPN}/3054850.png`,
    leagues: 4,
  },
  adams: {
    id: 'adams',
    name: 'D. ADAMS',
    pos: 'WR',
    team: 'LAR',
    photo: `${ESPN}/16800.png`,
    leagues: 4,
  },
}

const portfolio = ['barkley', 'jefferson', 'brown', 'kelce', 'hurts']
const threats = ['mahomes', 'hill', 'allen', 'kamara', 'adams']

const matchupLines = [
  { from: 0, to: 0, color: '#5eead4' },
  { from: 0, to: 1, color: '#2dd4bf' },
  { from: 1, to: 1, color: '#fb7185' },
  { from: 1, to: 2, color: '#f9a8d4' },
  { from: 2, to: 2, color: '#c4b5fd' },
]

const slate = [
  {
    slot: '1:00 PM GAMES',
    games: [
      {
        home: 'BUF',
        away: 'JAX',
        status: 'Q2 8:45',
        cards: [
          {
            slot: 2,
            playerId: 'barkley',
            kind: 'yours',
            label: 'YOUR START (x3)',
            stats: 'Live stats, 12 1st + 5',
            net: 5.4,
          },
          {
            slot: 3,
            playerId: 'allen',
            kind: 'opp',
            label: 'OPPONENT START (x2)',
            stats: 'Live stats, 2.7 to. 47',
            net: null,
          },
        ],
      },
      {
        home: 'CHI',
        away: 'MIN',
        status: 'Q2 3:22',
        cards: [
          {
            slot: 4,
            playerId: 'jefferson',
            kind: 'yours',
            label: 'YOUR START (x3)',
            stats: 'Live stats, 6 rec, 91 yds',
            net: 8.1,
          },
          {
            slot: 5,
            playerId: 'adams',
            kind: 'opp',
            label: 'OPPONENT START (x4)',
            stats: 'Live stats, 3 rec, 28 yds',
            net: -3.2,
          },
        ],
      },
    ],
  },
  {
    slot: '4:05 PM GAMES',
    games: [
      {
        home: 'LAC',
        away: 'KC',
        status: 'Pre-Game',
        cards: [
          {
            slot: 6,
            playerId: 'kelce',
            kind: 'conflicted',
            label: 'CONFLICTED: OWN (x2) vs OPP (x1)',
            stats: 'Live stats',
            net: 5.4,
          },
          {
            slot: 7,
            playerId: 'mahomes',
            kind: 'opp',
            label: 'OPPONENT START (x5)',
            stats: 'Projected 24.6 pts',
            net: -6.8,
          },
          {
            slot: 8,
            playerId: 'hill',
            kind: 'opp',
            label: 'OPPONENT START (x5)',
            stats: 'Projected 18.2 pts',
            net: -4.1,
          },
        ],
      },
    ],
  },
  {
    slot: '4:25 PM GAMES',
    games: [
      {
        home: 'NYG',
        away: 'PHI',
        status: 'Pre-Game',
        cards: [
          {
            slot: 9,
            playerId: 'hurts',
            kind: 'yours',
            label: 'YOUR START (x2)',
            stats: 'Projected 22.4 pts',
            net: 4.6,
          },
          {
            slot: 10,
            playerId: 'brown',
            kind: 'yours',
            label: 'YOUR START (x3)',
            stats: 'Projected 16.8 pts',
            net: 3.1,
          },
        ],
      },
    ],
  },
]

function Photo({ src, alt, className }) {
  const [failed, setFailed] = useState(false)
  const initials = alt
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0])
    .join('')

  if (failed) {
    return (
      <div
        className={`flex items-center justify-center bg-slate-200 text-xs font-bold text-slate-500 ${className}`}
      >
        {initials}
      </div>
    )
  }

  return (
    <img
      src={src}
      alt={alt}
      className={`bg-slate-200 ${className}`}
      onError={() => setFailed(true)}
    />
  )
}

function TeamMark({ abbr }) {
  return (
    <img
      src={`${TEAM}/${abbr.toLowerCase()}.png`}
      alt={abbr}
      className="h-7 w-7 object-contain"
    />
  )
}

function NetBadge({ value, compact = false }) {
  if (value == null) {
    return (
      <span className="text-right text-[11px] font-semibold leading-tight text-slate-400">
        −
        <br />
        Points
      </span>
    )
  }

  const positive = value >= 0
  return (
    <div className="text-right">
      <div
        className={`font-extrabold ${compact ? 'text-sm' : 'text-base'} ${
          positive ? 'text-emerald-500' : 'text-rose-500'
        }`}
      >
        {positive ? '+' : ''}
        {value.toFixed(1)}
      </div>
      <div className="text-[10px] font-medium text-slate-400">(Net)</div>
    </div>
  )
}

function IconDashboard() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor">
      <rect x="3" y="3" width="8" height="8" rx="1.5" />
      <rect x="13" y="3" width="8" height="8" rx="1.5" />
      <rect x="3" y="13" width="8" height="8" rx="1.5" />
      <rect x="13" y="13" width="8" height="8" rx="1.5" />
    </svg>
  )
}

function IconMatchups() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="8" cy="8" r="3" />
      <circle cx="16" cy="8" r="3" />
      <path d="M4 19c.6-3 2.4-4.5 4-4.5s3.4 1.5 4 4.5" />
      <path d="M12 19c.6-3 2.4-4.5 4-4.5s3.4 1.5 4 4.5" />
    </svg>
  )
}

function IconTrophy() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M8 4h8v5a4 4 0 0 1-8 0V4Z" />
      <path d="M8 6H5a3 3 0 0 0 3 5" />
      <path d="M16 6h3a3 3 0 0 1-3 5" />
      <path d="M12 13v3" />
      <path d="M8 20h8" />
    </svg>
  )
}

function IconGear() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="3" />
      <path d="M12 3v2m0 14v2M3 12h2m14 0h2M5.6 5.6l1.4 1.4m10 10 1.4 1.4m0-12.8-1.4 1.4m-10 10-1.4 1.4" />
    </svg>
  )
}

function IconMenu() {
  return (
    <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="2.2">
      <path d="M4 7h16M4 12h16M4 17h16" />
    </svg>
  )
}

function IconSearch() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.2-3.2" />
    </svg>
  )
}

function IconFilter() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M4 6h16M7 12h10M10 18h4" />
    </svg>
  )
}

function IconLive() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="3" y="6" width="14" height="12" rx="2" />
      <path d="m17 10 4-2v8l-4-2" />
    </svg>
  )
}

function ViewToggle({ view, onChange, dark }) {
  const options = [
    { id: 'linear', label: 'Linear' },
    { id: 'grid', label: 'H2H Grid' },
  ]

  return (
    <div
      className={`flex rounded-full p-0.5 text-[11px] font-semibold ${
        dark ? 'bg-white/15' : 'bg-slate-100'
      }`}
    >
      {options.map((opt) => {
        const active = view === opt.id
        return (
          <button
            key={opt.id}
            type="button"
            onClick={() => onChange(opt.id)}
            className={`rounded-full px-2.5 py-1 transition ${
              active
                ? dark
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'bg-white text-teal-700 shadow-sm'
                : dark
                  ? 'text-white/70'
                  : 'text-slate-500'
            }`}
          >
            {opt.label}
          </button>
        )
      })}
    </div>
  )
}

function BottomNav({ view, onChange }) {
  return (
    <nav className="sticky bottom-0 z-20 border-t border-slate-200 bg-white/95 px-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-1.5 backdrop-blur">
      <div className="mb-1.5 flex justify-center">
        <ViewToggle view={view} onChange={onChange} />
      </div>
      <div className="grid grid-cols-4 text-[10px] font-medium text-slate-400">
        <button type="button" className="flex flex-col items-center gap-0.5 py-1">
          <IconDashboard />
          Dashboard
        </button>
        <button
          type="button"
          className="relative flex flex-col items-center gap-0.5 py-1 text-teal-600"
        >
          <span className="relative">
            <IconMatchups />
            <span className="absolute -right-2 -top-1 rounded-full bg-orange-500 px-1 text-[9px] font-bold leading-4 text-white">
              3
            </span>
          </span>
          Matchups
        </button>
        <button type="button" className="flex flex-col items-center gap-0.5 py-1">
          <IconTrophy />
          Leagues
        </button>
        <button type="button" className="flex flex-col items-center gap-0.5 py-1">
          <IconGear />
          Settings
        </button>
      </div>
    </nav>
  )
}

function LinearCard({ card }) {
  const player = players[card.playerId]
  const tones = {
    yours: 'border-emerald-200 bg-emerald-50',
    opp: 'border-rose-200 bg-rose-50',
    conflicted: 'border-amber-200 bg-amber-50',
  }
  const labels = {
    yours: 'text-emerald-700',
    opp: 'text-rose-600',
    conflicted: 'text-amber-700',
  }

  return (
    <article
      className={`flex items-center gap-2.5 rounded-2xl border px-2.5 py-2 shadow-sm ${tones[card.kind]}`}
    >
      <div className="w-4 text-center text-sm font-bold text-slate-400">{card.slot}</div>
      <Photo
        src={player.photo}
        alt={player.name}
        className="h-12 w-12 rounded-full object-cover object-top ring-2 ring-white"
      />
      <div className="min-w-0 flex-1">
        <p className={`text-[10px] font-extrabold tracking-wide ${labels[card.kind]}`}>
          {card.label}
        </p>
        <p className="truncate text-sm font-extrabold text-slate-900">
          {player.name} ({player.pos})
        </p>
        <p className="truncate text-[11px] text-slate-500">{card.stats}</p>
      </div>
      <NetBadge value={card.net} />
    </article>
  )
}

function LinearView({ query, kindFilter }) {
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return slate
      .map((window) => ({
        ...window,
        games: window.games
          .map((game) => ({
            ...game,
            cards: game.cards.filter((card) => {
              if (kindFilter !== 'all' && card.kind !== kindFilter) return false
              if (!q) return true
              const p = players[card.playerId]
              return (
                p.name.toLowerCase().includes(q) ||
                p.pos.toLowerCase().includes(q) ||
                p.team.toLowerCase().includes(q) ||
                game.away.toLowerCase().includes(q) ||
                game.home.toLowerCase().includes(q)
              )
            }),
          }))
          .filter((game) => game.cards.length > 0),
      }))
      .filter((window) => window.games.length > 0)
  }, [query, kindFilter])

  return (
    <div className="space-y-5">
      {filtered.map((window) => (
        <section key={window.slot} className="space-y-3">
          <h2 className="text-[11px] font-extrabold tracking-[0.14em] text-slate-400">
            {window.slot}
          </h2>
          {window.games.map((game) => (
            <div key={`${game.away}-${game.home}`} className="space-y-2">
              <div className="flex items-center justify-between rounded-xl bg-slate-800 px-3 py-2 text-white">
                <div className="flex items-center gap-2">
                  <TeamMark abbr={game.away} />
                  <span className="text-sm font-bold">
                    {game.away} vs {game.home}
                  </span>
                  <span className="text-sm text-slate-300">| {game.status}</span>
                </div>
                <TeamMark abbr={game.home} />
              </div>
              <div className="space-y-2">
                {game.cards.map((card) => (
                  <LinearCard key={card.playerId} card={card} />
                ))}
              </div>
            </div>
          ))}
        </section>
      ))}
    </div>
  )
}

function GridPlayerCard({ player, highlight, side }) {
  return (
    <article
      className={`relative flex items-center justify-between rounded-xl border bg-white px-2.5 py-2 shadow-sm ${
        highlight
          ? 'border-emerald-200 bg-emerald-50'
          : 'border-slate-200'
      }`}
    >
      <div className="min-w-0 pr-2">
        <p className="text-[10px] font-extrabold leading-tight text-slate-900">
          {player.name} ({player.pos})
        </p>
        {player.vsOpps ? (
          <p className="text-[10px] text-slate-400">v {player.vsOpps} Opps</p>
        ) : null}
        <p
          className={`mt-1 text-[10px] font-bold ${
            side === 'you' ? 'text-slate-500' : 'text-rose-500'
          }`}
        >
          {player.leagues} LEAGUES
        </p>
      </div>
      <Photo
        src={player.photo}
        alt={player.name}
        className="h-11 w-11 shrink-0 rounded-full object-cover object-top"
      />
    </article>
  )
}

function MatchupLinesOverlay() {
  const leftX = 48
  const rightX = 52
  const yFor = (index) => 10 + index * 20

  return (
    <svg
      className="pointer-events-none absolute inset-0 z-10 h-full w-full"
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
    >
      {matchupLines.map((line) => {
        const y1 = yFor(line.from)
        const y2 = yFor(line.to)
        const c1 = 62
        const c2 = 38
        return (
          <path
            key={`${line.from}-${line.to}-${line.color}`}
            d={`M ${leftX} ${y1} C ${c1} ${y1}, ${c2} ${y2}, ${rightX} ${y2}`}
            fill="none"
            stroke={line.color}
            strokeWidth="0.7"
            vectorEffect="non-scaling-stroke"
            opacity="0.85"
          />
        )
      })}
    </svg>
  )
}

function GridView({ onLiveScores }) {
  return (
    <div>
      <div className="mb-3 grid grid-cols-2 overflow-hidden rounded-lg text-center text-[10px] font-extrabold tracking-wide text-white">
        <div className="bg-slate-800 py-2">
          YOUR PORTFOLIO
          <div className="text-[9px] font-semibold tracking-normal text-slate-300">
            (7 ACTIVE)
          </div>
        </div>
        <div className="bg-rose-700 py-2">
          OPPOSITION THREATS
          <div className="text-[9px] font-semibold tracking-normal text-rose-100">
            (12 TOTAL)
          </div>
        </div>
      </div>

      <div className="relative grid grid-cols-2 gap-x-4 gap-y-2">
        <MatchupLinesOverlay />
        {portfolio.map((id, i) => (
          <div key={id} className="contents">
            <GridPlayerCard
              player={players[id]}
              highlight={i < 2}
              side="you"
            />
            <GridPlayerCard player={players[threats[i]]} side="opp" />
          </div>
        ))}
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3">
        <button
          type="button"
          className="flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white py-3 text-sm font-semibold text-slate-600 shadow-sm"
        >
          <IconFilter />
          Filter
        </button>
        <button
          type="button"
          onClick={onLiveScores}
          className="flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white py-3 text-sm font-semibold text-slate-600 shadow-sm"
        >
          <IconLive />
          Live Scores
        </button>
      </div>
    </div>
  )
}

export default function App() {
  const [view, setView] = useState('linear')
  const [query, setQuery] = useState('')
  const [kindFilter, setKindFilter] = useState('all')
  const nextKind = () => {
    const order = ['all', 'yours', 'opp', 'conflicted']
    setKindFilter(order[(order.indexOf(kindFilter) + 1) % order.length])
  }

  return (
    <div className="min-h-svh bg-[#e8edf3]">
      <div className="mx-auto flex min-h-svh w-full max-w-md flex-col bg-white shadow-xl">
        {view === 'linear' ? (
          <header className="bg-slate-800 px-4 pb-3 pt-4 text-white">
            <div className="mb-3 flex items-center justify-between gap-3">
              <h1 className="text-[13px] font-extrabold tracking-[0.14em] sm:text-[15px]">
                ROOTMAP: SUNDAY SLATE
              </h1>
              <span className="shrink-0 rounded-md bg-emerald-500 px-2 py-0.5 text-xs font-extrabold">
                +14.2
              </span>
            </div>
            <div className="flex gap-2">
              <label className="flex flex-1 items-center gap-2 rounded-lg bg-white px-3 py-2 text-slate-500">
                <IconSearch />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search"
                  className="w-full bg-transparent text-sm text-slate-800 outline-none placeholder:text-slate-400"
                />
              </label>
              <button
                type="button"
                onClick={nextKind}
                className="flex items-center gap-1 rounded-lg bg-white px-3 text-sm font-semibold text-slate-600"
              >
                <IconFilter />
                {kindFilter === 'all'
                  ? 'Filter'
                  : kindFilter === 'yours'
                    ? 'Mine'
                    : kindFilter === 'opp'
                      ? 'Opp'
                      : 'Split'}
              </button>
            </div>
          </header>
        ) : (
          <header className="border-b border-slate-100 px-4 pb-3 pt-3">
            <div className="mb-3 flex items-center justify-between">
              <button type="button" className="text-slate-700" aria-label="Menu">
                <IconMenu />
              </button>
              <h1 className="text-lg font-extrabold tracking-[0.22em] text-teal-700">
                ROOTMAP
              </h1>
              <span className="w-6" />
            </div>
            <div className="flex items-start justify-between gap-2">
              <h2 className="text-[22px] font-extrabold leading-tight tracking-tight text-slate-900">
                WEEK 7 PORTFOLIO GRID
              </h2>
              <span className="mt-1 shrink-0 rounded-md bg-emerald-500 px-2 py-0.5 text-xs font-extrabold text-white">
                +14.2
              </span>
            </div>
          </header>
        )}

        <main className="flex-1 overflow-y-auto bg-slate-50 px-3 py-4">
          {view === 'linear' ? (
            <LinearView query={query} kindFilter={kindFilter} />
          ) : (
            <GridView onLiveScores={() => setView('linear')} />
          )}
        </main>

        <BottomNav view={view} onChange={setView} />
      </div>
    </div>
  )
}
