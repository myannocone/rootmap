/**
 * Smoke checks for unified RootMap notification copy + palette.
 */
import {
  formatRootMapNotification,
  NOTIFICATION_CATEGORIES,
  NOTIFICATION_COLORS,
  notificationAccent
} from '../src/utils/notificationFormatter.js';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const nail = formatRootMapNotification(NOTIFICATION_CATEGORIES.NAIL_BITER, {
  leagueName: 'BCliff Football',
  outlook: 'upside',
  playerName: 'Zay Flowers'
});
assert(nail.title === 'NAIL BITER • BCliff Football', `title ${nail.title}`);
assert(!/RootMap/.test(nail.title), 'single-league titles omit RootMap');
assert(/You have a chance to win!/.test(nail.body), `body ${nail.body}`);
assert(nail.body.length < 95, `body length ${nail.body.length}`);
assert(nail.accent === NOTIFICATION_COLORS.upside, 'upside accent');

const danger = formatRootMapNotification(NOTIFICATION_CATEGORIES.NAIL_BITER, {
  leagueName: 'Mantasy',
  outlook: 'danger',
  playerName: 'Travis Kelce'
});
assert(/danger of a loss/i.test(danger.body), `danger body: ${danger.body}`);
assert(danger.accent === NOTIFICATION_COLORS.danger, 'danger accent');

const multi = formatRootMapNotification(NOTIFICATION_CATEGORIES.NAIL_BITER, {
  leagueCount: 3,
  multiCount: 3,
  outlook: 'upside'
});
assert(multi.title === 'NAIL BITER • 3 RootMap Leagues', `multi title ${multi.title}`);

const inactive = formatRootMapNotification(NOTIFICATION_CATEGORIES.INACTIVE, {
  leagueName: 'Work League',
  playerName: 'Deebo Samuel'
});
assert(inactive.title === 'INACTIVE ALERT • Work League', inactive.title);
assert(inactive.body.length < 95, inactive.body);

const lock = formatRootMapNotification(NOTIFICATION_CATEGORIES.LINEUP_LOCK, {
  windowLabel: 'Sunday 1:00 PM'
});
assert(lock.title === 'LINEUP LOCK • Sunday 1:00 PM', lock.title);
assert(notificationAccent(NOTIFICATION_CATEGORIES.LINEUP_LOCK) === NOTIFICATION_COLORS.lock, 'lock color');

const red = formatRootMapNotification(NOTIFICATION_CATEGORIES.RED_ZONE, {
  leagueName: 'Family',
  playerName: 'Josh Allen'
});
assert(red.title === 'RED ZONE • Family', red.title);
assert(red.accent === NOTIFICATION_COLORS.danger, 'red zone crimson');

const boom = formatRootMapNotification(NOTIFICATION_CATEGORIES.OUTPERFORMER, {
  leagueName: 'Dynasty',
  playerName: 'Puka Nacua',
  delta: 8.4
});
assert(boom.title === 'OUTPERFORMER • Dynasty', boom.title);
assert(boom.accent === NOTIFICATION_COLORS.upside, 'outperformer emerald');

console.log('verify-notification-formatter: ok');
