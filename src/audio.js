import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { config } from './config.js';
import { InputError, AppError } from './errors.js';

async function runBinary(bin, args, { timeoutMs = 45000, stdoutLimit = 2 * 1024 * 1024, signal } = {}) {
  return new Promise((resolve, reject) => {
    let done = false, size = 0, stderr = '', timedOut = false;
    const chunks = [];
    const child = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, signal });
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, timeoutMs);
    function finish(err, value) {
      if (done) return;
      done = true;
      clearTimeout(timer);
      err ? reject(err) : resolve(value);
    }
    child.on('error', e => finish(new AppError(e.code === 'ENOENT' ? `Required program '${bin}' is not installed or not on PATH` : `Failed to spawn ${bin}`, 500, 'DEPENDENCY_ERROR')));
    child.stdout.on('data', chunk => {
      size += chunk.length;
      if (size > stdoutLimit) { child.kill('SIGKILL'); return; }
      chunks.push(chunk);
    });
    child.stderr.on('data', chunk => { if (stderr.length < 2048) stderr += chunk.toString().slice(0, 2048 - stderr.length); });
    child.on('close', code => {
      if (timedOut) return finish(new InputError('Audio decoding timed out'));
      if (size > stdoutLimit) return finish(new InputError('Decoded audio exceeds processing limit'));
      if (code !== 0) return finish(new InputError('Could not decode audio: ' + (stderr.trim().split('\n').at(-1) || 'invalid or unsupported audio').slice(0, 200)));
      finish(null, Buffer.concat(chunks));
    });
  });
}

export async function withAudioFile(input, fn) {
  if (typeof input === 'string') {
    return await fn(input);
  }
  if (!Buffer.isBuffer(input) || input.length === 0) throw new InputError('Empty audio file');
  if (input.length > config.maxAudioBytes) throw new InputError(`Audio exceeds ${config.maxAudioBytes / (1024 * 1024)} MB`);
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'shazam-node-'));
  const tempFile = path.join(dir, 'audio.bin');
  try {
    await fs.writeFile(tempFile, input, { mode: 0o600, flag: 'wx' });
    return await fn(tempFile);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}
export async function probeDuration(file) {
  try {
    const buffer = await runBinary(config.ffprobePath, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', file], { timeoutMs: 15000, stdoutLimit: 2000 });
    const duration = Number(buffer.toString('utf8').trim());
    return Number.isFinite(duration) && duration > 0 ? duration : null;
  } catch { return null; }
}
export async function decodePcm(file, { offsetSeconds = 0, durationSeconds = 12 } = {}) {
  if (!Number.isFinite(offsetSeconds) || offsetSeconds < 0 || !Number.isFinite(durationSeconds) || durationSeconds < 3 || durationSeconds > 30) throw new InputError('Invalid audio offset/duration');
  const seekArgs = offsetSeconds > 0 ? ['-ss', offsetSeconds.toFixed(3)] : [];
  const bytes = await runBinary(config.ffmpegPath, [
    '-v', 'error', '-nostdin',
    ...seekArgs,
    '-i', file,
    '-t', durationSeconds.toFixed(3),
    '-vn', '-ac', '1', '-ar', '16000', '-f', 's16le', '-acodec', 'pcm_s16le', 'pipe:1',
  ], { timeoutMs: 45000, stdoutLimit: 30 * 16000 * 2 + 4096 });
  if (bytes.length < 16000 * 3 * 2) throw new InputError('No usable audio in selected window (minimum 3 seconds)');
  // Read int16 explicitly little-endian (portable across host endianness).
  const samples = new Int16Array(Math.floor(bytes.length / 2));
  for (let i = 0; i < samples.length; i++) samples[i] = bytes.readInt16LE(i * 2);
  return samples;
}
