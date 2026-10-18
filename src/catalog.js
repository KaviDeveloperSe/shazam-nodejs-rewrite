import { chartsPage, trackPage, parseLyrics, parseAudioAnalysis, parsePopularSegments, eventsPage, eventPage, artistPage } from './pages.js';
import { appleGet, addKeys } from './music.js';
import { parseAppleItems } from './parser.js';
import { InputError, NotFoundError } from './errors.js';

let cache = null;
async function chartCatalog() {
  if (cache && cache.until > Date.now()) return cache.value;
  const value = await chartsPage();
  cache = { value, until: Date.now() + 6 * 3600 * 1000 };
  return value;
}
async function region(token = 'world') {
  const list = await chartCatalog();
  const entry = list.find(c => [c.code, c.name, c.slug].some(v => v && v.toLowerCase() === token.toLowerCase()));
  if (!entry) throw new NotFoundError(`No chart region ${token}`);
  return entry;
}
export async function chartList(country) {
  const list = country ? [await region(country)] : await chartCatalog();
  return { count: list.length, regions: list };
}
export async function chartTracks(kind, { region: regionId = 'world', city, genre, page = 1, limit = 50, country = 'US', language = 'en-US' } = {}) {
  const entry = await region(regionId);
  let playlist = entry.top_playlist_id;
  if (kind === 'viral') playlist = entry.viral_playlist_id;
  else if (kind === 'momentum') playlist = entry.momentum_playlist_id;
  else if (kind === 'genre') {
    const g = entry.genres.find(g => [g.slug, g.name].some(v => v?.toLowerCase() === genre?.toLowerCase()));
    if (!g) throw new NotFoundError('Unknown chart genre');
    playlist = g.playlist_id;
  } else if (city) {
    const match = entry.cities.find(c => [c.slug, c.name].some(v => v?.toLowerCase() === city.toLowerCase()));
    if (!match) throw new NotFoundError('Unknown chart city');
    playlist = match.playlist_id;
  }
  if (!playlist) throw new NotFoundError('No playlist available for that chart');
  const body = await appleGet(`playlists/${playlist}/tracks`, { country, language, params: { limit, offset: (page - 1) * limit } });
  const ranked = await addKeys(parseAppleItems(body.data), { country, language });
  return { chart: kind, region: { code: entry.code, name: entry.name, slug: entry.slug }, city: city || null, genre: genre || null,
    playlist_id: playlist, count: body.data?.length || 0,
    results: ranked.map((song, i) => ({ rank: (page - 1) * limit + i + 1, ...song })),
    pagination: { page, items_per_page: limit, total_count: null, total_pages: 0, has_more: !!body.next } };
}
export async function songPageFeature(kind, track) {
  const id = String(track || '').match(/(?:\/track\/)?(\d+)/)?.[1];
  if (!id) throw new InputError('track must be a Shazam numeric key or link');
  const page = await trackPage(id);
  const a = page.song.attributes || {};
  const identity = { shazam_key: id, apple_id: page.song._adamId || page.appleSong?.id || null,
    title: a.title || null, artist_name: a.artist || a.primaryArtist || null,
    link: a.webUrl?.split('?')[0] || `https://www.shazam.com/track/${id}` };
  if (kind === 'lyrics') return { ...identity, has_lyrics: page.song.hasLyrics ?? !!page.lyrics.length,
    has_time_synced_lyrics: page.song.hasTimeSyncedLyrics ?? null, lyrics: parseLyrics(page.lyrics) };
  if (kind === 'audio-analysis') return { ...identity, isrc: a.isrc || null, label: a.label || null,
    genre: a.genres?.primary || null, audio_analysis: parseAudioAnalysis(page.analysis), is_ai_generated: page.analysis ? true : null };
  if (kind === 'popular-segments') return { ...identity, popular_segments: parsePopularSegments(page.segments) };
  throw new InputError('Unknown feature');
}
export async function eventSearch({ region = 'US', city = null, genre = null, upcoming_only = 'true' } = {}) {
  const aliases = { US: 'united-states', GB: 'united-kingdom', AE: 'united-arab-emirates' };
  const slug = aliases[region.toUpperCase()] || region.toLowerCase().replaceAll(' ', '-');
  const { events, title } = await eventsPage(slug, city);
  let matches = events;
  if (genre) matches = matches.filter(e => (e.genres || []).some(g => g.toLowerCase().includes(genre.toLowerCase())));
  if (upcoming_only !== 'false') matches = matches.filter(e => e.is_upcoming !== false);
  matches.sort((a, b) => (a.starts_at || '').localeCompare(b.starts_at || ''));
  return { region: slug, city, title, genre_filter: genre, count: matches.length, results: matches };
}
export { eventPage };

export async function artistEvents(ref) {
  const text = String(ref || '');
  const id = text.match(/(?:\/artist\/[^/]*\/)?(\d{1,12})\/?$/)?.[1];
  if (!id) throw new InputError('Invalid artist ID');
  const profile = await artistPage(id);
  const events = (await Promise.allSettled(profile.event_links.slice(0, 12).map(link => eventPage(link.split('/').at(-1)))))
    .filter(r => r.status === 'fulfilled').map(r => r.value);
  events.sort((a, b) => (a.starts_at || '').localeCompare(b.starts_at || ''));
  return { artist_apple_id: id, artist_name: profile.name, count: events.length, results: events };
}
