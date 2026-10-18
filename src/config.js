import fs from 'node:fs';
import path from 'node:path';

function intEnv(name, fallback, lower, upper) {
  const v = Number.parseInt(process.env[name] ?? '', 10);
  return Number.isFinite(v) ? Math.max(lower, Math.min(upper, v)) : fallback;
}

function resolveBinary(envVar, name) {
  if (process.env[envVar]) return process.env[envVar];
  const local = path.resolve(process.cwd(), 'bin', process.platform === 'win32' ? `${name}.exe` : name);
  if (fs.existsSync(local)) return local;
  return name;
}

export const config = Object.freeze({
  port: intEnv('PORT', 8000, 1, 65535),
  host: process.env.HOST || (process.env.RENDER || process.env.NODE_ENV === 'production' ? '0.0.0.0' : '127.0.0.1'),
  apiKey: process.env.API_KEY || '',
  maxAudioBytes: intEnv('MAX_AUDIO_MB', 30, 1, 100) * 1024 * 1024,
  maxConcurrent: intEnv('MAX_CONCURRENT', 2, 1, 16),
  maxWindows: intEnv('MAX_WINDOWS', 3, 1, 6),
  requestTimeoutMs: intEnv('REQUEST_TIMEOUT_MS', 20000, 2000, 60000),
  recognizeTimezone: process.env.SHAZAM_TIMEZONE || 'America/Chicago',
  ffmpegPath: resolveBinary('FFMPEG_PATH', 'ffmpeg'),
  ffprobePath: resolveBinary('FFPROBE_PATH', 'ffprobe'),
  enableRemoteUrls: process.env.ENABLE_REMOTE_URLS === 'true',
  maxRetries: intEnv('MAX_RETRIES', 2, 0, 4),
  musicKitToken: process.env.SHAZAM_MUSICKIT_TOKEN || '',
  rateLimitPerMinute: intEnv('RATE_LIMIT_PER_MINUTE', 20, 1, 5000),
});
