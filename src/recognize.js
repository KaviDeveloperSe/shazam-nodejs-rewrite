import fs from 'node:fs/promises';
import { config } from './config.js';
import { withAudioFile, decodePcm, probeDuration } from './audio.js';
import { fingerprintPcm } from './fingerprint.js';
import { recognizeSignature } from './transport.js';
import { parseRecognition } from './parser.js';
import { InputError } from './errors.js';

export function recognitionWindows(total, offset, duration, count = config.maxWindows) {
  if (offset != null) return [offset];
  const result = [];
  if (total && total > 3 * duration) result.push(Math.max(0, total / 2 - duration / 2));
  let cursor = 0;
  while (result.length < count) {
    if (!result.includes(cursor) && (total == null || cursor < total - 3)) result.push(cursor);
    cursor += duration;
    if (total != null && cursor >= total) break;
  }
  return result.length ? result : [0];
}
function numberParam(value, name, { min, max, optional = false, fallback } = {}) {
  if ((value == null || value === '') && optional) return undefined;
  const n = value == null || value === '' ? fallback : Number(value);
  if (!Number.isFinite(n) || n < min || n > max) throw new InputError(`${name} must be ${min}–${max}`);
  return n;
}

export function parseOptions(obj = {}) {
  const country = String(obj.country || 'US').toUpperCase();
  const language = String(obj.language || 'en-US');
  if (!/^[A-Z]{2}$/.test(country)) throw new InputError('country must be a 2-letter ISO code');
  if (!/^[a-z]{2,3}(?:-[A-Za-z]{2,4})?$/.test(language)) throw new InputError('language must be a locale like en-US');
  const isFast = obj.fast === true || obj.fast === 'true';
  const defaultDuration = isFast ? 7 : 12;
  return {
    country, language,
    fast: isFast,
    parallel: obj.parallel === true || obj.parallel === 'true',
    offsetSeconds: numberParam(obj.offset_seconds ?? obj.offsetSeconds, 'offset_seconds', { min: 0, max: 86400, optional: true }),
    durationSeconds: numberParam(obj.duration_seconds ?? obj.durationSeconds, 'duration_seconds', { min: 3, max: 30, fallback: defaultDuration }),
  };
}
export async function recognizeAudio(buffer, options = {}) {
  const opts = parseOptions(options);
  let audioBytes = Buffer.isBuffer(buffer) ? buffer.length : 0;
  if (typeof buffer === 'string' && !audioBytes) {
    try { const s = await fs.stat(buffer); audioBytes = s.size; } catch {}
  }
  return withAudioFile(buffer, async input => {
    const duration = await probeDuration(input);
    const windows = recognitionWindows(duration, opts.offsetSeconds, opts.durationSeconds);
    const attempts = [];
    let found = { is_matched: false, matches: null, track: null };

    if (opts.parallel && windows.length > 1) {
      // Parallel fast probe
      const promises = windows.map(async offset => {
        try {
          const pcm = await decodePcm(input, { offsetSeconds: offset, durationSeconds: opts.durationSeconds });
          const fingerprint = fingerprintPcm(pcm, { maxSeconds: opts.durationSeconds });
          const body = await recognizeSignature(fingerprint.uri, fingerprint.sampleMs, opts);
          const parsed = parseRecognition(body);
          const attempt = { offset_seconds: Math.round(offset * 1000) / 1000, duration_seconds: fingerprint.sampleMs / 1000, is_matched: parsed.is_matched };
          return { parsed, attempt };
        } catch {
          return null;
        }
      });
      const results = await Promise.all(promises);
      for (const res of results) {
        if (!res) continue;
        attempts.push(res.attempt);
        if (res.parsed.is_matched && !found.is_matched) {
          found = res.parsed;
        }
      }
    } else {
      // Sequential probe with early exit on match
      for (const offset of windows) {
        let fingerprint;
        try {
          const pcm = await decodePcm(input, { offsetSeconds: offset, durationSeconds: opts.durationSeconds });
          fingerprint = fingerprintPcm(pcm, { maxSeconds: opts.durationSeconds });
        } catch (e) {
          if (attempts.length && e instanceof InputError) break;
          throw e;
        }
        const body = await recognizeSignature(fingerprint.uri, fingerprint.sampleMs, opts);
        const parsed = parseRecognition(body);
        attempts.push({ offset_seconds: Math.round(offset * 1000) / 1000, duration_seconds: fingerprint.sampleMs / 1000, is_matched: parsed.is_matched });
        if (options.onAttempt) options.onAttempt(attempts.at(-1), parsed);
        if (parsed.is_matched) { found = parsed; break; }
      }
    }

    return {
      is_matched: found.is_matched,
      source: options.source || (typeof buffer === 'string' ? buffer : null),
      audio: { bytes: audioBytes, duration_seconds: duration == null ? null : Math.round(duration * 1000) / 1000 },
      attempts,
      matches: found.matches,
      track: found.track,
    };
  });
}
