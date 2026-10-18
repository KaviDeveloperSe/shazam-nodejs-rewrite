# Shazam Node.js API Documentation 📡

Complete API reference guide for the **Shazam Node.js Song Recognition & Music Catalog Service**.

---

## 📑 Table of Contents

- [Overview & Base URL](#overview--base-url)
- [Authentication & Headers](#authentication--headers)
- [Status Codes & Error Handling](#status-codes--error-handling)
- [Endpoints](#endpoints)
  - [1. System & Health](#1-system--health)
    - [`GET /health`](#get-health)
  - [2. Song Recognition](#2-song-recognition)
    - [`POST /recognize/file`](#post-recognizefile)
    - [`GET /recognize/url`](#get-recognizeurl)
  - [3. Search & Suggestions](#3-search--suggestions)
    - [`GET /search`](#get-search)
    - [`GET /search/auto-complete`](#get-searchauto-complete)
  - [4. Songs & Tracks](#4-songs--tracks)
    - [`GET /songs/details`](#get-songsdetails)
    - [`GET /songs/lyrics`](#get-songslyrics)
    - [`GET /songs/audio-analysis`](#get-songsaudio-analysis)
    - [`GET /songs/popular-segments`](#get-songspopular-segments)
    - [`GET /songs/similar`](#get-songssimilar)
    - [`GET /songs/music-videos`](#get-songsmusic-videos)
    - [`GET /songs/batch`](#get-songsbatch)
  - [5. Artists](#5-artists)
    - [`GET /artists/details`](#get-artistsdetails)
    - [`GET /artists/top-songs`](#get-artiststop-songs)
    - [`GET /artists/albums`](#get-artistsalbums)
    - [`GET /artists/similar`](#get-artistssimilar)
    - [`GET /artists/music-videos`](#get-artistsmusic-videos)
    - [`GET /artists/events`](#get-artistsevents)
  - [6. Albums](#6-albums)
    - [`GET /albums/details`](#get-albumsdetails)
    - [`GET /albums/related`](#get-albumsrelated)
  - [7. Charts & Trends](#7-charts--trends)
    - [`GET /charts/top`](#get-chartstop)
    - [`GET /charts/genre`](#get-chartsgenre)
    - [`GET /charts/viral`](#get-chartsviral)
    - [`GET /charts/momentum`](#get-chartsmomentum)
    - [`GET /charts/list`](#get-chartslist)
  - [8. Events](#8-events)
    - [`GET /events/search`](#get-eventssearch)
    - [`GET /events/details`](#get-eventsdetails)
- [SDK & Code Examples](#sdk--code-examples)

---

## Overview & Base URL

All routes can be called either with their base path (e.g., `/recognize/file`) or with the `/shazam/` prefix (e.g., `/shazam/recognize/file`).

- **Local:** `http://127.0.0.1:8000`
- **Render Production:** `https://your-service.onrender.com`

---

## Authentication & Headers

If `API_KEY` is set in your `.env` or Render environment variables, all requests (except `/health`) require the `X-API-Key` header:

```http
X-API-Key: your_secret_api_key
```

If `API_KEY` is not set, requests are unauthenticated (ideal for private internal networks or testing).

---

## Status Codes & Error Handling

Standard HTTP response codes:

| HTTP Status | Meaning | Description |
|---|---|---|
| `200 OK` | Success | The request completed successfully. |
| `400 Bad Request` | Input Error | Missing required query parameters, invalid types, or malformed multipart body. |
| `401 Unauthorized` | Auth Error | Missing or invalid `X-API-Key` header. |
| `404 Not Found` | Not Found | Route does not exist or resource ID not found. |
| `429 Too Many Requests` | Rate Limited | Exceeded `RATE_LIMIT_PER_MINUTE`. |
| `503 Service Unavailable` | Busy | Exceeded `MAX_CONCURRENT` audio recognition jobs. Try again shortly. |
| `500 Internal Error` | Server Error | Internal processing or dependency failure. |

**Error Response Body:**
```json
{
  "error": "Missing or invalid query",
  "code": "INPUT_ERROR"
}
```

---

## Endpoints

### 1. System & Health

#### `GET /health`
Returns the status of the Node.js API server and active recognition slots. Does **not** require an API key.

##### Example Request:
```bash
curl -s http://127.0.0.1:8000/health
```

##### Example Response (`200 OK`):
```json
{
  "status": "ok",
  "backend": "nodejs",
  "recognition_jobs": 0,
  "endpoints": [
    "/search",
    "/search/auto-complete",
    "/songs/details",
    "/songs/lyrics",
    "/charts/top",
    "/recognize/url",
    "POST /recognize/file"
  ]
}
```

---

### 2. Song Recognition

#### `POST /recognize/file`
Upload an audio or video file (MP3, WAV, M4A, FLAC, MP4, MKV, WebM) to identify the song using Shazam's pure JS SigX algorithm.

##### Request Type: `multipart/form-data`
- **`file`** *(Required, File)*: Audio file binary (field name can also be `audio` or `upload_file`). Maximum size defined by `MAX_AUDIO_MB` (default: 30 MB).

##### Query Parameters (Optional):
| Parameter | Type | Default | Description |
|---|---|---|---|
| `offset_seconds` | Float | Middle of song | Starting offset in seconds to sample |
| `duration_seconds`| Float | `12` | Sample length in seconds (3–30) |
| `country` | String | `US` | 2-letter ISO country code |
| `language` | String | `en-US` | Locale code |

##### Example Request (`curl`):
```bash
curl -X POST "http://127.0.0.1:8000/recognize/file" \
  -F "file=@song.mp3"
```

##### Example Request (`JavaScript Fetch`):
```javascript
const formData = new FormData();
formData.append('file', audioBlob, 'audio.mp3');

const res = await fetch('http://127.0.0.1:8000/recognize/file', {
  method: 'POST',
  body: formData
});
const data = await res.json();
console.log(data.track?.title, data.track?.artist_name);
```

##### Example Response (`200 OK`):
```json
{
  "is_matched": true,
  "source": "song.mp3",
  "audio": {
    "bytes": 3180524,
    "duration_seconds": 198.728
  },
  "attempts": [
    {
      "offset_seconds": 93.364,
      "duration_seconds": 12,
      "is_matched": true
    }
  ],
  "matches": [
    {
      "shazam_key": "474645352",
      "offset_seconds": 93.18,
      "time_skew": -0.00005,
      "frequency_skew": 0
    }
  ],
  "track": {
    "shazam_key": "421408551",
    "apple_id": "1107348831",
    "title": "Hithu Manapeta (feat. Sangeeth n Arosh)",
    "artist_name": "Milinda Sandaruwan",
    "album_name": "Hithu Manapeta - Single",
    "genre": "Asia",
    "release_date": "2016",
    "label": "Revive Entertainment",
    "link": "https://www.shazam.com/track/421408551/hithu-manapeta",
    "images": {
      "cover_art": "https://is1-ssl.mzstatic.com/image/.../400x400cc.jpg",
      "cover_art_hq": "https://is1-ssl.mzstatic.com/image/.../400x400cc.jpg"
    },
    "hub": {
      "provider": "APPLE MUSIC",
      "listen_link": "https://music.apple.com/song/1107348831",
      "preview_link": "https://audio-ssl.itunes.apple.com/.../preview.m4a"
    }
  }
}
```

---

#### `GET /recognize/url`
Download audio from a public URL and recognize it.
*(Note: Requires `ENABLE_REMOTE_URLS=true` in environment for SSRF security).*

##### Query Parameters:
| Parameter | Type | Required | Description |
|---|---|---|---|
| `url` | String | Yes | Public HTTP/HTTPS URL of audio |
| `country` | String | No | ISO country code (default `US`) |
| `language` | String | No | Language locale (default `en-US`) |

##### Example Request:
```bash
curl "http://127.0.0.1:8000/recognize/url?url=https://example.com/audio.mp3"
```

---

### 3. Search & Suggestions

#### `GET /search`
Search the Shazam & Apple Music catalog for songs, artists, albums, or playlists.

##### Query Parameters:
| Parameter | Type | Default | Description |
|---|---|---|---|
| `query` | String | **Required** | Search keyword (e.g. `Blinding Lights`) |
| `type` | String | `all` | `all`, `songs`, `artists`, `albums`, `playlists`, `music-videos` |
| `limit` | Integer| `10` | Number of results (1–200) |
| `page` | Integer| `1` | Pagination page number (1–40) |
| `country` | String | `US` | 2-letter ISO country code |
| `language` | String | `en-US` | Locale code |

##### Example Request:
```bash
curl "http://127.0.0.1:8000/search?query=The%20Weeknd&type=songs&limit=2"
```

##### Example Response (`200 OK`):
```json
{
  "songs": [
    {
      "shazam_key": "503576063",
      "apple_id": "1499378607",
      "name": "Blinding Lights",
      "artist_name": "The Weeknd",
      "album_name": "After Hours",
      "shazam_link": "https://www.shazam.com/track/503576063",
      "apple_music_link": "https://music.apple.com/us/album/blinding-lights/1499378593?i=1499378607",
      "genres": ["R&B/Soul", "Pop"]
    }
  ],
  "count": 1,
  "current_page": 1,
  "total_pages": 1,
  "next": null,
  "previous": null
}
```

---

#### `GET /search/auto-complete`
Instant auto-complete search query suggestions as the user types.

##### Query Parameters:
| Parameter | Type | Default | Description |
|---|---|---|---|
| `query` | String | **Required** | Partial search text |
| `limit` | Integer| `10` | Maximum suggestions (1–25) |

##### Example Request:
```bash
curl "http://127.0.0.1:8000/search/auto-complete?query=shape%20of"
```

---

### 4. Songs & Tracks

#### `GET /songs/details`
Retrieve comprehensive metadata for a specific track.

##### Query Parameters:
| Parameter | Type | Required | Description |
|---|---|---|---|
| `track` | String | Yes | Shazam track ID (`503576063`), Apple ID (`apple:1499378607`), or ISRC code |
| `country` | String | No | Country code (default `US`) |
| `language` | String | No | Locale (default `en-US`) |

##### Example Request:
```bash
curl "http://127.0.0.1:8000/songs/details?track=503576063"
```

---

#### `GET /songs/lyrics`
Fetch synchronized or text lyrics for a song.

##### Query Parameters:
| Parameter | Type | Required | Description |
|---|---|---|---|
| `track` | String | Yes | Shazam track ID |

##### Example Request:
```bash
curl "http://127.0.0.1:8000/songs/lyrics?track=503576063"
```

##### Example Response:
```json
{
  "track_id": "503576063",
  "lyrics": [
    "Yeah",
    "I've been tryna call",
    "I've been on my own for long enough",
    "Maybe you can show me how to love, maybe"
  ],
  "provider": "Musixmatch"
}
```

---

#### `GET /songs/audio-analysis`
Get audio characteristics (BPM, musical key, energy, danceability, acousticness).

##### Query Parameters:
| Parameter | Type | Required | Description |
|---|---|---|---|
| `track` | String | Yes | Shazam track ID |

##### Example Request:
```bash
curl "http://127.0.0.1:8000/songs/audio-analysis?track=503576063"
```

---

#### `GET /songs/popular-segments`
Get the most tagged/popular timestamp segments and playback heatmap for a song.

##### Query Parameters:
| Parameter | Type | Required | Description |
|---|---|---|---|
| `track` | String | Yes | Shazam track ID |

##### Example Request:
```bash
curl "http://127.0.0.1:8000/songs/popular-segments?track=503576063"
```

---

#### `GET /songs/similar`
Get tracks that are musically or stylistically similar to the specified song.

##### Query Parameters:
| Parameter | Type | Default | Description |
|---|---|---|---|
| `track` | String | **Required** | Shazam track ID |
| `limit` | Integer| `20` | Max results (1–200) |
| `page` | Integer| `1` | Page number |

##### Example Request:
```bash
curl "http://127.0.0.1:8000/songs/similar?track=503576063&limit=5"
```

---

#### `GET /songs/music-videos`
Get official music videos associated with a song.

##### Query Parameters:
| Parameter | Type | Required | Description |
|---|---|---|---|
| `track` | String | Yes | Shazam track ID |

##### Example Request:
```bash
curl "http://127.0.0.1:8000/songs/music-videos?track=503576063"
```

---

#### `GET /songs/batch`
Fetch details for up to 25 songs in a single round-trip.

##### Query Parameters:
| Parameter | Type | Required | Description |
|---|---|---|---|
| `tracks` | String | Yes | Comma-separated track IDs (e.g. `503576063,40333609`) |

##### Example Request:
```bash
curl "http://127.0.0.1:8000/songs/batch?tracks=503576063,40333609"
```

---

### 5. Artists

#### `GET /artists/details`
Retrieve an artist's profile, bio, genre tags, and social handles.

##### Query Parameters:
| Parameter | Type | Required | Description |
|---|---|---|---|
| `artist` | String | Yes | Apple artist ID (e.g. `408801332`) or Apple Music artist link |

##### Example Request:
```bash
curl "http://127.0.0.1:8000/artists/details?artist=408801332"
```

---

#### `GET /artists/top-songs`
Get top songs by an artist ordered by popularity.

##### Query Parameters:
| Parameter | Type | Default | Description |
|---|---|---|---|
| `artist` | String | **Required** | Apple artist ID |
| `limit` | Integer| `20` | Results limit |
| `page` | Integer| `1` | Page number |

##### Example Request:
```bash
curl "http://127.0.0.1:8000/artists/top-songs?artist=408801332&limit=10"
```

---

#### `GET /artists/albums`
Get discography albums and singles for an artist.

##### Query Parameters:
| Parameter | Type | Default | Description |
|---|---|---|---|
| `artist` | String | **Required** | Apple artist ID |
| `type` | String | `all` | `all`, `albums`, or `singles` |
| `limit` | Integer| `20` | Results limit |

##### Example Request:
```bash
curl "http://127.0.0.1:8000/artists/albums?artist=408801332&type=albums"
```

---

#### `GET /artists/similar`
Get similar artists.

##### Query Parameters:
| Parameter | Type | Default | Description |
|---|---|---|---|
| `artist` | String | **Required** | Apple artist ID |
| `limit` | Integer| `20` | Results limit |

##### Example Request:
```bash
curl "http://127.0.0.1:8000/artists/similar?artist=408801332&limit=5"
```

---

#### `GET /artists/music-videos`
Get music videos by this artist.

##### Query Parameters:
| Parameter | Type | Default | Description |
|---|---|---|---|
| `artist` | String | **Required** | Apple artist ID |

##### Example Request:
```bash
curl "http://127.0.0.1:8000/artists/music-videos?artist=408801332"
```

---

#### `GET /artists/events`
Get upcoming live concert events and tour dates for an artist.

##### Query Parameters:
| Parameter | Type | Required | Description |
|---|---|---|---|
| `artist` | String | Yes | Apple artist ID |

##### Example Request:
```bash
curl "http://127.0.0.1:8000/artists/events?artist=408801332"
```

---

### 6. Albums

#### `GET /albums/details`
Get album metadata, track list, release date, record label, and high-res cover art.

##### Query Parameters:
| Parameter | Type | Required | Description |
|---|---|---|---|
| `album` | String | Yes | Apple Album ID (e.g. `1499378593`) or album link |

##### Example Request:
```bash
curl "http://127.0.0.1:8000/albums/details?album=1499378593"
```

---

#### `GET /albums/related`
Get related albums and editions.

##### Query Parameters:
| Parameter | Type | Required | Description |
|---|---|---|---|
| `album` | String | Yes | Apple Album ID |

##### Example Request:
```bash
curl "http://127.0.0.1:8000/albums/related?album=1499378593"
```

---

### 7. Charts & Trends

#### `GET /charts/top`
Get top 100 or 200 songs charting globally, by country, or by city.

##### Query Parameters:
| Parameter | Type | Default | Description |
|---|---|---|---|
| `region` | String | `world` | Country ISO code (e.g. `US`, `GB`, `world`) |
| `city` | String | None | Optional city name (e.g. `new-york`) |
| `limit` | Integer| `20` | Results limit |
| `page` | Integer| `1` | Page number |

##### Example Request:
```bash
curl "http://127.0.0.1:8000/charts/top?region=US&limit=10"
```

---

#### `GET /charts/genre`
Get top charts filtered by musical genre.

##### Query Parameters:
| Parameter | Type | Default | Description |
|---|---|---|---|
| `genre` | String | **Required** | Genre name (e.g. `pop`, `dance`, `hip-hop-rap`, `rock`) |
| `region` | String | `world` | Region code (e.g. `world`, `US`) |
| `limit` | Integer| `20` | Results limit |

##### Example Request:
```bash
curl "http://127.0.0.1:8000/charts/genre?genre=pop&region=world&limit=10"
```

---

#### `GET /charts/viral`
Get songs currently trending or going viral on Shazam.

##### Query Parameters:
| Parameter | Type | Default | Description |
|---|---|---|---|
| `region` | String | `world` | Region code |
| `limit` | Integer| `20` | Results limit |

##### Example Request:
```bash
curl "http://127.0.0.1:8000/charts/viral?region=world&limit=10"
```

---

#### `GET /charts/momentum`
Get songs with the fastest rising trajectory in discovery queries.

##### Query Parameters:
| Parameter | Type | Default | Description |
|---|---|---|---|
| `region` | String | `US` | Region code |
| `limit` | Integer| `20` | Results limit |

##### Example Request:
```bash
curl "http://127.0.0.1:8000/charts/momentum?region=US&limit=10"
```

---

#### `GET /charts/list`
Lists available country and genre chart categories supported by Shazam.

##### Query Parameters:
| Parameter | Type | Default | Description |
|---|---|---|---|
| `country` | String | None | Optional ISO country filter |

##### Example Request:
```bash
curl "http://127.0.0.1:8000/charts/list"
```

---

### 8. Events

#### `GET /events/search`
Search live music concerts and festival events.

##### Query Parameters:
| Parameter | Type | Default | Description |
|---|---|---|---|
| `region` | String | `US` | Region or country |
| `city` | String | None | City name |
| `genre` | String | None | Musical genre |
| `upcoming_only`| String | `true` | Only future events |

##### Example Request:
```bash
curl "http://127.0.0.1:8000/events/search?region=US&city=Los%20Angeles"
```

---

#### `GET /events/details`
Get full details and ticket purchase links for an event.

##### Query Parameters:
| Parameter | Type | Required | Description |
|---|---|---|---|
| `event` | String | Yes | Event UUID |

##### Example Request:
```bash
curl "http://127.0.0.1:8000/events/details?event=YOUR-EVENT-UUID"
```

---

## SDK & Code Examples

### Node.js (Full Recognition Example)

```javascript
import fs from 'node:fs';

async function identifySong(filePath) {
  const formData = new FormData();
  const fileBytes = fs.readFileSync(filePath);
  const blob = new Blob([fileBytes], { type: 'audio/mpeg' });
  formData.append('file', blob, 'sample.mp3');

  const response = await fetch('http://127.0.0.1:8000/recognize/file', {
    method: 'POST',
    headers: {
      // 'X-API-Key': 'your_secret_key' // if API_KEY is set
    },
    body: formData
  });

  if (!response.ok) {
    throw new Error(`Recognition failed: ${response.status}`);
  }

  const result = await response.json();
  if (result.is_matched) {
    console.log(`🎵 Identified: ${result.track.title} by ${result.track.artist_name}`);
    console.log(`🔗 Link: ${result.track.link}`);
  } else {
    console.log('✖ Song not recognized');
  }
}

identifySong('./song.mp3');
```

---

### Python Example

```python
import requests

def recognize_audio(file_path):
    url = "http://127.0.0.1:8000/recognize/file"
    headers = {
        # "X-API-Key": "your_secret_key"
    }
    
    with open(file_path, "rb") as f:
        files = {"file": f}
        res = requests.post(url, headers=headers, files=files)
        
    data = res.json()
    if data.get("is_matched"):
        track = data["track"]
        print(f"🎵 {track['title']} - {track['artist_name']}")
        print(f"Album: {track.get('album_name')}")
        print(f"Link: {track.get('link')}")
    else:
        print("No song match found")

recognize_audio("song.mp3")
```
