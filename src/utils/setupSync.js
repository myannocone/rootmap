const LINK_LIMIT = 12000;

function bytesToBase64Url(bytes) {
  let binary = '';
  const list = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  for (let i = 0; i < list.length; i += 1) binary += String.fromCharCode(list[i]);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64UrlToBytes(value) {
  const cleaned = String(value || '').replace(/\s/g, '').replace(/-/g, '+').replace(/_/g, '/');
  const padded = cleaned + '='.repeat((4 - (cleaned.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export function extractSetupToken(raw) {
  const text = String(raw || '').trim();
  if (!text) return '';
  try {
    const url = new URL(text);
    const imported = url.searchParams.get('import');
    if (imported) return imported.trim();
  } catch {
    // plain codes are not URLs
  }
  const match = text.match(/[?&]import=([^&\s]+)/);
  if (match) {
    try {
      return decodeURIComponent(match[1]);
    } catch {
      return match[1];
    }
  }
  return text;
}

export async function encodeSetupPayload(json) {
  const source = typeof json === 'string' ? json : JSON.stringify(json ?? []);
  const bytes = new TextEncoder().encode(source);
  try {
    if (typeof CompressionStream !== 'undefined') {
      const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('gzip'));
      const packed = new Uint8Array(await new Response(stream).arrayBuffer());
      return `rmz.${bytesToBase64Url(packed)}`;
    }
  } catch {
    // fall through to an uncompressed code
  }
  return `rm1.${bytesToBase64Url(bytes)}`;
}

export async function decodeSetupJson(raw) {
  const token = extractSetupToken(raw);
  if (!token) return '';
  if (token.startsWith('rmz.') || token.startsWith('rm1.')) {
    const bytes = base64UrlToBytes(token.slice(4));
    if (token.startsWith('rmz.') && typeof DecompressionStream !== 'undefined') {
      const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
      return new Response(stream).text();
    }
    return new TextDecoder().decode(bytes);
  }
  try {
    const standard = token.replace(/-/g, '+').replace(/_/g, '/');
    const padded = standard + '='.repeat((4 - (standard.length % 4)) % 4);
    return atob(padded.replace(/\s/g, ''));
  } catch {
    return token;
  }
}

export function setupLinkFor(origin, pathname, code) {
  if (!code || code.length > LINK_LIMIT) return '';
  const url = new URL(pathname || '/', origin || 'http://localhost');
  url.search = '';
  url.hash = '';
  url.searchParams.set('import', code);
  return url.toString();
}

export function linkIsLocalOnly(hostname) {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
}
