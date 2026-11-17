import { Capacitor } from '@capacitor/core';
import { prepareCrossFireAlerts } from './nativeFeedback.js';
import { isActiveStarterSlot, isBeforeKickoff, projectionReading } from './zeroProjection.js';

const UPSIDE = 1.2;
const MAX_PROJECTED_GAP = 15;
const MIN_KICKED_OFF_SHARE = 0.7;
const PRE_KICKOFF_MS = 10 * 60 * 1000;
const SCHEDULED_IDS_KEY = 'rootmap_final_slate_nailbiter_ids';
const SUNDAY_LATE_SLATE_MINUTES = 16 * 60; // 4:00 PM ET

function numeric(value) {
  if (value == null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function scoreText(value) {
  const number = numeric(value) ?? 0;
  return number.toFixed(1).replace(/\.0$/, '');
}

function etClock(kickoff) {
  const date = new Date(kickoff);
  if (!Number.isFinite(date.getTime())) return null;
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(date).map((part) => [part.type, part.value]));
  return {
    weekday: parts.weekday,
    minutes: (Number(parts.hour) * 60) + Number(parts.minute)
  };
}

/** Sunday 4:00 PM ET or later (SNF / MNF). Thursday and early-Sunday never qualify. */
export function isLateSlateKickoff(kickoff) {
  const et = etClock(kickoff);
  if (!et) return false;
  if (et.weekday === 'Sun') return et.minutes >= SUNDAY_LATE_SLATE_MINUTES;
  if (et.weekday === 'Mon') return true;
  return false;
}

function playerProjection(player, liveScores) {
  const reading = projectionReading(player, liveScores);
  if (reading.known && reading.value != null) return Math.max(0, reading.value);
  const fallback = numeric(player?.projPoints)
    ?? numeric(player?.projectedPoints)
    ?? numeric(player?.projected)
    ?? numeric(player?.points);
  return fallback != null ? Math.max(0, fallback) : 0;
}

function playerActual(player) {
  const actual = numeric(player?.actualPoints);
  if (actual != null) return Math.max(0, actual);
  const points = numeric(player?.points);
  return points != null ? Math.max(0, points) : 0;
}

function activeStarters(list) {
  return (list || []).filter((player) => isActiveStarterSlot(player));
}

function playerKickoffMs(player) {
  const parsed = Date.parse(player?.kickoff || '');
  return Number.isFinite(parsed) ? parsed : null;
}

function passesFlipTest({ myScore, oppScore, myRemProj, oppRemProj }) {
  if (myScore <= oppScore) {
    const canFlip = myScore + (myRemProj * UPSIDE) > oppScore + oppRemProj;
    const stillClose = (myScore + myRemProj) - (oppScore + oppRemProj) < MAX_PROJECTED_GAP;
    return canFlip && stillClose;
  }
  const canFlip = oppScore + (oppRemProj * UPSIDE) >= myScore + myRemProj;
  const stillClose = (oppScore + oppRemProj) - (myScore + myRemProj) < MAX_PROJECTED_GAP;
  return canFlip && stillClose;
}

/**
 * Detect a true final-slate nailbiter for one matchup.
 * Returns null when the matchup should not schedule a pre-kickoff alert.
 */
export function evaluateMatchupNailbiter(matchup, options = {}) {
  const now = options.now instanceof Date ? options.now : new Date(options.now || Date.now());
  const games = options.games || [];
  const liveScores = options.liveScores || null;
  const myStarters = activeStarters(matchup?.myStarters);
  const oppStarters = activeStarters(matchup?.oppStarters);
  if (!myStarters.length && !oppStarters.length) return null;

  const lateUnstarted = [];
  const collectUnstarted = (player, side) => {
    if (!isBeforeKickoff(player, games, now)) return;
    const kickoff = playerKickoffMs(player);
    if (kickoff == null || !isLateSlateKickoff(kickoff)) return;
    lateUnstarted.push({ player, side, kickoffMs: kickoff });
  };

  myStarters.forEach((player) => collectUnstarted(player, 'mine'));
  oppStarters.forEach((player) => collectUnstarted(player, 'opp'));
  if (!lateUnstarted.length) return null;

  const finalKickoffTime = Math.max(...lateUnstarted.map((row) => row.kickoffMs));
  if (!Number.isFinite(finalKickoffTime) || finalKickoffTime <= now.getTime()) return null;

  let myScore = 0;
  let oppScore = 0;
  let myRemProj = 0;
  let oppRemProj = 0;
  let totalProj = 0;
  let kickedOffProj = 0;

  myStarters.forEach((player) => {
    const proj = playerProjection(player, liveScores);
    totalProj += proj;
    if (isBeforeKickoff(player, games, now)) {
      const kickoff = playerKickoffMs(player);
      if (kickoff != null && isLateSlateKickoff(kickoff)) myRemProj += proj;
      return;
    }
    myScore += playerActual(player);
    kickedOffProj += proj;
  });

  oppStarters.forEach((player) => {
    const proj = playerProjection(player, liveScores);
    totalProj += proj;
    if (isBeforeKickoff(player, games, now)) {
      const kickoff = playerKickoffMs(player);
      if (kickoff != null && isLateSlateKickoff(kickoff)) oppRemProj += proj;
      return;
    }
    oppScore += playerActual(player);
    kickedOffProj += proj;
  });

  if (!(myRemProj > 0 || oppRemProj > 0)) return null;
  if (!(totalProj > 0) || (kickedOffProj / totalProj) < MIN_KICKED_OFF_SHARE) return null;
  if (!passesFlipTest({ myScore, oppScore, myRemProj, oppRemProj })) return null;

  const decidingPlayers = lateUnstarted
    .filter((row) => row.kickoffMs === finalKickoffTime)
    .map((row) => ({
      name: row.player.name,
      side: row.side,
      proj: playerProjection(row.player, liveScores),
      kickoff: row.player.kickoff || new Date(row.kickoffMs).toISOString()
    }));

  return {
    leagueId: matchup?.id || '',
    leagueName: matchup?.name || matchup?.leagueName || 'Fantasy League',
    finalKickoffTime,
    myScore,
    oppScore,
    myRemProj,
    oppRemProj,
    decidingPlayers,
    kickedOffShare: kickedOffProj / totalProj
  };
}

function notificationId(text) {
  let hash = 0;
  for (const char of String(text || '')) hash = (hash * 33 + char.charCodeAt(0)) >>> 0;
  return (hash % 2147483646) + 1;
}

export function finalSlateNailbiterNotificationId(week, kickoffMs) {
  const windowMs = Math.floor(Number(kickoffMs) / 60000) * 60000;
  return notificationId(`final-slate-nailbiter|${week}|${windowMs}`);
}

function formatKickoffEt(kickoffMs) {
  const et = etClock(kickoffMs);
  if (!et) return '';
  const hour24 = Math.floor(et.minutes / 60);
  const minute = et.minutes % 60;
  const suffix = hour24 >= 12 ? 'PM' : 'AM';
  const hour12 = hour24 % 12 || 12;
  const day = et.weekday === 'Mon' ? 'Monday' : et.weekday === 'Sun' ? 'Sunday' : et.weekday;
  return `${day} ${hour12}:${String(minute).padStart(2, '0')} ${suffix} ET`;
}

function decidingLabel(players) {
  const list = players || [];
  if (!list.length) return 'Final starters';
  if (list.length === 1) {
    const only = list[0];
    return `${only.name} (Proj ${scoreText(only.proj)})`;
  }
  if (list.length === 2) {
    return list.map((player) => `${player.name} (Proj ${scoreText(player.proj)})`).join(' & ');
  }
  return `${list.length} deciding starters`;
}

export function formatFinalSlateNailbiterBody(group) {
  const rows = group?.matchups || [];
  if (!rows.length) return '';
  if (rows.length === 1) {
    const only = rows[0];
    return `⚡ Nailbiter in ${only.leagueName} (${scoreText(only.myScore)} vs ${scoreText(only.oppScore)}): ${decidingLabel(only.decidingPlayers)} kicks off in 10 mins!`;
  }
  const summary = rows
    .slice(0, 3)
    .map((row) => `${row.leagueName} (${scoreText(row.myScore)}-${scoreText(row.oppScore)})`)
    .join(' + ');
  const extra = rows.length > 3 ? ` +${rows.length - 3} more` : '';
  return `⚡ ${rows.length} Final-Slate Nailbiters at ${formatKickoffEt(group.finalKickoffTime)}: ${summary}${extra}`;
}

function readScheduledIds() {
  try {
    const raw = JSON.parse(localStorage.getItem(SCHEDULED_IDS_KEY) || '[]');
    return Array.isArray(raw) ? raw.map((id) => Number(id)).filter((id) => Number.isFinite(id) && id > 0) : [];
  } catch {
    return [];
  }
}

function writeScheduledIds(ids) {
  try {
    localStorage.setItem(SCHEDULED_IDS_KEY, JSON.stringify([...new Set(ids)]));
  } catch {
    // storage is optional
  }
}

export function groupNailbitersByKickoff(results) {
  const groups = new Map();
  (results || []).forEach((result) => {
    if (!result?.finalKickoffTime) return;
    const windowMs = Math.floor(result.finalKickoffTime / 60000) * 60000;
    const existing = groups.get(windowMs) || { finalKickoffTime: windowMs, matchups: [] };
    existing.matchups.push(result);
    groups.set(windowMs, existing);
  });
  return [...groups.values()].sort((a, b) => a.finalKickoffTime - b.finalKickoffTime);
}

export async function cancelFinalSlateNailbiterNotifications(ids = null) {
  if (!Capacitor.isNativePlatform()) return;
  const list = ids == null ? readScheduledIds() : ids;
  if (!list.length) {
    writeScheduledIds([]);
    return;
  }
  try {
    const { LocalNotifications } = await import('@capacitor/local-notifications');
    await LocalNotifications.cancel({
      notifications: list.map((id) => ({ id }))
    });
  } catch {
    // cancel is best-effort
  }
  if (ids == null) writeScheduledIds([]);
}

/**
 * Replace scheduled Final-Slate Nailbiter alerts for the given evaluations.
 * One local notification per kickoff window, at finalKickoffTime - 10 minutes.
 */
export async function syncFinalSlateNailbiterNotifications({
  results,
  week,
  enabled = true,
  now = new Date()
} = {}) {
  if (!Capacitor.isNativePlatform()) return [];
  const previous = readScheduledIds();
  if (!enabled) {
    await cancelFinalSlateNailbiterNotifications(previous);
    writeScheduledIds([]);
    return [];
  }

  await prepareCrossFireAlerts();
  const { LocalNotifications } = await import('@capacitor/local-notifications');
  const groups = groupNailbitersByKickoff(results);
  const instant = now instanceof Date ? now.getTime() : new Date(now).getTime();
  const nextIds = [];
  const notifications = [];

  groups.forEach((group) => {
    const id = finalSlateNailbiterNotificationId(week, group.finalKickoffTime);
    const fireAt = group.finalKickoffTime - PRE_KICKOFF_MS;
    if (!(fireAt > instant) || !(group.finalKickoffTime > instant)) return;
    nextIds.push(id);
    notifications.push({
      id,
      title: 'Final-Slate Nailbiter',
      body: formatFinalSlateNailbiterBody(group),
      schedule: { at: new Date(fireAt), allowWhileIdle: true },
      extra: {
        type: 'final-slate-nailbiter',
        week: Number(week) || null,
        kickoff: group.finalKickoffTime
      }
    });
  });

  const stale = previous.filter((id) => !nextIds.includes(id));
  if (stale.length) {
    try {
      await LocalNotifications.cancel({ notifications: stale.map((id) => ({ id })) });
    } catch {
      // ignore
    }
  }

  if (notifications.length) {
    try {
      await LocalNotifications.cancel({ notifications: nextIds.map((id) => ({ id })) });
    } catch {
      // ignore
    }
    await LocalNotifications.schedule({ notifications });
  }

  writeScheduledIds(nextIds);
  return nextIds;
}

/** Attach kickoff ISO timestamps from the live slate onto starters for evaluation. */
export function hydrateMatchupKickoffs(matchup, games = []) {
  const resolve = (player) => {
    if (!player) return player;
    if (player.kickoff) return player;
    const team = String(player.nflTeam || player.team || '').toUpperCase();
    if (!team) return player;
    const game = (games || []).find((entry) => (
      String(entry?.home || '').toUpperCase() === team
      || String(entry?.away || '').toUpperCase() === team
    ));
    if (!game?.kickoff) return player;
    return { ...player, kickoff: game.kickoff };
  };
  return {
    ...matchup,
    myStarters: (matchup?.myStarters || []).map(resolve),
    oppStarters: (matchup?.oppStarters || []).map(resolve)
  };
}
