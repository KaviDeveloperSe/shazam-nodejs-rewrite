/** Optional server-side audio URL fetcher with fixed DNS resolution, no redirects,
 * no private/link-local hosts, no IPv6, and a strict byte limit.
 */
import dns from 'node:dns/promises';
import http from 'node:http';
import https from 'node:https';
import { isIP } from 'node:net';
import { config } from './config.js';
import { InputError, UpstreamError } from './errors.js';
function publicIPv4(s) {
  if (isIP(s) !== 4) return false;
  const [a, b, c] = s.split('.').map(Number);
  if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
  if (a === 100 && b >= 64 && b <= 127) return false;
  if (a === 169 && b === 254) return false;
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && (b === 168 || b === 0 || b === 88)) return false;
  if (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) return false;
  if (a === 203 && b === 0 && c === 113) return false;
  if (a === 192 && b === 0 && c === 2) return false;
  return true;
}
export async function downloadAudio(rawUrl) {
  if (!config.enableRemoteUrls) throw new InputError('Remote URL recognition disabled. Set ENABLE_REMOTE_URLS=true after assessing SSRF risks.');
  let u;
  try { u = new URL(rawUrl); } catch { throw new InputError('Invalid audio URL'); }
  if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password || !u.hostname) throw new InputError('Audio URL must be public HTTP(S) without credentials');
  if (isIP(u.hostname) === 6) throw new InputError('IPv6 URL hosts are disallowed');
  const addresses = isIP(u.hostname) === 4 ? [{ address: u.hostname }] : await dns.lookup(u.hostname, { all: true, family: 4 });
  if (!addresses.length || addresses.some(({ address }) => !publicIPv4(address))) throw new InputError('Audio URL resolves to a private/reserved address');
  const fixedIP = addresses[0].address;
  return new Promise((resolve, reject) => {
    let done = false;
    const finish = (error, data) => { if (done) return; done = true; error ? reject(error) : resolve(data); };
    const driver = u.protocol === 'https:' ? https : http;
    const req = driver.request(u, {
      method: 'GET',
      headers: { accept: '*/*', 'user-agent': 'ShazamNode/1.0' },
      lookup: (_hostname, _opts, cb) => cb(null, fixedIP, 4),
      timeout: config.requestTimeoutMs,
    }, res => {
      if (res.statusCode !== 200) { res.resume(); finish(new UpstreamError(`Audio host returned HTTP ${res.statusCode}`)); return; }
      if (Number(res.headers['content-length']) > config.maxAudioBytes) { res.resume(); finish(new InputError('Remote audio exceeds allowed size')); return; }
      const buffers = []; let count = 0;
      res.on('data', chunk => {
        count += chunk.length;
        if (count > config.maxAudioBytes) {
          finish(new InputError('Remote audio exceeds allowed size'));
          req.destroy(); return;
        }
        buffers.push(chunk);
      });
      res.on('end', () => finish(null, Buffer.concat(buffers)));
      res.on('error', e => finish(new UpstreamError('Failed to download audio: ' + e.message)));
    });
    req.on('timeout', () => { finish(new UpstreamError('Remote audio request timed out')); req.destroy(); });
    req.on('error', e => finish(new UpstreamError('Failed to download audio: ' + e.message)));
    req.end();
  });
}
