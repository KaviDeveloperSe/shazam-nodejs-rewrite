import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { createHash, timingSafeEqual } from 'node:crypto';
import { config } from './config.js';
import { InputError, AppError, LimitedError } from './errors.js';
import { recognizeAudio } from './recognize.js';
import { downloadAudio } from './remote.js';
import * as music from './music.js';
import * as catalog from './catalog.js';

const ROUTES = [
  '/search', '/search/auto-complete', '/songs/details', '/songs/lyrics', '/songs/audio-analysis', '/songs/popular-segments',
  '/songs/similar', '/songs/music-videos', '/songs/batch', '/artists/details', '/artists/top-songs', '/artists/albums',
  '/artists/similar', '/artists/music-videos', '/artists/events', '/albums/details', '/albums/related',
  '/charts/top', '/charts/genre', '/charts/viral', '/charts/momentum', '/charts/list',
  '/events/search', '/events/details', '/recognize/url', 'POST /recognize/file'
];
let active = 0;
const counters = new Map();
setInterval(() => { const now = Date.now(); for (const [key, item] of counters) if (now > item.until) counters.delete(key); }, 60000).unref();
function send(res, status, body) {
  const json = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'content-length': Buffer.byteLength(json) });
  res.end(json);
}
function authentication(req) {
  if (!config.apiKey) return true;
  const candidate = String(req.headers['x-api-key'] || '');
  const stored = createHash('sha256').update(config.apiKey).digest();
  const received = createHash('sha256').update(candidate).digest();
  return timingSafeEqual(stored, received);
}
function throttle(req) {
  const ip = req.socket.remoteAddress || 'unknown';
  const now = Date.now();
  const item = counters.get(ip);
  if (!item || now > item.until) { counters.set(ip, { count: 1, until: now + 60000 }); return; }
  if (++item.count > config.rateLimitPerMinute) throw new LimitedError('Rate limit exceeded');
}
function num(value, name, fallback, min, max) {
  const v = value == null || value === '' ? fallback : Number(value);
  if (!Number.isInteger(v) || v < min || v > max) throw new InputError(`${name} must be an integer between ${min} and ${max}`);
  return v;
}
function need(value, name) { if (!value || value.length > 400) throw new InputError(`Missing or invalid ${name}`); return value; }
function queryOptions(q) {
  const country = q.get('country') || 'US';
  const language = q.get('language') || 'en-US';
  if (!/^[a-z]{2}$/i.test(country) || !/^[a-z]{2,3}(?:-[a-z]{2,4})?$/i.test(language)) throw new InputError('Invalid country or language');
  return { country, language, page: num(q.get('page'), 'page', 1, 1, 40), limit: num(q.get('limit'), 'limit', 20, 1, 200) };
}
async function multipartAudio(req) {
  const contentType = req.headers['content-type'] || '';
  const match = contentType.match(/^multipart\/form-data\s*;.*?boundary=(?:"([A-Za-z0-9'()+_,.\/:=?-]{1,70})"|([A-Za-z0-9'()+_,.\/:=?-]{1,70}))/i);
  if (!match) throw new InputError('Send multipart/form-data with field `file`');
  const boundary = match[1] || match[2];
  const maxBytes = config.maxAudioBytes + 65536;
  if (Number(req.headers['content-length']) > maxBytes) throw new InputError('Upload is too large');
  const chunks = [];
  let byteCount = 0;
  for await (const chunk of req) {
    byteCount += chunk.length;
    if (byteCount > maxBytes) throw new InputError('Multipart upload exceeds size limit');
    chunks.push(chunk);
  }
  const whole = Buffer.concat(chunks);
  const marker = Buffer.from('--' + boundary);
  const sep = Buffer.from('\r\n--' + boundary);
  let pos = 0, file = null;
  if (!whole.subarray(0, marker.length).equals(marker)) throw new InputError('Invalid multipart boundary');
  while (pos < whole.length) {
    if (!whole.subarray(pos, pos + marker.length).equals(marker)) throw new InputError('Invalid multipart body');
    pos += marker.length;
    if (whole[pos] === 45 && whole[pos + 1] === 45) break; // closing --
    if (whole[pos] !== 13 || whole[pos + 1] !== 10) throw new InputError('Malformed multipart headers');
    pos += 2;
    const headEnd = whole.indexOf('\r\n\r\n', pos);
    if (headEnd < 0 || headEnd - pos > 8192) throw new InputError('Multipart headers missing/too long');
    const headers = whole.subarray(pos, headEnd).toString('latin1');
    const form = headers.match(/content-disposition:\s*form-data\s*;[^\r\n]*/i)?.[0] || '';
    const name = form.match(/(?:^|;)\s*name="([^"]+)"/i)?.[1];
    const filename = form.match(/(?:^|;)\s*filename="([^"]*)"/i)?.[1] || null;
    pos = headEnd + 4;
    const next = whole.indexOf(sep, pos);
    if (next < 0) throw new InputError('Unterminated multipart field');
    if (['file', 'audio', 'upload_file'].includes(name)) {
      if (file) throw new InputError('Only one audio file is accepted');
      if (next - pos > config.maxAudioBytes) throw new InputError('Audio file too large');
      file = { buffer: whole.subarray(pos, next), filename };
    }
    pos = next + 2;
  }
  if (!file) throw new InputError('Missing audio file: send multipart field `file`');
  return file;
}

async function withSlot(job) {
  if (active >= config.maxConcurrent) throw new AppError('Server busy: maximum recognition jobs reached', 503, 'BUSY');
  active++;
  try { return await job(); } finally { active--; }
}
async function dispatch(req, res) {
  const address = new URL(req.url || '/', 'http://localhost');
  const path = address.pathname.replace(/^\/shazam(?=\/)/, '');
  if (req.method === 'GET' && (path === '/' || path === '/health')) return send(res, 200, { status: 'ok', backend: 'nodejs', recognition_jobs: active, endpoints: ROUTES });
  if (!authentication(req)) return send(res, 401, { error: 'Invalid API key' });
  throttle(req);
  const q = address.searchParams;
  if (req.method === 'POST' && path === '/recognize/file') {
    return send(res, 200, await withSlot(async () => {
      const { buffer, filename } = await multipartAudio(req);
      return recognizeAudio(buffer, { ...Object.fromEntries(q), source: filename });
    }));
  }
  if (req.method !== 'GET' || !ROUTES.includes(path)) return send(res, 404, { error: 'Route not found' });
  if (path === '/recognize/url') return send(res, 200, await withSlot(async () => {
    const url = need(q.get('url'), 'url');
    const buffer = await downloadAudio(url);
    return recognizeAudio(buffer, { ...Object.fromEntries(q), source: url });
  }));
  const opts = queryOptions(q);
  const ref = key => need(q.get(key), key);
  const paging = { ...opts, limit: num(q.get('limit'), 'limit', path.startsWith('/search') ? 10 : 20, 1, 200) };
  let data;
  switch (path) {
    case '/search': data = await music.search(ref('query'), { ...paging, type: q.get('type') || 'all' }); break;
    case '/search/auto-complete': data = await music.suggest(ref('query'), { ...opts, limit: num(q.get('limit'), 'limit', 10, 1, 25) }); break;
    case '/songs/details': data = await music.trackDetails(ref('track'), opts); break;
    case '/songs/lyrics': data = await catalog.songPageFeature('lyrics', ref('track')); break;
    case '/songs/audio-analysis': data = await catalog.songPageFeature('audio-analysis', ref('track')); break;
    case '/songs/popular-segments': data = await catalog.songPageFeature('popular-segments', ref('track')); break;
    case '/songs/similar': data = await music.similarSongs(ref('track'), paging); break;
    case '/songs/music-videos': data = await music.songVideos(ref('track'), opts); break;
    case '/songs/batch': data = await music.songBatch(ref('tracks'), opts); break;
    case '/artists/details': data = await music.artistDetails(ref('artist'), opts); break;
    case '/artists/top-songs': data = await music.artistCollection(ref('artist'), 'top-songs', paging); break;
    case '/artists/albums': data = await music.artistCollection(ref('artist'), 'albums', { ...paging, type: q.get('type') || 'all' }); break;
    case '/artists/similar': data = await music.artistCollection(ref('artist'), 'similar', paging); break;
    case '/artists/music-videos': data = await music.artistCollection(ref('artist'), 'music-videos', paging); break;
    case '/albums/details': data = await music.albumDetails(ref('album'), opts); break;
    case '/albums/related': data = await music.albumRelated(ref('album'), opts); break;
    case '/charts/list': data = await catalog.chartList(q.get('country')); break;
    case '/charts/top': data = await catalog.chartTracks('top', { ...paging, region: q.get('region') || 'world', city: q.get('city') }); break;
    case '/charts/genre': data = await catalog.chartTracks('genre', { ...paging, region: q.get('region') || 'world', genre: ref('genre') }); break;
    case '/charts/viral': data = await catalog.chartTracks('viral', { ...paging, region: q.get('region') || 'world' }); break;
    case '/charts/momentum': data = await catalog.chartTracks('momentum', { ...paging, region: q.get('region') || 'US' }); break;
    case '/events/search': data = await catalog.eventSearch({ region: q.get('region') || 'US', city: q.get('city'), genre: q.get('genre'), upcoming_only: q.get('upcoming_only') || 'true' }); break;
    case '/events/details': data = await catalog.eventPage(ref('event')); break;
    case '/artists/events': data = await catalog.artistEvents(ref('artist')); break;
    default: throw new AppError('Route not implemented', 501, 'NOT_IMPLEMENTED');
  }
  if (data?.pagination) {
    const { pagination, ...rest } = data;
    const currentPage = pagination.page ?? opts.page;
    const totalPages = pagination.total_pages || currentPage;
    const pageUrl = p => { const u = new URL(address); u.searchParams.set('page', String(p)); return u.toString(); };
    data = {
      count: pagination.total_count ?? null, per_page: pagination.items_per_page ?? opts.limit,
      current_page: currentPage, total_pages: totalPages,
      next: currentPage < totalPages ? pageUrl(currentPage + 1) : null,
      previous: currentPage > 1 ? pageUrl(currentPage - 1) : null,
      ...Object.fromEntries(Object.entries(rest).filter(([k]) => k !== 'count')),
    };
  }
  send(res, 200, data);
}
export function createServer() {
  return http.createServer((req, res) => {
    dispatch(req, res).catch(error => {
      if (res.headersSent) return res.end();
      const status = Number.isInteger(error.status) ? error.status : 500;
      if (status >= 500) console.error('[request]', error.code || 'ERROR', error.message);
      send(res, status, { error: status >= 500 && !(error instanceof AppError) ? 'Internal server error' : error.message, code: error.code || 'ERROR' });
    });
  });
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  createServer().listen(config.port, config.host, () => {
    console.log(`Shazam Node API listening on http://${config.host}:${config.port}`);
    if (!config.apiKey && !['127.0.0.1', '::1', 'localhost'].includes(config.host)) console.warn('WARNING: Server is exposed without an API_KEY');
  });
}
