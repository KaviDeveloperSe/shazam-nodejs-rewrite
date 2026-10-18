function nonEmpty(v) { return v == null || v === '' ? null : v; }
const cleanLink = url => typeof url === 'string' ? url.split('?')[0] : null;
function parseColors(v) {
  if (!v) return null;
  const out = {};
  const names = { b: 'background', p: 'primary', s: 'secondary', t: 'tertiary', q: 'quaternary' };
  for (const [, k, c] of v.matchAll(/([bpstq]):([\da-f]{6})/ig)) out[names[k]] = '#' + c.toLowerCase();
  return Object.keys(out).length ? out : null;
}
function parseHub(hub) {
  if (!hub || typeof hub !== 'object') return null;
  let listenLink = null, previewLink = null;
  for (const a of hub.actions || []) {
    if (a.type === 'applemusicplay' && a.id) listenLink = `https://music.apple.com/song/${a.id}`;
    if (a.type === 'uri' && /^https?:/.test(a.uri || '')) previewLink = a.uri;
  }
  for (const opt of hub.options || []) for (const a of opt.actions || []) {
    if (!listenLink && a.type === 'uri' && (a.uri || '').includes('music.apple.com')) listenLink = a.uri.split('&mttnagencyid')[0];
  }
  return { provider: hub.displayname || hub.type || null, is_explicit: !!hub.explicit, listen_link: listenLink, preview_link: previewLink };
}
export function parseDiscoveryTrack(obj) {
  if (!obj || typeof obj !== 'object') return null;
  const images = obj.images || {};
  const sections = obj.sections || [];
  const meta = {};
  for (const section of sections) if (section.type === 'SONG') for (const row of section.metadata || []) meta[String(row.title || '').toLowerCase()] = row.text;
  const hub = parseHub(obj.hub);
  const related = sections.find(s => s.type === 'RELATED')?.url || obj.relatedtracksurl || '';
  const artistIds = (obj.artists || []).map(a => ({ apple_id: a.adamid ?? null, shazam_id: a.id ?? null, slug: a.alias ?? null }));
  return {
    shazam_key: obj.key ?? null,
    apple_id: obj.trackadamid || hub?.listen_link?.split('/').at(-1) || null,
    title: obj.title ?? null,
    artist_name: obj.subtitle ?? null,
    link: cleanLink(obj.url),
    isrc: obj.isrc ?? null,
    genre: obj.genres?.primary ?? null,
    release_date: obj.releasedate ?? meta.released ?? null,
    album_name: meta.album ?? null,
    label: meta.label ?? null,
    album_apple_id: obj.albumadamid ?? null,
    artists: artistIds.length ? artistIds : null,
    is_explicit: !!obj.hub?.explicit,
    type: obj.type?.toLowerCase() ?? null,
    images: Object.keys(images).length ? { cover_art: images.coverart ?? null, cover_art_hq: images.coverarthq ?? null, background: images.background ?? null } : null,
    colors: parseColors(images.joecolor), hub,
    related_list_id: related.match(/\/tracks\/([^?/]+)/)?.[1] ?? null,
    highlight_links: Object.keys(obj.highlightsurls || {}).length ? obj.highlightsurls : null,
  };
}
export function parseListTrack(obj, rank) {
  const d = parseDiscoveryTrack(obj);
  const out = {
    shazam_key: d.shazam_key, title: d.title, artist_name: d.artist_name, link: d.link,
    artists: d.artists, is_explicit: d.is_explicit,
    cover_art: d.images?.cover_art ?? d.images?.cover_art_hq ?? null,
    colors: d.colors, hub: d.hub,
  };
  return rank == null ? out : { rank, ...out };
}
export function parseRecognition(body) {
  const track = parseDiscoveryTrack(body?.track);
  const matches = (body?.matches || []).filter(m => m && typeof m === 'object').map(m => ({
    shazam_key: m.id ?? null, offset_seconds: m.offset ?? null,
    time_skew: m.timeskew ?? null, frequency_skew: m.frequencyskew ?? null,
  }));
  return { is_matched: !!track, matches: matches.length ? matches : null, track, tag_id: body?.tagid ?? null };
}
export function parseAppleItem(obj) {
  if (!obj) return null;
  const a = obj.attributes || {}, art = a.artwork;
  const artwork = art?.url ? {
    link: art.url.replaceAll('{w}', String(art.width || 3000)).replaceAll('{h}', String(art.height || 3000)).replaceAll('{c}', 'bb').replaceAll('{f}', 'jpg'),
    template_link: art.url, width: art.width ?? null, height: art.height ?? null,
    background_color: art.bgColor ? `#${art.bgColor}` : null,
  } : null;
  const base = { id: obj.id ?? null, type: obj.type ?? null, name: a.name ?? null, link: a.url ?? null, artwork, genres: a.genreNames ?? null };
  switch (obj.type) {
    case 'songs': return { ...base, artist_name: a.artistName ?? null, album_name: a.albumName ?? null, isrc: a.isrc ?? null,
      release_date: a.releaseDate ?? null, duration_ms: a.durationInMillis ?? null, track_number: a.trackNumber ?? null,
      disc_number: a.discNumber ?? null, composer_name: a.composerName ?? null, is_explicit: a.contentRating === 'explicit',
      has_lyrics: a.hasLyrics ?? null, preview_link: a.previews?.[0]?.url ?? null };
    case 'artists': return { ...base, bio: a.editorialNotes?.standard ?? a.editorialNotes?.short ?? null, origin: a.origin ?? null,
      born_or_formed: a.bornOrFormed ?? null, is_group: a.isGroup ?? null };
    case 'albums': return { ...base, artist_name: a.artistName ?? null, release_date: a.releaseDate ?? null,
      track_count: a.trackCount ?? null, upc: a.upc ?? null, release_type: a.recordLabel ?? null,
      is_single: a.isSingle ?? null, is_compilation: a.isCompilation ?? null, copyright: a.copyright ?? null,
      record_label: a.recordLabel ?? null };
    default: return base;
  }
}
export function parseAppleItems(raw) { return (raw || []).map(parseAppleItem).filter(Boolean); }
export function asPagination({ page = 1, limit = 20, hasMore = false, totalCount = null } = {}) {
  return { page, items_per_page: limit, total_count: totalCount, total_pages: totalCount == null ? (hasMore ? page + 1 : page) : Math.ceil(totalCount / limit), has_more: hasMore };
}
