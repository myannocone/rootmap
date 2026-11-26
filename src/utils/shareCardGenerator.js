import { playerPosTeamLabel } from './playerIdentity.js';
import { canonTeamCode, normalizePlayerMatchName } from './playerTeam.js';
import { cleanYahooPlayerName } from './yahooPaste.js';

const CARD_WIDTH = 1080;
const CARD_HEIGHT = 1350;
const FONT = 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif';

const EMERALD = '#10B981';
const CRIMSON = '#F43F5E';
const AMBER = '#F59E0B';

const HEADSHOT_INDEX_KEY = 'rootmap_sleeper_headshot_index_v1';

const TEAM_ACCENT = {
  ARI: { bg: '#A5ACAF', fg: '#111111' },
  ATL: { bg: '#A71930', fg: '#FFFFFF' },
  BAL: { bg: '#9E7C0C', fg: '#FFFFFF' },
  BUF: { bg: '#C60C30', fg: '#FFFFFF' },
  CAR: { bg: '#BFC0BF', fg: '#0085CA' },
  CHI: { bg: '#C83803', fg: '#FFFFFF' },
  CIN: { bg: '#FB4F14', fg: '#111111' },
  CLE: { bg: '#FF3C00', fg: '#FFFFFF' },
  DAL: { bg: '#869397', fg: '#041E42' },
  DEN: { bg: '#FB4F14', fg: '#FFFFFF' },
  DET: { bg: '#B0B7BC', fg: '#0076B6' },
  GB: { bg: '#FFB612', fg: '#203731' },
  HOU: { bg: '#A71930', fg: '#FFFFFF' },
  IND: { bg: '#A2AAAD', fg: '#002C5F' },
  JAX: { bg: '#D7A22A', fg: '#111111' },
  KC: { bg: '#FFB81C', fg: '#E31837' },
  LAC: { bg: '#FFC20E', fg: '#0080C6' },
  LAR: { bg: '#FFA300', fg: '#003594' },
  LV: { bg: '#A5ACAF', fg: '#111111' },
  MIA: { bg: '#FC4C02', fg: '#FFFFFF' },
  MIN: { bg: '#FFC62F', fg: '#4F2683' },
  NE: { bg: '#C60C30', fg: '#FFFFFF' },
  NO: { bg: '#D3BC8D', fg: '#101820' },
  NYG: { bg: '#A71930', fg: '#FFFFFF' },
  NYJ: { bg: '#FFFFFF', fg: '#125740' },
  PHI: { bg: '#A5ACAF', fg: '#004C54' },
  PIT: { bg: '#FFB612', fg: '#101820' },
  SEA: { bg: '#69BE28', fg: '#002244' },
  SF: { bg: '#B3995D', fg: '#AA0000' },
  TB: { bg: '#34302B', fg: '#FF7900' },
  TEN: { bg: '#4B92DB', fg: '#0C2340' },
  WAS: { bg: '#FFB612', fg: '#5A1414' },
  WSH: { bg: '#FFB612', fg: '#5A1414' }
};

function finiteNumber(value) {
  if (value == null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function clockIsLive(clock) {
  const text = String(clock || '');
  return /\b(Q[1-4]|1st|2nd|3rd|4th|OT|Halftime)\b/i.test(text) || /\bLIVE\b/i.test(text);
}

function formatPoints(value) {
  const number = finiteNumber(value) ?? 0;
  return (Math.round(number * 10) / 10).toFixed(1);
}

function formatSigned(value) {
  const rounded = Math.round(Number(value) * 10) / 10;
  const body = Math.abs(rounded).toFixed(1);
  if (rounded > 0) return `+${body}`;
  if (rounded < 0) return `-${body}`;
  return '0.0';
}

function hexAlpha(hex, alpha) {
  const raw = String(hex || '').replace('#', '');
  const full = raw.length === 3 ? raw.split('').map((ch) => ch + ch).join('') : raw;
  const num = Number.parseInt(full, 16);
  if (!Number.isFinite(num)) return `rgba(148, 163, 184, ${alpha})`;
  const r = (num >> 16) & 255;
  const g = (num >> 8) & 255;
  const b = num & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function shadeColor(hex, amount) {
  const raw = String(hex || '').replace('#', '');
  const num = Number.parseInt(raw, 16);
  if (!Number.isFinite(num)) return hex;
  const channel = (shift) => Math.min(255, Math.max(0, ((num >> shift) & 255) + amount));
  return `rgb(${channel(16)}, ${channel(8)}, ${channel(0)})`;
}

function roundRectPath(ctx, x, y, w, h, r) {
  const radius = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

function uniqueLeagues(entries) {
  const seen = new Set();
  const out = [];
  for (const entry of entries || []) {
    const name = String(entry?.league || entry?.name || entry?.leagueName || '').trim();
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ league: name, opponent: entry?.opponent || '' });
  }
  return out;
}

function exposureOf(player) {
  const forLeagues = uniqueLeagues(player?.myLeagues);
  const againstLeagues = uniqueLeagues(player?.oppLeagues);
  const forCount = forLeagues.length || Number(player?.myShares) || 0;
  const againstCount = againstLeagues.length || Number(player?.oppShares) || 0;
  return {
    forLeagues,
    againstLeagues,
    forCount: forCount > 0 ? forCount : 0,
    againstCount: againstCount > 0 ? againstCount : 0
  };
}

function scoreView(player) {
  const actual = finiteNumber(player?.actualPoints);
  const stored = finiteNumber(player?.points);
  const explicitProj = finiteNumber(player?.projPoints)
    ?? finiteNumber(player?.projectedPoints)
    ?? finiteNumber(player?.projected);
  const bye = Boolean(player?.isBye || player?.gameStatus === 'BYE');
  const live = !bye && (player?.gameStatus === 'IN_PROGRESS' || Boolean(player?.isLive) || clockIsLive(player?.gameClock));
  const finalGame = !bye && player?.gameStatus === 'FINAL';
  const proj = explicitProj != null
    ? explicitProj
    : (actual == null && stored != null && stored !== 0 ? stored : null);
  const hasActual = actual != null && (live || finalGame || actual !== 0);
  const pregameValue = proj != null ? proj : (stored != null && stored !== 0 ? stored : null);
  const shown = hasActual ? actual : (live ? 0 : (pregameValue ?? 0));
  const delta = hasActual && proj != null ? actual - proj : null;
  return { live, bye, final: finalGame, shown, proj, delta, hasActual };
}

function cardStatus(player) {
  const exposure = exposureOf(player);
  const { delta } = scoreView(player);
  const { forCount, againstCount } = exposure;
  if (forCount >= 1 && againstCount >= 1) {
    return { key: 'conflict', color: AMBER, badge: 'CONFLICT', exposure };
  }
  if (againstCount >= 2 && forCount === 0) {
    return { key: 'against', color: CRIMSON, badge: `${againstCount}X AGAINST`, exposure };
  }
  if (forCount >= 2 && againstCount === 0) {
    return { key: 'for', color: EMERALD, badge: `${forCount}X FOR`, exposure };
  }
  if (delta != null && delta > 0) {
    return { key: 'for', color: EMERALD, badge: `${formatSigned(delta)} OVER PROJ`, exposure };
  }
  if (againstCount > 0 && forCount === 0) {
    return { key: 'against', color: CRIMSON, badge: 'AGAINST', exposure };
  }
  if (forCount > 0) {
    return { key: 'for', color: EMERALD, badge: 'FOR', exposure };
  }
  return { key: 'neutral', color: '#64748B', badge: 'ROOTMAP', exposure };
}

function isDefense(player) {
  const pos = String(player?.position || '').toUpperCase();
  const slot = String(player?.slot || '').toUpperCase();
  return ['DEF', 'DST', 'D/ST'].includes(pos) || ['DEF', 'DST', 'D/ST'].includes(slot);
}

function playerInitials(name) {
  const parts = String(cleanYahooPlayerName(name) || name || '')
    .replace(/\b(Jr|Sr|II|III|IV)\.?/gi, '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!parts.length) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

function teamCode(player) {
  return canonTeamCode(player?.nflTeam || player?.team)
    || String(player?.nflTeam || player?.team || '').toUpperCase().replace(/[^A-Z]/g, '');
}

function normalizeIndexName(name) {
  return normalizePlayerMatchName(cleanYahooPlayerName(name) || name);
}

function lookupHeadshotRecord(name, team) {
  if (typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(HEADSHOT_INDEX_KEY);
    if (!raw) return null;
    const index = JSON.parse(raw);
    const nameKey = normalizeIndexName(name);
    if (!nameKey || !index) return null;
    const teamKey = String(team || '').toUpperCase();
    return (teamKey && index[`${nameKey}|${teamKey}`]) || index[nameKey] || null;
  } catch {
    return null;
  }
}

function headshotCandidates(player) {
  const urls = [];
  [player?.headshotUrl, player?.headshot, player?.photo, player?.image, player?.avatar].forEach((url) => {
    if (url) urls.push(String(url));
  });
  const sleeperId = player?.sleeperId || player?.playerId;
  if (sleeperId && !/^[A-Z]{2,3}$/.test(String(sleeperId))) {
    urls.push(`https://sleepercdn.com/content/nfl/players/${sleeperId}.jpg`);
    urls.push(`https://sleepercdn.com/content/nfl/players/thumb/${sleeperId}.jpg`);
  }
  const team = teamCode(player);
  if (isDefense(player) && team) {
    const lower = team.toLowerCase();
    urls.push(`https://a.espncdn.com/i/teamlogos/nfl/500/${lower}.png`);
    if (lower === 'was') urls.push('https://a.espncdn.com/i/teamlogos/nfl/500/wsh.png');
  }
  const hit = lookupHeadshotRecord(player?.name, team);
  if (hit?.id && !/^[A-Z]{2,3}$/.test(String(hit.id))) {
    urls.push(`https://sleepercdn.com/content/nfl/players/${hit.id}.jpg`);
    urls.push(`https://sleepercdn.com/content/nfl/players/thumb/${hit.id}.jpg`);
  } else if (hit?.id && /^[A-Z]{2,3}$/.test(String(hit.id))) {
    urls.push(`https://sleepercdn.com/images/team_logos/nfl/${String(hit.id).toLowerCase()}.png`);
  }
  if (hit?.espn) {
    urls.push(`https://a.espncdn.com/combiner/i?img=/i/headshots/nfl/players/full/${hit.espn}.png&w=426&h=320`);
  }
  return [...new Set(urls)];
}

function loadImage(src, timeoutMs = 2200) {
  return new Promise((resolve) => {
    if (!src || typeof Image === 'undefined') {
      resolve(null);
      return;
    }
    const img = new Image();
    img.crossOrigin = 'anonymous';
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      resolve(value);
    };
    const timer = window.setTimeout(() => finish(null), timeoutMs);
    img.onload = () => finish(img.naturalWidth > 0 ? img : null);
    img.onerror = () => finish(null);
    try {
      img.src = src;
    } catch {
      finish(null);
    }
  });
}

async function loadFirstImage(urls) {
  for (const url of urls) {
    const img = await loadImage(url);
    if (img) return img;
  }
  return null;
}

async function loadCardAssets(player) {
  const [logo, headshot] = await Promise.all([
    loadImage('/logo.png', 2500),
    loadFirstImage(headshotCandidates(player))
  ]);
  return { logo, headshot };
}

function drawImageCover(ctx, img, x, y, w, h, focusTop = true) {
  const sourceRatio = img.width / img.height;
  const destRatio = w / h;
  let sx = 0;
  let sy = 0;
  let sw = img.width;
  let sh = img.height;
  if (sourceRatio > destRatio) {
    sw = img.height * destRatio;
    sx = (img.width - sw) / 2;
  } else {
    sh = img.width / destRatio;
    sy = focusTop ? 0 : (img.height - sh) / 2;
  }
  ctx.drawImage(img, sx, sy, sw, sh, x, y, w, h);
}

function ellipsis(ctx, text, maxWidth) {
  const value = String(text || '');
  if (ctx.measureText(value).width <= maxWidth) return value;
  let out = value;
  while (out.length > 1 && ctx.measureText(`${out}…`).width > maxWidth) out = out.slice(0, -1);
  return `${out.trim()}…`;
}

function drawWordmark(ctx, x, y, size, align = 'left') {
  ctx.font = `800 ${size}px ${FONT}`;
  ctx.textBaseline = 'middle';
  const root = 'Root';
  const map = 'Map';
  const rootW = ctx.measureText(root).width;
  const mapW = ctx.measureText(map).width;
  let start = x;
  if (align === 'center') start = x - (rootW + mapW) / 2;
  else if (align === 'right') start = x - (rootW + mapW);
  ctx.textAlign = 'left';
  ctx.fillStyle = '#F8FAFC';
  ctx.fillText(root, start, y);
  ctx.fillStyle = EMERALD;
  ctx.fillText(map, start + rootW, y);
  return rootW + mapW;
}

function drawLogoFallback(ctx, x, y) {
  const tile = 92;
  roundRectPath(ctx, x, y, tile, tile, 22);
  const fill = ctx.createLinearGradient(x, y, x, y + tile);
  fill.addColorStop(0, '#34D399');
  fill.addColorStop(1, '#047857');
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = 'rgba(255,255,255,0.35)';
  ctx.stroke();
  ctx.fillStyle = '#FFFFFF';
  ctx.font = `900 58px ${FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('R', x + tile / 2, y + tile / 2 + 2);
  drawWordmark(ctx, x + tile + 18, y + tile / 2, 40, 'left');
}

function drawLogo(ctx, logo, x, y, size) {
  if (!logo) {
    drawLogoFallback(ctx, x, y + 8);
    return;
  }
  ctx.save();
  roundRectPath(ctx, x, y, size, size, 28);
  ctx.clip();
  drawImageCover(ctx, logo, x, y, size, size, false);
  ctx.restore();
  ctx.save();
  roundRectPath(ctx, x, y, size, size, 28);
  ctx.lineWidth = 2;
  ctx.strokeStyle = 'rgba(255,255,255,0.16)';
  ctx.stroke();
  ctx.restore();
}

function drawBadge(ctx, text, color, right, cy) {
  ctx.font = `800 28px ${FONT}`;
  const label = ellipsis(ctx, text, 420);
  const width = Math.min(520, Math.ceil(ctx.measureText(label).width) + 48);
  const height = 64;
  const x = right - width;
  const y = cy - height / 2;
  roundRectPath(ctx, x, y, width, height, height / 2);
  ctx.fillStyle = hexAlpha(color, 0.16);
  ctx.fill();
  ctx.lineWidth = 3;
  ctx.strokeStyle = color;
  ctx.stroke();
  ctx.fillStyle = '#F8FAFC';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, x + width / 2, cy + 1);
}

function drawHeadshot(ctx, player, headshot, cx, cy, radius, color) {
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, radius + 10, 0, Math.PI * 2);
  ctx.strokeStyle = color;
  ctx.lineWidth = 8;
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.clip();
  if (headshot) {
    ctx.fillStyle = '#0F172A';
    ctx.fillRect(cx - radius, cy - radius, radius * 2, radius * 2);
    drawImageCover(ctx, headshot, cx - radius, cy - radius, radius * 2, radius * 2, !isDefense(player));
  } else {
    const team = teamCode(player);
    const accent = TEAM_ACCENT[team] || { bg: '#1E293B', fg: '#F8FAFC' };
    ctx.fillStyle = accent.bg;
    ctx.fillRect(cx - radius, cy - radius, radius * 2, radius * 2);
    const mark = isDefense(player) ? (team || 'DEF') : playerInitials(player?.name);
    ctx.fillStyle = accent.fg;
    ctx.font = `800 ${Math.round(radius * (mark.length > 2 ? 0.46 : 0.62))}px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(mark, cx, cy + 2);
  }
  ctx.restore();
}

function drawCenteredLines(ctx, lines, cx, y, lineHeight, color) {
  ctx.fillStyle = color;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  lines.forEach((line, index) => {
    ctx.fillText(line, cx, y + index * lineHeight);
  });
  return y + lines.length * lineHeight;
}

function wrapName(ctx, name, maxWidth) {
  const words = String(name || 'Player').trim().split(/\s+/).filter(Boolean);
  if (!words.length) return ['Player'];
  const lines = [];
  let current = '';
  words.forEach((word) => {
    const next = current ? `${current} ${word}` : word;
    if (ctx.measureText(next).width <= maxWidth) current = next;
    else {
      if (current) lines.push(current);
      current = word;
    }
  });
  if (current) lines.push(current);
  if (lines.length <= 2) return lines;
  const kept = lines.slice(0, 2);
  kept[1] = ellipsis(ctx, `${kept[1]} ${lines.slice(2).join(' ')}`, maxWidth);
  return kept;
}

function pillParts(view) {
  const parts = [];
  if (view.proj != null && view.delta != null) {
    parts.push({ text: `PROJ ${formatPoints(view.proj)}`, color: '#E2E8F0' });
    parts.push({
      text: formatSigned(view.delta),
      color: view.delta > 0 ? EMERALD : view.delta < 0 ? CRIMSON : '#CBD5E1'
    });
    return parts;
  }
  if (view.proj != null && view.hasActual) {
    return [{ text: `PROJ ${formatPoints(view.proj)}`, color: '#E2E8F0' }];
  }
  if (!view.hasActual && view.proj != null) return [{ text: 'PROJECTED', color: '#E2E8F0' }];
  return [{ text: view.live ? 'LIVE' : view.final ? 'FINAL' : 'PROJ', color: '#E2E8F0' }];
}

function drawDeltaPill(ctx, view, cx, y) {
  const parts = pillParts(view);
  ctx.font = `800 28px ${FONT}`;
  const gap = 22;
  const widths = parts.map((part) => ctx.measureText(part.text).width);
  const textWidth = widths.reduce((sum, width) => sum + width, 0) + gap * Math.max(0, parts.length - 1);
  const height = 58;
  const width = textWidth + 48;
  const x = cx - width / 2;
  roundRectPath(ctx, x, y, width, height, height / 2);
  ctx.fillStyle = 'rgba(255,255,255,0.06)';
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = 'rgba(255,255,255,0.14)';
  ctx.stroke();
  let cursor = x + 24;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  parts.forEach((part, index) => {
    ctx.fillStyle = part.color;
    ctx.fillText(part.text, cursor, y + height / 2 + 1);
    cursor += widths[index] + gap;
  });
  return y + height;
}

function drawStakes(ctx, exposure, x, y, width) {
  const { forCount, againstCount, forLeagues, againstLeagues } = exposure;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.font = `800 18px ${FONT}`;
  ctx.fillStyle = '#94A3B8';
  ctx.fillText('LEAGUE STAKES', x, y);

  ctx.font = `800 26px ${FONT}`;
  ctx.fillStyle = EMERALD;
  ctx.fillText(`FOR  ${forCount}`, x, y + 40);
  const againstLabel = `AGAINST  ${againstCount}`;
  ctx.fillStyle = CRIMSON;
  ctx.textAlign = 'right';
  ctx.fillText(againstLabel, x + width, y + 40);
  ctx.textAlign = 'left';

  const barY = y + 58;
  const barH = 30;
  const total = forCount + againstCount;
  const forRatio = total > 0 ? forCount / total : 0.5;
  roundRectPath(ctx, x, barY, width, barH, barH / 2);
  ctx.save();
  ctx.clip();
  ctx.fillStyle = CRIMSON;
  ctx.fillRect(x, barY, width, barH);
  ctx.fillStyle = EMERALD;
  ctx.fillRect(x, barY, Math.max(total === 0 ? width / 2 : 0, width * forRatio), barH);
  ctx.restore();
  roundRectPath(ctx, x, barY, width, barH, barH / 2);
  ctx.lineWidth = 2;
  ctx.strokeStyle = 'rgba(255,255,255,0.12)';
  ctx.stroke();

  const tags = [
    ...forLeagues.map((entry) => ({ name: entry.league, side: 'for' })),
    ...againstLeagues.map((entry) => ({ name: entry.league, side: 'against' }))
  ];
  let tagY = barY + barH + 22;
  if (!tags.length) return tagY;
  ctx.font = `800 20px ${FONT}`;
  const maxTagY = 1188;
  let cursorX = x;
  let shown = 0;
  tags.forEach((tag, index) => {
    if (tagY > maxTagY) return;
    const sideLabel = tag.side === 'for' ? 'FOR' : 'AGAINST';
    const label = ellipsis(ctx, `${tag.name} · ${sideLabel}`, 340);
    const chipW = Math.min(360, ctx.measureText(label).width + 28);
    if (cursorX + chipW > x + width) {
      cursorX = x;
      tagY += 52;
      if (tagY > maxTagY) return;
    }
    const remaining = tags.length - index;
    if (cursorX === x && tagY + 52 > maxTagY && remaining > 1) {
      const more = `+${remaining}`;
      const moreW = ctx.measureText(more).width + 28;
      roundRectPath(ctx, cursorX, tagY, moreW, 40, 20);
      ctx.fillStyle = 'rgba(148,163,184,0.16)';
      ctx.fill();
      ctx.fillStyle = '#E2E8F0';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(more, cursorX + moreW / 2, tagY + 21);
      tagY = maxTagY + 1;
      return;
    }
    const color = tag.side === 'for' ? EMERALD : CRIMSON;
    roundRectPath(ctx, cursorX, tagY, chipW, 40, 20);
    ctx.fillStyle = hexAlpha(color, 0.14);
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = hexAlpha(color, 0.7);
    ctx.stroke();
    ctx.fillStyle = '#F8FAFC';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, cursorX + chipW / 2, tagY + 21);
    cursorX += chipW + 12;
    shown += 1;
  });
  return shown ? tagY + 40 : barY + barH;
}

function drawSlab(ctx, box, color) {
  const { x, y, w, h, r } = box;
  ctx.save();
  ctx.shadowColor = hexAlpha(color, 0.55);
  ctx.shadowBlur = 42;
  ctx.shadowOffsetY = 8;
  roundRectPath(ctx, x, y, w, h, r);
  const bg = ctx.createLinearGradient(0, y, 0, y + h);
  bg.addColorStop(0, '#070B14');
  bg.addColorStop(0.52, '#0D1526');
  bg.addColorStop(1, '#080D18');
  ctx.fillStyle = bg;
  ctx.fill();
  ctx.restore();

  ctx.save();
  roundRectPath(ctx, x, y, w, h, r);
  ctx.clip();
  const wash = ctx.createRadialGradient(x + w * 0.5, y + 40, 20, x + w * 0.5, y + 180, w * 0.72);
  wash.addColorStop(0, hexAlpha(color, 0.2));
  wash.addColorStop(1, hexAlpha(color, 0));
  ctx.fillStyle = wash;
  ctx.fillRect(x, y, w, h * 0.55);
  const foil = ctx.createLinearGradient(x, y, x + w, y + h * 0.85);
  foil.addColorStop(0, 'rgba(255,255,255,0.13)');
  foil.addColorStop(0.16, 'rgba(255,255,255,0.02)');
  foil.addColorStop(0.38, 'rgba(255,255,255,0.08)');
  foil.addColorStop(0.52, 'rgba(255,255,255,0)');
  foil.addColorStop(1, 'rgba(255,255,255,0.035)');
  ctx.fillStyle = foil;
  ctx.fillRect(x, y, w, h);
  ctx.restore();

  ctx.save();
  const inset = 8;
  roundRectPath(ctx, x + inset, y + inset, w - inset * 2, h - inset * 2, r - 8);
  const metal = ctx.createLinearGradient(x, y, x + w, y + h);
  metal.addColorStop(0, 'rgba(255,255,255,0.92)');
  metal.addColorStop(0.16, color);
  metal.addColorStop(0.48, shadeColor(color, -48));
  metal.addColorStop(0.8, color);
  metal.addColorStop(1, 'rgba(255,255,255,0.72)');
  ctx.strokeStyle = metal;
  ctx.lineWidth = 11;
  ctx.stroke();
  ctx.restore();
}

function drawFooter(ctx, box) {
  const y = box.y + box.h - 86;
  ctx.beginPath();
  ctx.moveTo(box.x + 52, y);
  ctx.lineTo(box.x + box.w - 52, y);
  ctx.strokeStyle = 'rgba(148, 163, 184, 0.28)';
  ctx.lineWidth = 2;
  ctx.stroke();
  drawWordmark(ctx, box.x + box.w / 2, y + 44, 34, 'center');
}

function paintCard(player, assets) {
  const canvas = document.createElement('canvas');
  canvas.width = CARD_WIDTH;
  canvas.height = CARD_HEIGHT;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  const status = cardStatus(player);
  const view = scoreView(player);
  const box = { x: 36, y: 36, w: 1008, h: 1278, r: 56 };
  drawSlab(ctx, box, status.color);

  const logoSize = 132;
  const logoX = box.x + 40;
  const logoY = box.y + 36;
  drawLogo(ctx, assets.logo, logoX, logoY, logoSize);
  drawBadge(ctx, status.badge, status.color, box.x + box.w - 40, logoY + logoSize / 2);

  const avatarR = 118;
  const cx = CARD_WIDTH / 2;
  const cy = logoY + logoSize + 28 + avatarR;
  drawHeadshot(ctx, player, assets.headshot, cx, cy, avatarR, status.color);

  let y = cy + avatarR + 64;
  ctx.font = `800 60px ${FONT}`;
  const nameLines = wrapName(ctx, player?.name || 'Player', box.w - 140);
  y = drawCenteredLines(ctx, nameLines, cx, y, 68, '#F8FAFC');

  const subline = playerPosTeamLabel(player) || teamCode(player) || '';
  if (subline) {
    ctx.font = `700 28px ${FONT}`;
    y = drawCenteredLines(ctx, [subline], cx, y + 8, 36, '#94A3B8');
  }

  const score = formatPoints(view.shown);
  const caption = view.hasActual ? 'PTS' : 'PROJ';
  ctx.font = `900 108px ${FONT}`;
  const scoreW = ctx.measureText(score).width;
  ctx.font = `800 28px ${FONT}`;
  const captionW = ctx.measureText(caption).width;
  const groupW = scoreW + 16 + captionW;
  const scoreX = cx - groupW / 2;
  const scoreY = y + 108;
  ctx.font = `900 108px ${FONT}`;
  ctx.fillStyle = '#F8FAFC';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(score, scoreX, scoreY);
  ctx.font = `800 28px ${FONT}`;
  ctx.fillStyle = '#94A3B8';
  ctx.fillText(caption, scoreX + scoreW + 16, scoreY - 14);

  const pillBottom = drawDeltaPill(ctx, view, cx, scoreY + 28);
  drawStakes(ctx, status.exposure, box.x + 56, pillBottom + 54, box.w - 112);
  drawFooter(ctx, box);
  return canvas;
}

function canvasToPng(canvas) {
  return canvas.toDataURL('image/png');
}

/**
 * 1080×1350 (4:5) trading-card PNG for a player.
 * Headshot and the bundled RootMap logo load with crossOrigin anonymous
 * and fall back to initials / a monogram when the image is blocked.
 */
export async function renderPlayerBragCardDataUrl(player) {
  const assets = await loadCardAssets(player || {});
  try {
    return canvasToPng(paintCard(player || {}, assets));
  } catch {
    try {
      return canvasToPng(paintCard(player || {}, { logo: assets.logo, headshot: null }));
    } catch {
      return canvasToPng(paintCard(player || {}, { logo: null, headshot: null }));
    }
  }
}

function dataUrlToBase64(dataUrl) {
  const value = String(dataUrl || '');
  const comma = value.indexOf(',');
  return comma >= 0 ? value.slice(comma + 1) : value;
}

async function dataUrlToFile(dataUrl, filename) {
  const response = await fetch(dataUrl);
  const blob = await response.blob();
  return new File([blob], filename, { type: 'image/png' });
}

function downloadDataUrl(dataUrl, filename) {
  const link = document.createElement('a');
  link.href = dataUrl;
  link.download = filename;
  link.rel = 'noopener';
  document.body.appendChild(link);
  link.click();
  link.remove();
}

function isShareCanceled(error) {
  const message = String(error?.message || error || '');
  return /share canceled/i.test(message) || error?.name === 'AbortError';
}

function shareFilename(player) {
  const slug = String(player?.name || 'player')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40) || 'player';
  return `rootmap-${slug}-${Date.now()}.png`;
}

async function shareWithCapacitor(dataUrl, title, text, filename) {
  let Capacitor;
  try {
    ({ Capacitor } = await import('@capacitor/core'));
  } catch {
    return 'unavailable';
  }
  if (!Capacitor?.isNativePlatform?.()) return 'unavailable';
  try {
    const { Filesystem, Directory } = await import('@capacitor/filesystem');
    const { Share } = await import('@capacitor/share');
    const written = await Filesystem.writeFile({
      path: filename,
      data: dataUrlToBase64(dataUrl),
      directory: Directory.Cache
    });
    const uri = written?.uri;
    if (!uri) return 'unavailable';
    try {
      await Share.share({ files: [uri], title, text });
    } catch (error) {
      if (isShareCanceled(error)) return 'canceled';
      throw error;
    }
    return 'done';
  } catch (error) {
    if (isShareCanceled(error)) return 'canceled';
    return 'unavailable';
  }
}

async function shareOnWeb(dataUrl, title, text, filename) {
  try {
    const file = await dataUrlToFile(dataUrl, filename);
    if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
      const payload = { files: [file], title, text };
      const allowed = typeof navigator.canShare !== 'function' || navigator.canShare(payload);
      if (allowed) {
        try {
          await navigator.share(payload);
          return;
        } catch (error) {
          if (isShareCanceled(error)) return;
        }
      }
    }
  } catch {
    // Download the PNG when the Web Share sheet cannot take the file.
  }
  downloadDataUrl(dataUrl, filename);
}

/**
 * Write the brag card into the Capacitor cache and open the native share sheet.
 * User cancellation ("Share canceled") is ignored. Outside Capacitor, fall back
 * to the Web Share API and then a PNG download.
 */
export async function sharePlayerBragCard(player) {
  const dataUrl = await renderPlayerBragCardDataUrl(player || {});
  const status = cardStatus(player || {});
  const name = String(player?.name || 'Player').trim() || 'Player';
  const title = `RootMap · ${name}`;
  const text = `${name} · ${status.badge} on RootMap`;
  const filename = shareFilename(player);
  const native = await shareWithCapacitor(dataUrl, title, text, filename);
  if (native === 'done' || native === 'canceled') return;
  await shareOnWeb(dataUrl, title, text, filename);
}
