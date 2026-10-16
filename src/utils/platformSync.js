/**
 * Mock connector to simulate syncing leagues from Sleeper, Yahoo, and ESPN
 */
export const availablePlatforms = [
  { id: "sleeper", name: "Sleeper", icon: "⚡", placeholder: "e.g., 10485729104859" },
  { id: "yahoo", name: "Yahoo Fantasy", icon: "🟣", placeholder: "e.g., 423.l.58291" },
  { id: "espn", name: "ESPN Fantasy", icon: "🔴", placeholder: "e.g., 81729402" }
];

export function generateMockConnectedLeague(platformName, leagueIdentifier) {
  const cleanId = leagueIdentifier.trim() || Math.floor(100000 + Math.random() * 900000).toString();
  return {
    id: `custom_${Date.now()}`,
    name: `${platformName} League #${cleanId.slice(-4)}`,
    platform: platformName,
    myTeam: "My Roster",
    myScore: 0.0,
    oppTeam: "Opponent Squad",
    oppScore: 0.0,
    status: "SYNCED",
    projSpread: "0.0"
  };
}