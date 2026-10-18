# Render Deployment Guide 🚀

This guide explains how to deploy the **Shazam Node.js API & Song Recognition Service** to [Render](https://render.com) smoothly and reliably.

---

## 🌟 Quick Options Overview

| Method | Recommended For | Setup Time | FFmpeg Configuration |
|---|---|---|---|
| **Option 1: Docker Web Service (Recommended)** | Production / Easy 1-Click | ~3 minutes | Pre-packaged in Dockerfile |
| **Option 2: Render Blueprint (`render.yaml`)** | Infrastructure as Code | ~1 minute | Automatic via Docker |
| **Option 3: Native Node.js Web Service** | Non-Docker deployments | ~3 minutes | Automated via `render-build.sh` |

---

## Option 1: Docker Web Service (Recommended)

Render has first-class Docker support. Because Shazam audio processing requires `ffmpeg` and `ffprobe`, using the provided `Dockerfile` guarantees that all required audio codecs and dependencies are installed.

### Steps:
1. Push your repository to **GitHub** or **GitLab**.
2. Log in to your [Render Dashboard](https://dashboard.render.com).
3. Click **New +** → **Web Service**.
4. Choose **Build and deploy from a Git repository** and connect your repository.
5. In the settings:
   - **Name:** `shazam-api` (or your choice)
   - **Language / Runtime:** `Docker`
   - **Branch:** `main` (or your default branch)
   - **Region:** Choose closest to your users (e.g., Oregon, Frankfurt, Singapore)
   - **Instance Type:** `Free` or `Starter`
6. Under **Advanced / Environment Variables**, add any optional variables:
   - `HOST`: `0.0.0.0` (set by default in Dockerfile)
   - `PORT`: `10000` (Render configures this automatically)
   - `API_KEY`: *(Optional)* If set, all requests require `X-API-Key: your_key`
   - `MAX_AUDIO_MB`: `30`
   - `MAX_CONCURRENT`: `4`
   - `ENABLE_REMOTE_URLS`: `false`
7. Click **Create Web Service**.
8. Render will build the Docker container and start listening. Once healthy, your URL will be ready:
   ```
   https://shazam-api-xxxx.onrender.com
   ```

---

## Option 2: 1-Click Blueprint (`render.yaml`)

This repository includes a pre-configured `render.yaml` Blueprint specification.

### Steps:
1. Push your repository to GitHub.
2. In the Render Dashboard, click **New +** → **Blueprint**.
3. Select your repository.
4. Render will parse `render.yaml` and configure the Web Service with health check path `/health`, auto-deployment, and environment defaults.
5. Click **Apply**.

---

## Option 3: Native Node.js Web Service

If you prefer not to use Docker, you can run directly on Render's native Node.js runtime using the included `render-build.sh` script, which automatically downloads static Linux `ffmpeg` and `ffprobe` binaries.

### Settings in Render:
- **Environment:** `Node`
- **Node Version:** `22` (Render will detect Node from `package.json`)
- **Build Command:**
  ```bash
  chmod +x ./render-build.sh && ./render-build.sh
  ```
- **Start Command:**
  ```bash
  npm start
  ```
- **Health Check Path:** `/health`

---

## 🔍 Verifying Your Deployment

Once your Render service status turns to **"Live"**, you can verify it:

### 1. Health Check
```bash
curl -i https://YOUR-APP.onrender.com/health
```

Expected Response (`200 OK`):
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

### 2. Live Song Recognition from Audio File
Upload any MP3, M4A, WAV, or MP4 file:
```bash
curl -X POST "https://YOUR-APP.onrender.com/recognize/file" \
  -F "file=@your-song.mp3"
```

Response:
```json
{
  "is_matched": true,
  "source": "your-song.mp3",
  "audio": {
    "bytes": 3180524,
    "duration_seconds": 198.7
  },
  "track": {
    "shazam_key": "421408551",
    "title": "Hithu Manapeta",
    "artist_name": "Milinda Sandaruwan",
    "link": "https://www.shazam.com/track/421408551/...",
    "genre": "Asia",
    "release_date": "2016"
  }
}
```

### 3. Song & Artist Search
```bash
curl "https://YOUR-APP.onrender.com/search?query=Coldplay%20Yellow&limit=3"
```

---

## 🛠️ Environment Variables Reference

| Variable | Default | Recommended on Render | Description |
|---|---|---|---|
| `PORT` | `8000` | Auto (e.g. `10000`) | Listener port assigned by Render |
| `HOST` | `127.0.0.1` | `0.0.0.0` | Bind address (must be `0.0.0.0` on Render) |
| `NODE_ENV` | `development` | `production` | Production environment optimizations |
| `API_KEY` | *(empty)* | Secret key | When set, requires `X-API-Key` header |
| `MAX_AUDIO_MB` | `30` | `30` | Maximum upload size in megabytes |
| `MAX_CONCURRENT` | `2` | `4` | Max simultaneous recognition decodes |
| `MAX_WINDOWS` | `3` | `3` | Window attempts per recognition |
| `ENABLE_REMOTE_URLS` | `false` | `false` | Enable/disable `/recognize/url` endpoint |
| `REQUEST_TIMEOUT_MS` | `20000` | `20000` | Timeout for external requests (ms) |

---

## ⚠️ Troubleshooting on Render

1. **Free Tier Spin-Down**:
   - On Render's Free tier, services spin down after 15 minutes of inactivity. The first request after sleep may take ~30-50 seconds to wake up.
   - For instant response times, use Render Starter tier or set up an uptime monitor (e.g., UptimeRobot pinging `/health` every 10 minutes).

2. **502 Bad Gateway / Port Binding**:
   - Ensure `HOST` is set to `0.0.0.0` (not `127.0.0.1` or `localhost`). The project already defaults `HOST` to `0.0.0.0` when `RENDER=true` or in production.

3. **FFmpeg missing error**:
   - If deploying with Docker (recommended), FFmpeg is pre-installed in the container.
   - If deploying with native Node, make sure your build command is `npm run render-build`.
