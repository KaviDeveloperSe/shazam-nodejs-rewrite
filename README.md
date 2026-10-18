# Shazam Node.js — Advanced & Ultra-Fast Song Recognition Engine

A high-performance Node.js ES-module implementation of Shazam audio fingerprinting and recognition. The core audio recognition path uses **the original Shazam SigX fingerprint specification**, implemented purely in JavaScript (pure FFT, spectral peak selection, SigX binary encoding with CRC32).

⚡ **Features:**
- **Ultra-Fast Song Recognition:** Sub-2-second recognition pipeline with instant seeking (`-ss` optimized) and zero in-memory re-copying.
- **Advanced CLI (`shazam`):** Rich terminal UI with song cards, search, metadata inspection, lyrics, speed benchmarks, batch folder scanning, and raw JSON export.
- **Pure Node.js:** Zero external npm runtime dependencies.
- **Render.com Ready:** Pre-configured `render.yaml` Blueprint, production Docker container, and `render-build.sh` for 1-click cloud deployment.

## 🚀 Fast CLI Song Finder

Install globally or run via `node src/cli.js`:

```powershell
# Recognize any audio or video file
node src/cli.js recognize ".\song.mp3.mp4"

# Quick shortcut
node src/cli.js ".\song.mp3"

# Benchmark recognition speed on your machine
node src/cli.js benchmark ".\song.mp3.mp4"

# Search Shazam & Apple Music catalog
node src/cli.js search "Coldplay Yellow"

# Batch scan and identify an entire folder of songs
node src/cli.js recognize "./music-folder/" --batch

# Raw JSON output for scripts and piping
node src/cli.js recognize ".\song.mp3" --json
```

## ☁️ Deploy to Render in 1 Click

See [`RENDER_DEPLOYMENT.md`](./RENDER_DEPLOYMENT.md) for full instructions.

- **Option A (Docker):** Connect your GitHub repo to Render, select **Docker** runtime. Render uses the included `Dockerfile` with Node 22 and FFmpeg pre-installed.
- **Option B (Blueprint):** Select **New +** → **Blueprint** in Render, select this repository, and Render automatically provisions the service via `render.yaml`.
- **Option C (Native Node):** Set build command to `npm run render-build` and start command to `npm start`.

Health check endpoint: `GET /health`

## 📖 Complete API Documentation

For the full reference guide covering all 25+ REST endpoints, query parameters, multipart file uploads, response schemas, and code examples (cURL, Node.js, Python), see:

👉 **[`API_DOCUMENTATION.md`](./API_DOCUMENTATION.md)**

## Windows setup (PowerShell)

Prerequisites: Node.js **20.11+** (22/24 recommended); `ffmpeg` and `ffprobe` on PATH.

```powershell
node --version
ffmpeg -version
ffprobe -version
```

If FFmpeg is missing: `winget install Gyan.FFmpeg`, then restart your terminal.

```powershell
npm test
npm start
```

## Recognition flow

1. Accept a bounded upload (default 30 MiB) or local file.
2. Write input to a safe per-request temporary directory, always remove it afterward.
3. FFprobe audio duration. Choose a middle-of-song window for long clips, then start/next windows (up to 3).
4. FFmpeg decode the window into 16 kHz / mono / signed 16-bit PCM.
5. **Pure JS** FFT 2048 samples every 128 samples → spectral spreading → peak filtering / frequency-band selection → SigX packet / CRC32.
6. Send SigX to Shazam's discovery/tag endpoint. Normalize the returned song metadata. Return a clear `is_matched: false` if it responded without a match.

A sample matched response (illustrative; not from live execution):

```json
{
  "is_matched": true,
  "source": "mic.wav",
  "audio": { "bytes": 500000, "duration_seconds": 10 },
  "attempts": [{ "offset_seconds": 0, "duration_seconds": 10, "is_matched": true }],
  "matches": [{ "shazam_key": "40333609", "offset_seconds": 48.1780625, "time_skew": 0.0002965927, "frequency_skew": 0 }],
  "track": { "shazam_key": "40333609", "title": "River Flows In You", "artist_name": "Yiruma" }
}
```

### API routes

| Method | Path | Query/Body |
|---|---|---|
| POST | `/recognize/file` | multipart field `file` (or `audio`, `upload_file`); optional `offset_seconds`, `duration_seconds`, `country`, `language` in query |
| GET | `/recognize/url` | `url` of public audio; **disabled by default**; opt in with `ENABLE_REMOTE_URLS=true` |
| GET | `/search` | `query`, `type=all|songs|artists|albums|playlists|music-videos`, `page`, `limit` |
| GET | `/search/auto-complete` | `query`, `limit` |
| GET | `/songs/details` | `track` (Shazam ID/link, `apple:<id>`, ISRC) |
| GET | `/songs/lyrics` | `track` |
| GET | `/songs/audio-analysis` | `track` |
| GET | `/songs/popular-segments` | `track` |
| GET | `/songs/similar` | `track`, `page`, `limit` |
| GET | `/songs/music-videos` | `track` |
| GET | `/songs/batch` | `tracks` (up to 25 comma-separated tracks) |
| GET | `/artists/details` | `artist` (Apple ID/link) |
| GET | `/artists/top-songs` | `artist`, `page`, `limit` |
| GET | `/artists/albums` | `artist`, `type`, `page`, `limit` |
| GET | `/artists/similar` | `artist`, `limit` |
| GET | `/artists/music-videos` | `artist`, `page`, `limit` |
| GET | `/artists/events` | `artist` |
| GET | `/albums/details` | `album` (Apple album ID/link) |
| GET | `/albums/related` | `album` |
| GET | `/charts/list` | optional `country` |
| GET | `/charts/top` | `region`, optional `city`, `page`, `limit` |
| GET | `/charts/genre` | `genre`, `region`, `page`, `limit` |
| GET | `/charts/viral` | `region`, `page`, `limit` |
| GET | `/charts/momentum` | `region`, `page`, `limit` |
| GET | `/events/search` | `region`, `city`, `genre`, `upcoming_only` |
| GET | `/events/details` | `event` (UUID) |
| GET | `/health` | none |

The original Python app has extensive response normalizers and edge-case resolution logic; some metadata response fields and validation differ in the Node port, especially artist profile data, lyrics / analytics, events, Apple ID resolution, and chart details. These endpoints rely on Shazam's changing web pages and Apple's catalog. Treat the core recognition flow as the port's verified component, and live-test the secondary routes before production deployment.

## Environment variables

Copy `.env.example` to `.env`, then either launch with Node's env loader (`node --env-file=.env src/server.js`) or configure your hosting platform's environment variables.

| Variable | Default | Meaning |
|---|---|---|
| `PORT` | `8000` | API listener port |
| `HOST` | `127.0.0.1` | Bind address; set to `0.0.0.0` when deployed |
| `API_KEY` | unset | When set, all API calls except `/health` require `X-API-Key` header |
| `MAX_AUDIO_MB` | `30` | Upload and remote audio byte cap (1–100 MiB) |
| `MAX_CONCURRENT` | `2` | Max simultaneous recognition requests |
| `MAX_WINDOWS` | `3` | Recognition attempts per recording |
| `FFMPEG_PATH` | `ffmpeg` | FFmpeg executable |
| `FFPROBE_PATH` | `ffprobe` | FFprobe executable |
| `SHAZAM_TIMEZONE` | `America/Chicago` | Timezone sent to discovery endpoint |
| `SHAZAM_MUSICKIT_TOKEN` | unset | Optional existing Apple developer token, otherwise requested from Shazam's public validate endpoint |
| `ENABLE_REMOTE_URLS` | `false` | Opt into guarded URL downloads. Public hosts only; redirects blocked; IPv6 blocked |
| `REQUEST_TIMEOUT_MS` | `20000` | External network timeout |
| `RATE_LIMIT_PER_MINUTE` | `20` | Simple per-IP limiter; use gateway/WAF for public deployment |

### Public hosting caveats

- **Do not expose the service publicly without `API_KEY`, HTTPS, and a gateway/WAF.** The included limiter is per-process, in-memory, and not a distributed rate limiter.
- The URL downloader rejects private/reserved IPv4, IPv6, DNS records resolving privately, credentials and redirects; URL fetching is **disabled by default** because server-side remote URLs create SSRF risk. Still audit your specific network environment before enabling it.
- Requests to Shazam and Apple can fail with HTTP 401/403/429, challenges, or changed JSON/page layouts. The project **does not evade website challenges**.
- Respect applicable site terms, copyrights, privacy laws, and rate limits.
- No Python subprocesses and no database files. The Node SigX implementation has no native addon dependencies.

## Architecture

```text
src/
  fingerprint.js   FFT/peak picking, SigX encoding and CRC32 (pure JavaScript)
  audio.js         Secure temporary audio, FFmpeg decode, FFprobe duration
  recognize.js     Multi-window recognition orchestrator
  transport.js     Shazam tag / discovery transport, retries / timeouts
  parser.js        Shazam & Apple JSON normalizers
  music.js         Songs, search, albums and artist collections
  pages.js         Next.js RSC flight parser, songs, events, artist pages
  catalog.js       Charts, lyrics, analysis, events
  remote.js        Optional SSRF-guarded URL downloader
  server.js        Built-in HTTP server & bounded multipart parsing
  cli.js           Local audio CLI
  config.js        Environment defaults
  errors.js        Sanitized HTTP errors
```

An optional Dockerfile and docker-compose.yml are provided; Docker is **not** necessary for local Windows use. The compose example binds the service to localhost and requires an API key.

`test/fixtures/python.sig` was generated by the uploaded original Python implementation from `test/fixtures/signal.pcm`. The regression test compares the Node output against this reference byte-for-byte. `test/fixtures/recognition-response.json` is the original project's sample fixture; all tests that exercise recognition responses use mocks, **not a successful live Shazam request**.

## License / attribution

MIT License (see `LICENSE`). Original Python project copyright (c) 2026 Chetan Jain; SigX algorithm derived from the MIT-licensed code in the supplied project and its cited reference implementations. This rewrite retains the original license notice.
