#!/usr/bin/env node
import fs from 'node:fs/promises';
import { existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import { recognizeAudio } from './recognize.js';
import { probeDuration, decodePcm } from './audio.js';
import { fingerprintPcm } from './fingerprint.js';
import { recognizeSignature } from './transport.js';
import * as music from './music.js';
import * as catalog from './catalog.js';
import { createServer } from './server.js';
import { InputError, AppError } from './errors.js';

// ANSI terminal colors helper
const useColor = !process.env.NO_COLOR && (process.stdout.isTTY || process.env.FORCE_COLOR);
const c = {
  reset: useColor ? '\x1b[0m' : '',
  bold: useColor ? '\x1b[1m' : '',
  dim: useColor ? '\x1b[2m' : '',
  italic: useColor ? '\x1b[3m' : '',
  underline: useColor ? '\x1b[4m' : '',
  red: useColor ? '\x1b[31m' : '',
  green: useColor ? '\x1b[32m' : '',
  yellow: useColor ? '\x1b[33m' : '',
  blue: useColor ? '\x1b[34m' : '',
  magenta: useColor ? '\x1b[35m' : '',
  cyan: useColor ? '\x1b[36m' : '',
  white: useColor ? '\x1b[37m' : '',
  bgBlue: useColor ? '\x1b[44m' : '',
  bgMagenta: useColor ? '\x1b[45m' : '',
};

function banner() {
  return `
${c.cyan}${c.bold}  ███████╗██╗  ██╗ █████╗ ███████╗ █████╗ ███╗   ███╗${c.reset}
${c.blue}${c.bold}  ██╔════╝██║  ██║██╔══██╗╚══███╔╝██╔══██╗████╗ ████║${c.reset}
${c.magenta}${c.bold}  ███████╗███████║███████║  ███╔╝ ███████║██╔████╔██║${c.reset}
${c.blue}${c.bold}  ╚════██║██╔══██║██╔══██║ ███╔╝  ██╔══██║██║╚██╔╝██║${c.reset}
${c.cyan}${c.bold}  ███████║██║  ██║██║  ██║███████╗██║  ██║██║ ╚═╝ ██║${c.reset}
${c.dim}  ⚡ Advanced & Ultra-Fast Node.js Audio Recognition CLI${c.reset}
`;
}

function printHelp() {
  console.log(banner());
  console.log(`${c.bold}USAGE:${c.reset}
  shazam <command> [options]
  node src/cli.js <command> [options]

${c.bold}COMMANDS:${c.reset}
  ${c.green}recognize${c.reset} <file|dir>     ${c.dim}Identify audio/video song (aliases: rec, find, id)${c.reset}
  ${c.green}search${c.reset} <query>           ${c.dim}Search Shazam & Apple Music catalog (alias: s)${c.reset}
  ${c.green}details${c.reset} <trackId>        ${c.dim}Get comprehensive track metadata (alias: info)${c.reset}
  ${c.green}lyrics${c.reset} <trackId>         ${c.dim}Fetch song lyrics for a track${c.reset}
  ${c.green}benchmark${c.reset} <file>         ${c.dim}Measure latency of decode, fingerprint, & API${c.reset}
  ${c.green}serve${c.reset}                    ${c.dim}Start REST API server (aliases: server, start)${c.reset}

${c.bold}RECOGNIZE OPTIONS:${c.reset}
  ${c.cyan}--fast, -f${c.reset}               Enable ultra-fast mode (7s window, instant seek)
  ${c.cyan}--parallel, -p${c.reset}           Probe multiple candidate windows simultaneously
  ${c.cyan}--offset <sec>${c.reset}           Starting time offset in seconds
  ${c.cyan}--duration <sec>${c.reset}         Sample window length in seconds (3-30s, default: 12)
  ${c.cyan}--country <ISO>${c.reset}          2-letter ISO country code (default: US)
  ${c.cyan}--language <locale>${c.reset}      Language locale (default: en-US)
  ${c.cyan}--batch${c.reset}                  Recursively scan and identify all audio in folder
  ${c.cyan}--json${c.reset}                   Output structured JSON only (for scripts)
  ${c.cyan}--output, -o <file>${c.reset}      Save JSON results to a file
  ${c.cyan}--silent, -s${c.reset}             Suppress progress spinners and banner

${c.bold}EXAMPLES:${c.reset}
  ${c.yellow}# Fast song recognition${c.reset}
  shazam recognize "./sample.mp3" --fast

  ${c.yellow}# Shortcut directly with file path${c.reset}
  shazam "./song.mp3.mp4"

  ${c.yellow}# Search for songs${c.reset}
  shazam search "Blinding Lights The Weeknd"

  ${c.yellow}# Speed diagnostic${c.reset}
  shazam benchmark "./sample.wav"

  ${c.yellow}# Run API server for Render or local hosting${c.reset}
  shazam serve --port 8000
`);
}

function parseCliArgs(argv) {
  const flags = {};
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      flags.help = true;
    } else if (arg === '--version' || arg === '-v') {
      flags.version = true;
    } else if (arg === '--fast' || arg === '-f') {
      flags.fast = true;
    } else if (arg === '--parallel' || arg === '-p') {
      flags.parallel = true;
    } else if (arg === '--json') {
      flags.json = true;
    } else if (arg === '--silent' || arg === '-s') {
      flags.silent = true;
    } else if (arg === '--batch') {
      flags.batch = true;
    } else if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const next = argv[i + 1];
      if (next != null && !next.startsWith('--')) {
        flags[key] = next;
        i++;
      } else {
        flags[key] = true;
      }
    } else if (arg.startsWith('-') && arg.length === 2) {
      const key = arg === '-o' ? 'output' : arg === '-s' ? 'silent' : arg.slice(1);
      const next = argv[i + 1];
      if (next != null && !next.startsWith('-')) {
        flags[key] = next;
        i++;
      } else {
        flags[key] = true;
      }
    } else {
      positional.push(arg);
    }
  }
  return { positional, flags };
}

function formatDuration(sec) {
  if (!sec && sec !== 0) return 'unknown';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function printCard(result) {
  const track = result.track;
  const audio = result.audio || {};
  const durationStr = audio.duration_seconds ? formatDuration(audio.duration_seconds) : 'N/A';
  const sizeMb = audio.bytes ? (audio.bytes / (1024 * 1024)).toFixed(2) + ' MB' : 'N/A';
  const bestAttempt = result.attempts?.find(a => a.is_matched) || result.attempts?.[0];
  const offsetStr = bestAttempt ? `${bestAttempt.offset_seconds}s (sampled ${bestAttempt.duration_seconds}s)` : '0s';

  const w = 68;
  const line = '─'.repeat(w);
  console.log(`\n${c.cyan}┌${line}┐${c.reset}`);
  console.log(`${c.cyan}│${c.reset}  ${c.green}${c.bold}🎵  SONG RECOGNIZED${c.reset}${' '.repeat(w - 20)}${c.cyan}│${c.reset}`);
  console.log(`${c.cyan}├${line}┤${c.reset}`);

  const row = (label, val, color = '') => {
    if (!val) return;
    const cleanLabel = `${label}:`.padEnd(14);
    const maxValLen = w - 18;
    const cleanVal = String(val).length > maxValLen ? String(val).slice(0, maxValLen - 3) + '...' : String(val);
    const pad = ' '.repeat(Math.max(0, w - cleanLabel.length - cleanVal.length - 4));
    console.log(`${c.cyan}│${c.reset}  ${c.bold}${cleanLabel}${c.reset}${color}${cleanVal}${c.reset}${pad}${c.cyan}│${c.reset}`);
  };

  row('Title', track.title, c.bold + c.white);
  row('Artist', track.artist_name, c.yellow);
  if (track.album_name) row('Album', track.album_name);
  if (track.genre) row('Genre', track.genre);
  if (track.release_date) row('Year', track.release_date);
  if (track.label) row('Label', track.label);
  row('Audio File', result.source || 'Stream');
  row('File Length', `${durationStr} (${sizeMb})`);
  row('Identified At', offsetStr);
  row('Shazam Key', track.shazam_key, c.magenta);
  if (track.apple_id) row('Apple ID', track.apple_id);

  console.log(`${c.cyan}├${line}┤${c.reset}`);
  if (track.link) row('🔗 Shazam', track.link, c.underline + c.blue);
  if (track.hub?.listen_link) row('🍎 Apple Music', track.hub.listen_link, c.underline + c.blue);
  if (track.hub?.preview_link) row('▶️  Audio Clip', track.hub.preview_link, c.underline + c.cyan);
  if (track.images?.cover_art_hq || track.images?.cover_art) {
    row('🖼️  Cover Art', track.images.cover_art_hq || track.images.cover_art, c.underline + c.dim);
  }
  console.log(`${c.cyan}└${line}┘${c.reset}\n`);
}

async function handleRecognize(target, flags) {
  const isDirectory = existsSync(target) && statSync(target).isDirectory();
  const audioExtensions = new Set(['.mp3', '.m4a', '.wav', '.flac', '.aac', '.ogg', '.opus', '.wma', '.mp4', '.mkv', '.webm']);

  if (isDirectory || flags.batch) {
    const dir = target;
    const entries = await fs.readdir(dir, { withFileTypes: true });
    const files = entries
      .filter(e => e.isFile() && audioExtensions.has(path.extname(e.name).toLowerCase()))
      .map(e => path.join(dir, e.name));

    if (!files.length) {
      console.log(`${c.yellow}No supported audio files found in ${dir}${c.reset}`);
      return;
    }

    console.log(`${c.bold}Scanning ${files.length} audio file(s) in:${c.reset} ${dir}\n`);
    const results = [];
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const base = path.basename(file);
      process.stdout.write(`[${i + 1}/${files.length}] ${base.padEnd(35).slice(0, 35)} ... `);
      const start = Date.now();
      try {
        const res = await recognizeAudio(file, {
          source: base,
          fast: flags.fast ?? true,
          parallel: flags.parallel ?? false,
          offset_seconds: flags.offset,
          duration_seconds: flags.duration,
          country: flags.country,
          language: flags.language,
        });
        const elapsed = ((Date.now() - start) / 1000).toFixed(1);
        if (res.is_matched) {
          console.log(`${c.green}✔ MATCH${c.reset} ${c.bold}${res.track.title}${c.reset} - ${res.track.artist_name} (${elapsed}s)`);
        } else {
          console.log(`${c.yellow}✖ No match${c.reset} (${elapsed}s)`);
        }
        results.push(res);
      } catch (err) {
        console.log(`${c.red}✖ Error: ${err.message}${c.reset}`);
        results.push({ file: base, error: err.message, is_matched: false });
      }
    }

    if (flags.json) {
      console.log(JSON.stringify(results, null, 2));
    }
    if (flags.output) {
      await fs.writeFile(flags.output, JSON.stringify(results, null, 2));
      console.log(`\n${c.green}Results saved to ${flags.output}${c.reset}`);
    }
    return;
  }

  // Single file recognition
  if (!existsSync(target)) {
    throw new InputError(`File not found: ${target}`);
  }
  const stat = await fs.stat(target);
  if (stat.size > config.maxAudioBytes) {
    throw new InputError(`File exceeds maximum size (${config.maxAudioBytes / (1024 * 1024)} MB)`);
  }

  if (!flags.silent && !flags.json) {
    process.stdout.write(`${c.cyan}⚡ Analyzing audio & querying Shazam...${c.reset}\r`);
  }

  const startTime = Date.now();
  const result = await recognizeAudio(target, {
    source: path.basename(target),
    fast: flags.fast,
    parallel: flags.parallel,
    offset_seconds: flags.offset,
    duration_seconds: flags.duration,
    country: flags.country,
    language: flags.language,
  });
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);

  if (flags.json) {
    console.log(JSON.stringify(result, null, 2));
  } else if (result.is_matched) {
    if (!flags.silent) process.stdout.write(' '.repeat(45) + '\r');
    printCard(result);
    console.log(`${c.dim}⚡ Recognized in ${elapsed}s (attempts: ${result.attempts?.length || 1})${c.reset}\n`);
  } else {
    if (!flags.silent) process.stdout.write(' '.repeat(45) + '\r');
    console.log(`\n${c.yellow}✖ No match found for "${path.basename(target)}"${c.reset}`);
    console.log(`${c.dim}Audio was processed in ${elapsed}s across ${result.attempts?.length || 0} window attempt(s).${c.reset}\n`);
  }

  if (flags.output) {
    await fs.writeFile(flags.output, JSON.stringify(result, null, 2));
    if (!flags.silent && !flags.json) {
      console.log(`${c.green}✔ Result saved to ${flags.output}${c.reset}`);
    }
  }
}

async function handleSearch(query, flags) {
  if (!query) throw new InputError('Missing search query. Usage: shazam search "<artist/title>"');
  const limit = Number(flags.limit) || 5;
  const type = flags.type || 'songs';
  if (!flags.silent && !flags.json) {
    process.stdout.write(`${c.cyan}🔍 Searching Shazam catalog for "${query}"...${c.reset}\r`);
  }
  const results = await music.search(query, { limit, type, country: flags.country, language: flags.language });
  if (!flags.silent && !flags.json) process.stdout.write(' '.repeat(50) + '\r');

  if (flags.json) {
    console.log(JSON.stringify(results, null, 2));
    return;
  }

  const songs = results.songs || [];
  if (!songs.length) {
    console.log(`${c.yellow}No results found for "${query}"${c.reset}`);
    return;
  }

  console.log(`\n${c.bold}Found ${songs.length} song(s) for "${query}":${c.reset}\n`);
  songs.forEach((s, idx) => {
    const key = s.shazam_key ? `${c.magenta}[#${s.shazam_key}]${c.reset} ` : '';
    console.log(` ${c.cyan}${idx + 1}.${c.reset} ${key}${c.bold}${s.name || s.title}${c.reset} - ${c.yellow}${s.artist_name}${c.reset}`);
    if (s.album_name) console.log(`    ${c.dim}Album:${c.reset} ${s.album_name}`);
    if (s.shazam_link) console.log(`    ${c.dim}Link:${c.reset}  ${s.shazam_link}`);
  });
  console.log();
}

async function handleDetails(trackId, flags) {
  if (!trackId) throw new InputError('Missing track ID. Usage: shazam details <track-id>');
  if (!flags.silent && !flags.json) {
    process.stdout.write(`${c.cyan}Fetching track details for ${trackId}...${c.reset}\r`);
  }
  const details = await music.trackDetails(trackId, { country: flags.country, language: flags.language });
  if (!flags.silent && !flags.json) process.stdout.write(' '.repeat(50) + '\r');

  if (flags.json) {
    console.log(JSON.stringify(details, null, 2));
    return;
  }

  console.log(`\n${c.cyan}┌────────────────────────────────────────────────────────┐${c.reset}`);
  console.log(`${c.cyan}│${c.reset}  ${c.bold}${details.title || 'Track'}${c.reset} - ${details.artist_name || 'Unknown'}`);
  console.log(`${c.cyan}├────────────────────────────────────────────────────────┤${c.reset}`);
  console.log(`  ${c.bold}Album:${c.reset}        ${details.album_name || 'N/A'}`);
  console.log(`  ${c.bold}Genre:${c.reset}        ${details.genre || 'N/A'}`);
  console.log(`  ${c.bold}Year:${c.reset}         ${details.release_date || 'N/A'}`);
  console.log(`  ${c.bold}Label:${c.reset}        ${details.label || 'N/A'}`);
  console.log(`  ${c.bold}ISRC:${c.reset}         ${details.isrc || 'N/A'}`);
  console.log(`  ${c.bold}Shazam Key:${c.reset}   ${details.shazam_key}`);
  console.log(`  ${c.bold}Apple ID:${c.reset}     ${details.apple_id || 'N/A'}`);
  if (details.link) console.log(`  ${c.bold}Shazam Link:${c.reset}  ${details.link}`);
  if (details.hub?.listen_link) console.log(`  ${c.bold}Apple Music:${c.reset}  ${details.hub.listen_link}`);
  console.log(`${c.cyan}└────────────────────────────────────────────────────────┘${c.reset}\n`);
}

async function handleLyrics(trackId, flags) {
  if (!trackId) throw new InputError('Missing track ID. Usage: shazam lyrics <track-id>');
  const lyricsData = await catalog.songPageFeature('lyrics', trackId);
  if (flags.json) {
    console.log(JSON.stringify(lyricsData, null, 2));
    return;
  }
  if (!lyricsData || !lyricsData.lyrics) {
    console.log(`${c.yellow}No lyrics available for track ${trackId}${c.reset}`);
    return;
  }
  console.log(`\n${c.bold}${c.green}📜 Lyrics:${c.reset}\n`);
  if (Array.isArray(lyricsData.lyrics)) {
    lyricsData.lyrics.forEach(line => console.log(line));
  } else {
    console.log(lyricsData.lyrics);
  }
  console.log();
}

async function handleBenchmark(target, flags) {
  if (!target || !existsSync(target)) throw new InputError('Audio file required for benchmark: shazam benchmark <file>');
  console.log(`\n${c.bold}⚡ BENCHMARKING RECOGNITION PIPELINE:${c.reset} ${path.basename(target)}\n`);

  // Step 1: Probe duration
  const t0 = performance.now();
  const duration = await probeDuration(target);
  const tProbe = (performance.now() - t0).toFixed(2);
  console.log(`  1. ${c.cyan}FFprobe duration:${c.reset}     ${tProbe} ms  (length: ${duration ? duration.toFixed(1) + 's' : 'N/A'})`);

  // Step 2: Decode PCM
  const durationSec = flags.fast ? 7 : 12;
  const t1 = performance.now();
  const pcm = await decodePcm(target, { offsetSeconds: 0, durationSeconds: durationSec });
  const tDecode = (performance.now() - t1).toFixed(2);
  console.log(`  2. ${c.cyan}FFmpeg PCM decode:${c.reset}    ${tDecode} ms  (${pcm.length} samples at 16kHz)`);

  // Step 3: Pure JS SigX Fingerprint
  const t2 = performance.now();
  const fp = fingerprintPcm(pcm, { maxSeconds: durationSec });
  const tFp = (performance.now() - t2).toFixed(2);
  console.log(`  3. ${c.cyan}SigX Fingerprint:${c.reset}     ${tFp} ms  (${fp.peakCount} spectral peaks, sampleMs: ${fp.sampleMs})`);

  // Step 4: Shazam Upstream Network Tag API
  const t3 = performance.now();
  const upstream = await recognizeSignature(fp.uri, fp.sampleMs, { country: flags.country, language: flags.language });
  const tApi = (performance.now() - t3).toFixed(2);
  const isMatch = Boolean(upstream?.matches?.length);
  console.log(`  4. ${c.cyan}Shazam Upstream API:${c.reset}  ${tApi} ms  (match: ${isMatch ? c.green + 'YES' : c.yellow + 'NO'}${c.reset})`);

  const tTotal = (performance.now() - t0).toFixed(2);
  console.log(`\n  ${c.bold}⚡ Total Processing Time:${c.reset} ${c.green}${c.bold}${tTotal} ms${c.reset}`);
  if (isMatch && upstream?.track) {
    console.log(`  ${c.bold}Matched Track:${c.reset} ${upstream.track.title} by ${upstream.track.subtitle}\n`);
  } else {
    console.log();
  }
}

async function handleServe(flags) {
  const port = flags.port ? Number(flags.port) : config.port;
  const host = flags.host || config.host;
  const server = createServer();
  server.listen(port, host, () => {
    console.log(banner());
    console.log(`${c.green}${c.bold}✔ Shazam API server running at:${c.reset} http://${host}:${port}`);
    console.log(`${c.dim}Health check available at: http://${host}:${port}/health${c.reset}`);
    console.log(`${c.dim}Press Ctrl+C to stop.${c.reset}\n`);
  });
}

// Main CLI Dispatcher
async function main() {
  const { positional, flags } = parseCliArgs(process.argv.slice(2));

  if (flags.help || (!positional.length && !Object.keys(flags).length)) {
    printHelp();
    process.exit(0);
  }

  if (flags.version) {
    console.log('shazam-node v1.0.0 (Node.js SigX engine)');
    process.exit(0);
  }

  let command = positional[0]?.toLowerCase();
  let targetArg = positional[1];

  // Auto-detect audio file as first argument: e.g. "shazam sample.mp3"
  const audioExtensions = new Set(['.mp3', '.m4a', '.wav', '.flac', '.aac', '.ogg', '.opus', '.wma', '.mp4', '.mkv', '.webm']);
  if (command && (existsSync(command) || audioExtensions.has(path.extname(command).toLowerCase()))) {
    targetArg = command;
    command = 'recognize';
  }

  try {
    switch (command) {
      case 'recognize':
      case 'rec':
      case 'find':
      case 'id':
        if (!targetArg) throw new InputError('Audio file or directory required: shazam recognize <path>');
        await handleRecognize(targetArg, flags);
        break;

      case 'search':
      case 's':
      case 'lookup': {
        const query = positional.slice(1).join(' ');
        await handleSearch(query, flags);
        break;
      }

      case 'details':
      case 'info':
        await handleDetails(targetArg, flags);
        break;

      case 'lyrics':
        await handleLyrics(targetArg, flags);
        break;

      case 'benchmark':
      case 'bench':
      case 'speed':
        await handleBenchmark(targetArg, flags);
        break;

      case 'serve':
      case 'server':
      case 'start':
        await handleServe(flags);
        break;

      default:
        throw new InputError(`Unknown command: "${command}". Run "shazam --help" for available commands.`);
    }
  } catch (err) {
    if (flags.json) {
      console.error(JSON.stringify({ error: err.message, code: err.code || 'ERROR' }));
    } else {
      console.error(`\n${c.red}${c.bold}ERROR:${c.reset} ${err.message}\n`);
    }
    process.exitCode = 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
