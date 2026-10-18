import { config } from './config.js';
import { getJson, discoverTrack, cdnList } from './transport.js';
import { InputError, NotFoundError, UpstreamError } from './errors.js';
import { parseAppleItem, parseAppleItems, parseDiscoveryTrack, parseListTrack, asPagination } from './parser.js';

let cachedToken = null, cachedExp = 0, acquiring = null;
function decodeExpiry(token) {
  try { return JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8')).exp || 0; } catch { return 0; }
}
async function musicToken(force = false) {
  if (!force && cachedToken && Date.now() / 1000 < cachedExp - 3600) return cachedToken;
  if (!force && config.musicKitToken) return config.musicKitToken;
  if (acquiring) return acquiring;
  acquiring = (async () => {
    const res = await fetch('https://www.shazam.com/services/musickit/validate', { headers: { Origin: 'https://www.shazam.com', Referer: 'https://www.shazam.com/' }, redirect: 'error', signal: AbortSignal.timeout(config.requestTimeoutMs) });
    if (!res.ok) throw new UpstreamError(`Could not obtain MusicKit token (HTTP ${res.status})`);
    const token = res.headers.get('x-shz-validation');
    await res.body?.cancel();
    if (!token || token.split('.').length !== 3) throw new UpstreamError('No MusicKit developer token was provided');
    cachedToken = token;
    cachedExp = decodeExpiry(token) || Date.now() / 1000 + 86400;
    return token;
  })();
  try { return await acquiring; } finally { acquiring = null; }
}
export async function appleGet(path, { country = 'US', language = 'en-US', params = {}, refresh = true } = {}) {
  const url = new URL('https://api.music.apple.com/v1/catalog/' + country.toLowerCase() + '/' + path.replace(/^\//, ''));
  if (language) url.searchParams.set('l', language);
  for (const [k, v] of Object.entries(params)) if (v != null && v !== '') url.searchParams.set(k, String(v));
  const token = await musicToken();
  try { return await getJson(url, { headers: { authorization: `Bearer ${token}` }, retries: 1 }); }
  catch (e) {
    // A token can expire or be revoked at any time; refresh once on 401.
    if (e.message.includes('HTTP 401') && refresh && !config.musicKitToken) {
      await musicToken(true);
      return appleGet(path, { country, language, params, refresh: false });
    }
    throw e;
  }
}
async function shazamKeys(ids, { country = 'US', language = 'en-US' } = {}) {
  if (!ids.length) return {};
  const unique = [...new Set(ids.map(String))].filter(Boolean);
  const url = `https://www.shazam.com/services/sd/s/a2st/${encodeURIComponent(country.toLowerCase())}/${encodeURIComponent(language.split('-')[0].toLowerCase())}/${unique.join(',')}`;
  try { return await getJson(url); } catch (e) { if (e instanceof NotFoundError) return {}; throw e; }
}
export async function addKeys(items, opts) {
  if (!items.length) return [];
  const keys = await shazamKeys(items.filter(s => s.type === 'songs').map(s => s.id), opts);
  return items.map(item => {
    if (item.type !== 'songs') return item;
    const key = keys[item.id] || null;
    return { shazam_key: key, apple_id: item.id, shazam_link: key ? `https://www.shazam.com/track/${key}` : null, ...Object.fromEntries(Object.entries(item).filter(([k]) => k !== 'id')) };
  });
}
function refId(input, kind) {
  if (input == null || input === '') throw new InputError(`Missing ${kind} identifier`);
  const text = String(input);
  if (/^\d+$/.test(text)) return text;
  try {
    const url = new URL(text);
    if (!['www.shazam.com', 'shazam.com', 'music.apple.com'].includes(url.hostname)) throw Error();
    const parts = url.pathname.split('/');
    const idx = parts.findIndex(p => p === kind || p === kind + 's');
    const id = kind === 'track' ? parts.slice(idx + 1).find(p => /^\d+$/.test(p)) : parts.slice(idx + 1).find(p => /^\d+$/.test(p));
    if (id) return id;
  } catch { /* identifiers handled below */ }
  throw new InputError(`Invalid ${kind} ID or link`);
}
function parseTrackRef(input) {
  const text = String(input ?? '').trim();
  if (/^\d{1,12}$/.test(text)) return { key: text };
  if (/^(shazam:|key:)\d{1,12}$/i.test(text)) return { key: text.split(':').at(-1) };
  if (/^(apple:|apple_id:|adam:)\d{1,12}$/i.test(text)) return { appleId: text.split(':').at(-1) };
  const maybeIsrc = text.toUpperCase().replaceAll('-', '');
  if (/^[A-Z]{2}[A-Z0-9]{3}\d{7}$/.test(maybeIsrc)) return { isrc: maybeIsrc };
  let url;
  try { url = new URL(text); } catch { throw new InputError('track must be a Shazam key, apple:<id>, ISRC, or Shazam/Apple Music URL'); }
  if (!['shazam.com', 'www.shazam.com', 'music.apple.com'].includes(url.hostname)) throw new InputError('Unsupported track URL hostname');
  const parts = url.pathname.split('/').filter(Boolean);
  const section = parts.indexOf('track');
  if (section !== -1 && url.hostname.includes('shazam.com')) {
    const key = parts.slice(section + 1).find(v => /^\d{1,12}$/.test(v));
    if (key) return { key };
  }
  const appleSection = parts.findIndex(v => ['song', 'album'].includes(v));
  if (appleSection !== -1) {
    const appleId = url.searchParams.get('i') || parts.slice(appleSection + 1).find(v => /^\d{1,12}$/.test(v));
    if (/^\d{1,12}$/.test(appleId || '')) return { appleId };
  }
  throw new InputError('Could not identify a track ID from this URL');
}

async function oneApple(kind, id, opts, params = {}) {
  const body = await appleGet(`${kind}/${id}`, { ...opts, params });
  if (!body.data?.[0]) throw new NotFoundError(`${kind} ${id} not found`);
  return body.data[0];
}
export async function search(query, { type = 'all', page = 1, limit = 10, ...opts } = {}) {
  if (!query || query.length > 250) throw new InputError('query must contain 1–250 characters');
  const kinds = ['songs', 'artists', 'albums', 'playlists', 'music-videos'];
  if (type !== 'all' && !kinds.includes(type)) throw new InputError('Invalid search type');
  const used = type === 'all' ? kinds : [type];
  const body = await appleGet('search', { ...opts, params: { term: query, types: used.join(','), limit, offset: (page - 1) * limit, ...(type === 'all' ? { with: 'topResults' } : {}) } });
  const result = body.results || {}, out = { query, type, country: (opts.country || 'US').toUpperCase(), language: opts.language || 'en-US' };
  let hasMore = false;
  if (type === 'all') {
    out.top_results = parseAppleItems(result.topResults?.data);
    for (const kind of kinds) {
      const records = parseAppleItems(result[kind]?.data);
      out[kind.replace('-', '_')] = kind === 'songs' ? await addKeys(records, opts) : records;
      hasMore ||= !!result[kind]?.next;
    }
    out.count = kinds.reduce((sum, k) => sum + out[k.replace('-', '_')].length, 0);
  } else {
    const records = parseAppleItems(result[type]?.data);
    out.results = type === 'songs' ? await addKeys(records, opts) : records;
    out.count = out.results.length;
    hasMore = !!result[type]?.next;
  }
  out.pagination = asPagination({ page, limit, hasMore });
  return out;
}
export async function suggest(query, { limit = 10, ...opts } = {}) {
  if (!query) throw new InputError('query required');
  const body = await appleGet('search/hints', { ...opts, params: { term: query, limit } });
  const suggestions = body.results?.terms || [];
  return { query, country: (opts.country || 'US').toUpperCase(), count: suggestions.length, suggestions };
}
export async function trackDetails(ref, opts = {}) {
  const parsed = parseTrackRef(ref);
  let key = parsed.key;
  let appleObj = null;
  if (!key) {
    if (parsed.appleId) appleObj = await oneApple('songs', parsed.appleId, opts);
    else {
      const body = await appleGet('songs', { ...opts, params: { 'filter[isrc]': parsed.isrc } });
      appleObj = body.data?.[0];
      if (!appleObj) throw new NotFoundError('No song with requested ISRC');
    }
    const keys = await shazamKeys([appleObj.id], opts);
    key = keys[appleObj.id];
    if (!key) throw new NotFoundError('Apple song is not available in Shazam catalog');
  }
  const discovery = await discoverTrack(key, opts);
  const info = parseDiscoveryTrack(discovery);
  let apple = appleObj ? parseAppleItem(appleObj) : null;
  if (!apple && info.apple_id) {
    try { apple = parseAppleItem(await oneApple('songs', info.apple_id, opts)); }
    catch (e) { if (!(e instanceof NotFoundError)) throw e; }
  }
  return {
    ...info,
    title: apple?.name || info.title,
    artist_name: apple?.artist_name || info.artist_name,
    apple_music_link: apple?.link || info.hub?.listen_link || null,
    genres: apple?.genres ?? null,
    duration_ms: apple?.duration_ms ?? null,
    composer_name: apple?.composer_name ?? null,
    has_lyrics: apple?.has_lyrics ?? null,
    preview_link: apple?.preview_link || info.hub?.preview_link || null,
    artwork: apple?.artwork ?? null,
  };
}

export async function similarSongs(ref, { page = 1, limit = 20, ...opts } = {}) {
  const key = refId(ref, 'track');
  const disc = await discoverTrack(key, opts);
  const listId = parseDiscoveryTrack(disc).related_list_id || `track-similarities-id-${key}`;
  const offset = (page - 1) * limit;
  let body;
  try { body = await cdnList(listId, { ...opts, startFrom: offset, pageSize: limit }); }
  catch (e) { if (e instanceof NotFoundError) body = { tracks: [] }; else throw e; }
  const raw = body.tracks || [];
  return { shazam_key: key, title: disc.title, artist_name: disc.subtitle, count: raw.length,
    results: raw.map((obj, i) => parseListTrack(obj, offset + i + 1)),
    pagination: asPagination({ page, limit, hasMore: !!body.next || raw.length >= limit }) };
}
export async function songVideos(ref, opts = {}) {
  const detail = await trackDetails(ref, opts);
  if (!detail.apple_id) throw new NotFoundError('No Apple ID for this song');
  let body;
  try { body = await appleGet(`songs/${detail.apple_id}/music-videos`, opts); }
  catch (e) { if (e instanceof NotFoundError) body = { data: [] }; else throw e; }
  const items = parseAppleItems(body.data);
  return { shazam_key: detail.shazam_key, apple_id: detail.apple_id, count: items.length, results: items };
}
export async function songBatch(input, opts = {}) {
  const tracks = [...new Set(String(input || '').split(',').map(s => s.trim()).filter(Boolean))];
  if (!tracks.length || tracks.length > 25) throw new InputError('tracks must list 1–25 track IDs');
  const items = [];
  for (let i = 0; i < tracks.length; i += 5) {
    const results = await Promise.allSettled(tracks.slice(i, i + 5).map(s => trackDetails(s, opts)));
    items.push(...results.filter(r => r.status === 'fulfilled').map(r => r.value));
  }
  return { country: (opts.country || 'US').toUpperCase(), count: items.length, results: items };
}

export async function artistDetails(ref, opts = {}) {
  const id = refId(ref, 'artist');
  const obj = await oneApple('artists', id, opts, { views: 'top-songs,latest-release,similar-artists,top-music-videos,full-albums' });
  const a = parseAppleItem(obj);
  const views = obj.views || {};
  return { apple_id: id, name: a.name, link: `https://www.shazam.com/artist/artist/${id}`, apple_music_link: a.link,
    genres: a.genres, bio: a.bio, origin: a.origin, born_or_formed: a.born_or_formed, is_group: a.is_group,
    artwork: a.artwork, top_songs: await addKeys(parseAppleItems(views['top-songs']?.data), opts),
    latest_release: parseAppleItem(views['latest-release']?.data?.[0]),
    similar_artists: parseAppleItems(views['similar-artists']?.data), albums: parseAppleItems(views['full-albums']?.data),
    top_music_videos: parseAppleItems(views['top-music-videos']?.data) };
}
export async function artistCollection(ref, section, { page = 1, limit = 20, type = 'all', ...opts } = {}) {
  const id = refId(ref, 'artist');
  let path;
  if (section === 'top-songs') path = `artists/${id}/view/top-songs`;
  else if (section === 'albums') path = type === 'all' ? `artists/${id}/albums` : `artists/${id}/view/${({ albums: 'full-albums', singles: 'singles', live: 'live-albums', compilations: 'compilation-albums', 'appears-on': 'appears-on-albums' })[type]}`;
  else if (section === 'similar') path = `artists/${id}/view/similar-artists`;
  else if (section === 'music-videos') path = `artists/${id}/music-videos`;
  else throw new InputError('Unknown artist collection');
  const body = await appleGet(path, { ...opts, params: { limit, offset: (page - 1) * limit } });
  const raw = parseAppleItems(body.data);
  const items = section === 'top-songs' ? await addKeys(raw, opts) : raw;
  const base = { artist_apple_id: id, country: (opts.country || 'US').toUpperCase(), count: items.length, results: items };
  if (section !== 'similar') base.pagination = asPagination({ page, limit, hasMore: !!body.next });
  if (section === 'albums') base.type = type;
  return base;
}
export async function albumDetails(ref, opts = {}) {
  const id = refId(ref, 'album');
  const obj = await oneApple('albums', id, opts, { include: 'tracks,artists,record-labels' });
  const a = parseAppleItem(obj);
  return { apple_id: id, name: a.name, link: `https://www.shazam.com/album/${id}`, apple_music_link: a.link,
    artist_name: a.artist_name, artwork: a.artwork, genres: a.genres, release_date: a.release_date,
    track_count: a.track_count, copyright: a.copyright, upc: a.upc,
    tracks: await addKeys(parseAppleItems(obj.relationships?.tracks?.data), opts),
    artists: parseAppleItems(obj.relationships?.artists?.data) };
}
export async function albumRelated(ref, opts = {}) {
  const id = refId(ref, 'album');
  const obj = await oneApple('albums', id, opts, { views: 'related-albums,appears-on,other-versions' });
  const result = { apple_id: id, name: obj.attributes?.name ?? null, country: (opts.country || 'US').toUpperCase() };
  for (const view of ['related-albums', 'appears-on', 'other-versions']) result[view.replaceAll('-', '_')] = parseAppleItems(obj.views?.[view]?.data);
  return result;
}
