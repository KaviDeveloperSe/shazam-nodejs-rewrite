import { randomUUID } from 'node:crypto';
import { config } from './config.js';
import { InputError, NotFoundError, UpstreamError } from './errors.js';

const SITE = 'https://www.shazam.com';
export const TAG_URL = 'https://amp.shazam.com';
const TAG_HEADERS = {
  'X-Shazam-Platform': 'IPHONE',
  'X-Shazam-AppVersion': '14.1.0',
  'Accept': '*/*',
  'Accept-Language': 'en',
  'User-Agent': 'Shazam/3685 CFNetwork/1197 Darwin/20.0.0',
  'Content-Type': 'application/json',
};
const DEFAULT_HEADERS = { accept: 'application/json,*/*', origin: SITE, referer: SITE + '/', 'user-agent': 'Mozilla/5.0 ShazamNode/1.0' };

function delay(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
export async function getJson(url, { method = 'GET', body, headers = {}, timeoutMs = config.requestTimeoutMs, retries = config.maxRetries } = {}) {
  const u = new URL(url);
  if (u.protocol !== 'https:' || !['amp.shazam.com', 'cdn.shazam.com', 'www.shazam.com', 'api.music.apple.com'].includes(u.hostname)) {
    throw new InputError('Unsupported upstream host');
  }
  for (let attempt = 0; ; attempt++) {
    let response;
    try {
      response = await fetch(u, {
        method,
        headers: { ...DEFAULT_HEADERS, ...headers },
        body: body == null ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
        redirect: 'error',
      });
    } catch (e) {
      if (attempt < retries) { await delay(300 * (attempt + 1)); continue; }
      throw new UpstreamError(`Upstream request failed: ${e.name === 'TimeoutError' ? 'timeout' : e.message}`);
    }
    if (response.status === 400) throw new InputError('Shazam upstream rejected the request (HTTP 400)');
    if ([204, 404].includes(response.status)) throw new NotFoundError('No matching Shazam resource');
    if ([401, 403, 429, 500, 502, 503, 504].includes(response.status)) {
      if (attempt < retries && response.status !== 401) { await response.body?.cancel(); await delay(300 * (attempt + 1)); continue; }
      throw new UpstreamError(`Shazam upstream HTTP ${response.status}`);
    }
    if (!response.ok) throw new UpstreamError(`Unexpected upstream HTTP ${response.status}`);
    try { return await response.json(); } catch { throw new UpstreamError('Upstream returned invalid JSON'); }
  }
}
export async function recognizeSignature(uri, sampleMs, { country = 'US', language = 'en-US' } = {}) {
  const lang = language.split('-')[0].toLowerCase();
  const region = country.toUpperCase();
  const a = randomUUID().toUpperCase(); const b = randomUUID().toUpperCase();
  const url = new URL(`${TAG_URL}/discovery/v5/${encodeURIComponent(lang)}/${encodeURIComponent(region)}/iphone/-/tag/${a}/${b}`);
  for (const [key, value] of Object.entries({ sync: 'true', webv3: 'true', sampling: 'true', connected: '', shazamapiversion: 'v3', sharehub: 'true', video: 'v0' })) url.searchParams.set(key, value);
  return getJson(url, {
    method: 'POST', headers: TAG_HEADERS,
    body: {
      timezone: config.recognizeTimezone,
      signature: { uri, samplems: sampleMs },
      timestamp: Date.now(), context: {}, geolocation: {},
    },
  });
}
export function discoverTrack(key, { country = 'US', language = 'en-US' } = {}) {
  const url = new URL(`${TAG_URL}/discovery/v5/${encodeURIComponent(language)}/${encodeURIComponent(country.toUpperCase())}/web/-/track/${encodeURIComponent(key)}`);
  url.searchParams.set('shazamapiversion', 'v3'); url.searchParams.set('video', 'v0');
  return getJson(url);
}
export function cdnList(listId, { country = 'US', language = 'en-US', startFrom = 0, pageSize = 20 } = {}) {
  const url = new URL(`https://cdn.shazam.com/shazam/v3/${encodeURIComponent(language)}/${encodeURIComponent(country.toUpperCase())}/web/-/tracks/${encodeURIComponent(listId)}`);
  for (const [k, v] of Object.entries({ startFrom, pageSize, connected: '', channel: '' })) url.searchParams.set(k, v);
  return getJson(url);
}
