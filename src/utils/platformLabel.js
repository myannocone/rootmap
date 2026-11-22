/** Clean platform badge copy. Empty when the platform is unknown. */
export function platformLeagueLabel(platform) {
  const value = String(platform || '').trim().replace(/\s+/g, ' ');
  const key = value.toLowerCase();
  if (!key) return '';
  if (key.includes('espn')) return 'ESPN League';
  if (key.includes('sleeper')) return 'Sleeper League';
  if (key.includes('yahoo')) return 'Yahoo League';
  if (/^[\w .'-]{1,28}\sleague$/i.test(value)) return value;
  return '';
}
