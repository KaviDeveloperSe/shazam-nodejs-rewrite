import { config } from './config.js';
import { NotFoundError, UpstreamError } from './errors.js';

export async function fetchPage(path) {
  if (!/^\/(track\/\d+|artist\/[a-z0-9-]+\/\d+|charts\/top-200\/world|events\/[a-z0-9-]+(?:\/[a-z0-9-]+)?|event\/[0-9a-f-]{36})$/.test(path)) throw new NotFoundError('Unsupported page');
  let response;
  try { response = await fetch('https://www.shazam.com' + path, { headers: { accept: 'text/html', 'user-agent': 'Mozilla/5.0' }, redirect: 'error', signal: AbortSignal.timeout(config.requestTimeoutMs) }); }
  catch (e) { throw new UpstreamError('Failed to request Shazam page: ' + e.message); }
  if (response.status === 404) throw new NotFoundError('Shazam page not found');
  if (!response.ok) throw new UpstreamError(`Shazam page returned HTTP ${response.status}`);
  const html = await response.text();
  if (html.includes('id="__next_error__"')) throw new NotFoundError('Shazam page does not exist');
  if (!html.includes('self.__next_f')) throw new UpstreamError('Shazam page lacks RSC flight data; layout changed or blocked');
  return html;
}

/** The original project's cricbuzz/rsc.py flight payload decoder, rewritten for Node.js. */
export function flightText(html) {
  const chunks = [];
  for (const m of html.matchAll(/self\.__next_f\.push\(\[1,"((?:[^"\\]|\\.)*)"\]\)/gs)) {
    try { chunks.push(JSON.parse('"' + m[1] + '"')); } catch { /* ignore invalid chunk */ }
  }
  return chunks.join('');
}
export function flightRows(html) {
  const text = Buffer.from(flightText(html), 'utf8');
  const rows = {};
  let pos = 0;
  while (pos < text.length) {
    const colon = text.indexOf(58, pos);
    if (colon < 0) break;
    const key = text.subarray(pos, colon).toString('ascii');
    if (!/^[0-9a-f]+$/i.test(key)) {
      const nl = text.indexOf(10, pos); if (nl < 0) break;
      pos = nl + 1; continue;
    }
    pos = colon + 1;
    if (text[pos] === 84) { // T<hex-byte-count>,<content>
      const comma = text.indexOf(44, pos);
      if (comma < 0) break;
      const len = Number.parseInt(text.subarray(pos + 1, comma).toString('ascii'), 16) || 0;
      rows[key] = text.subarray(comma + 1, comma + 1 + len).toString('utf8');
      pos = comma + 1 + len;
      if (text[pos] === 10) pos++;
      continue;
    }
    const nl = text.indexOf(10, pos);
    const end = nl < 0 ? text.length : nl;
    const body = text.subarray(pos, end).toString('utf8');
    pos = end + 1;
    if (/^[\[{]/.test(body)) { try { rows[key] = JSON.parse(body); continue; } catch {} }
    rows[key] = body;
  }
  return rows;
}
export function findObjects(rows, predicate, limit = 50) {
  const hits = [], visited = new Set();
  function walk(obj, depth = 0) {
    if (!obj || typeof obj !== 'object' || hits.length >= limit || depth > 100 || visited.has(obj)) return;
    visited.add(obj);
    if (!Array.isArray(obj) && predicate(obj)) { hits.push(obj); return; }
    for (const v of Object.values(obj)) walk(v, depth + 1);
  }
  for (const row of Object.values(rows)) walk(row);
  return hits;
}
export function findObject(rows, predicate) { return findObjects(rows, predicate, 1)[0] || null; }
export function elementText(node) {
  if (typeof node === 'string') return node.startsWith('$') ? '' : node;
  if (Array.isArray(node)) {
    if (node[0] === '$' && node.length === 4) return elementText(node[3]?.children);
    return node.map(elementText).filter(Boolean).join(' ');
  }
  if (node && typeof node === 'object') return elementText(node.children);
  return '';
}
export async function trackPage(key) {
  const html = await fetchPage(`/track/${key}`);
  const rows = flightRows(html);
  const song = findObject(rows, d => d.type === 'shazam-songs' && d.attributes);
  if (!song) throw new NotFoundError(`Track ${key} has no embedded page metadata`);
  return {
    song,
    appleSong: findObject(rows, d => d.type === 'songs' && d.attributes?.isrc),
    lyrics: findObjects(rows, d => Array.isArray(d.lyricLines), 200),
    analysis: findObject(rows, d => !!d.audioAnalysis)?.audioAnalysis || null,
    segments: findObjects(rows, d => d.dataPoint?.tags != null, 200),
  };
}
export async function chartsPage() {
  const html = await fetchPage('/charts/top-200/world');
  const rows = flightRows(html);
  const match = findObject(rows, d => Array.isArray(d.options) && d.options?.[0]?.listid && Array.isArray(d.options?.[0]?.genres));
  if (!match) throw new NotFoundError('Chart catalog is missing');
  return match.options.map(o => ({
    code: o.id === 'world' ? null : o.id, name: o.id === 'world' ? 'Global' : o.name,
    slug: o.id === 'world' ? 'world' : (o.urlName ? decodeURIComponent(o.urlName) : o.name?.toLowerCase().replaceAll(' ', '-')),
    top_playlist_id: o.listid, viral_playlist_id: o.viral_listid, momentum_playlist_id: o.momentum_listid,
    cities: (o.cities || []).map(c => ({ id: c.id, name: c.name, slug: c.urlName, playlist_id: c.listid })),
    genres: (o.genres || []).map(g => ({ id: g.id, name: g.name, slug: g.urlName, playlist_id: g.listid, track_count: Number(g.count) || null })),
  }));
}
function seconds(value) {
  if (value == null || value === '') return null;
  if (typeof value === 'number') return value;
  const m = String(value).match(/^(\d+):(\d{2})$/);
  if (m) return Number(m[1]) * 60 + Number(m[2]);
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}
export function parseLyrics(blocks) {
  const sections = blocks.map(b => ({
    title: b.sectionTitle || null,
    start_seconds: seconds(b.startTimeInSeconds),
    end_seconds: seconds(b.endTimeInSeconds),
    lines: (b.lyricLines || []).filter(line => line && typeof line === 'object').map(line => ({
      text: line.content ?? null,
      start_seconds: seconds(line.startTimeInSeconds),
      end_seconds: seconds(line.endTimeInSeconds),
    })),
  }));
  if (!sections.length) return null;
  return {
    is_time_synced: sections.some(s => s.lines.some(l => l.start_seconds != null)),
    text: sections.map(s => s.lines.map(l => l.text).filter(Boolean).join('\n')).join('\n\n') || null,
    line_count: sections.reduce((n, s) => n + s.lines.length, 0), sections,
  };
}
export function parseAudioAnalysis(data) {
  if (!data) return null;
  const out = {};
  for (const key of ['bpm', 'energy', 'danceability', 'valence', 'acousticness', 'melodicness']) {
    const value = Number(data[key]);
    out[key] = data[key] == null || !Number.isFinite(value) ? null : key === 'bpm' ? Math.trunc(value) : Math.round(value * 1000) / 1000;
  }
  return Object.values(out).some(v => v != null) ? out : null;
}
export function parsePopularSegments(points, lengthSeconds = null, description = null) {
  const segments = points.map(p => p.dataPoint || p).map(d => ({
    start_seconds: seconds(d.startTime), end_seconds: seconds(d.endTime),
    shazam_count: d.tags == null ? null : Number.parseInt(d.tags, 10),
    share_of_peak: d.heightPercentage == null ? null : Math.round(Number(d.heightPercentage) * 10000) / 10000,
    share_of_track: d.lengthPercentage == null ? null : Math.round(Number(d.lengthPercentage) * 10000) / 10000,
  }));
  if (!segments.length) return null;
  const peak = segments.reduce((a, b) => (b.shazam_count || 0) > (a.shazam_count || 0) ? b : a);
  return { period: 'past_7_days', track_length_seconds: lengthSeconds,
    most_popular: { start_seconds: peak.start_seconds, end_seconds: peak.end_seconds, shazam_count: peak.shazam_count },
    description, segments };
}

export async function eventPage(eventId) {
  const html = await fetchPage(`/event/${eventId}`);
  const obj = findObject(flightRows(html), d => d.type === 'shazam-events' && d.attributes);
  if (!obj) throw new NotFoundError('Event not found');
  return parseEvent(obj);
}
export function parseEvent(obj) {
  const a = obj.attributes || {}, t = a.time || {}, ven = obj._venues;
  const venue = Array.isArray(ven) ? ven[0] : ven;
  return { id: obj.id, name: a.name ?? null, link: a.webUrl ?? null, kind: a.kind?.toLowerCase() ?? null,
    starts_at: t.startTime ?? null, ends_at: t.endTime ?? null, timezone: t.timezone ?? null,
    is_upcoming: t.isFuture ?? null, is_virtual: !!a.isVirtual,
    artists: (Array.isArray(obj._artists) ? obj._artists : (obj._artists ? [obj._artists] : [])).map(r => ({ apple_id: r.id, name: r.attributes?.name || null })),
    venue: venue ? { id: venue.id, name: venue.attributes?.name || null, address: venue.attributes?.address || null, latitude: venue.attributes?.geo?.lat || null, longitude: venue.attributes?.geo?.lng || null } : null,
    tickets: { provider: a.tickets?.provider || a.provider?.name || null, link: a.tickets?.url || a.provider?.url || null } };
}
export async function eventsPage(country, city) {
  const html = await fetchPage('/events/' + country + (city ? '/' + city : ''));
  const rows = flightRows(html);
  const seen = new Set();
  const events = findObjects(rows, d => d.type === 'shazam-events' && d.attributes, 500).filter(d => {
    if (seen.has(d.id)) return false; seen.add(d.id); return true;
  }).map(parseEvent);
  return { events, title: html.match(/<title>(.*?)<\/title>/)?.[1] || null };
}

export async function artistPage(artistId) {
  if (!/^\d{1,12}$/.test(String(artistId))) throw new NotFoundError('Invalid artist ID');
  const html = await fetchPage(`/artist/artist/${artistId}`);
  const rows = flightRows(html);
  const raw = flightText(html);
  const links = [...new Set([...raw.matchAll(/"href":"(\/event\/[0-9a-f-]{36})"/gi)].map(m => m[1]))];
  const attributes = findObjects(rows, d => d.dataTestId === 'artist_bioViewMore', 1);
  const bioObj = attributes.length ? findObject({ one: attributes[0] }, d => typeof d.dangerouslySetInnerHTML === 'object') : null;
  const bioRef = bioObj?.dangerouslySetInnerHTML?.__html;
  const bio = typeof bioRef === 'string' ? (bioRef.startsWith('$') ? rows[bioRef.slice(1)] || null : bioRef) : null;
  const title = html.match(/<title>(.*?)<\/title>/)?.[1]?.split(' - Shazam')[0] || null;
  return { name: title, event_links: links, bio: bio?.replace(/<[^>]+>/g, '') || null };
}
