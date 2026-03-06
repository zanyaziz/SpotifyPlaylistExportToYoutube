# Spotify → YouTube Playlist Migrator

A Node.js terminal app that reads a Spotify playlist and recreates it on YouTube, with confidence scoring for each matched track.

## Prerequisites

- Node.js v18+
- A Spotify account (free or premium — Premium is **not** required to read playlists via the API)
- A Spotify Developer account (free) to create an app and get API credentials
- A Google account with YouTube Data API v3 enabled

> **Note:** The Spotify Web API is free to use for reading playlists and does not require a Spotify Premium subscription. However, your Spotify Developer app must have **Web API** explicitly enabled in its settings, and your Spotify account must be added to the app's **User Management** list while the app is in Development Mode.

---

## Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Spotify credentials

1. Go to [Spotify Developer Dashboard](https://developer.spotify.com/dashboard)
2. Click **Create App**
3. Set **Redirect URI** to: `http://127.0.0.1:8000/callback`
4. Under **"Which API/SDKs are you planning to use?"** — check **Web API** (required, or all API calls return 403)
5. Copy your **Client ID** and **Client Secret**
6. Go to **Settings → User Management** and add your Spotify account email (required while app is in Development Mode)

### 3. YouTube / Google credentials

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project (or select an existing one)
3. Enable **YouTube Data API v3** (APIs & Services → Library → search "YouTube Data API v3")
4. Go to **APIs & Services → Credentials**
5. Click **Create Credentials → OAuth 2.0 Client ID**
6. Application type: **Desktop app**
7. Add `http://127.0.0.1:8001/callback` as an authorized redirect URI
8. Copy your **Client ID** and **Client Secret**
9. Go to **APIs & Services → OAuth consent screen** → add your Google account as a test user

### 4. Configure environment

```bash
cp .env.example .env
```

Edit `.env` and fill in all four values:

```
SPOTIFY_CLIENT_ID=...
SPOTIFY_CLIENT_SECRET=...
YOUTUBE_CLIENT_ID=...
YOUTUBE_CLIENT_SECRET=...
```

---

## Usage

```bash
npm start
```

The app will:
1. Ask for the Spotify playlist URL or ID
2. Ask the minimum confidence threshold for migration
3. Open your browser to authenticate Spotify
4. Open your browser to authenticate YouTube (Google)
5. Search YouTube for each track and score the matches
6. Create a new (private) YouTube playlist and add all qualifying videos
7. Print a full report showing migrated vs. flagged tracks
8. Save a detailed JSON report to the current directory

### Confidence levels

| Level | Meaning |
|---|---|
| **HIGH** | Strong title + artist match, duration within 5s, often an official channel |
| **MEDIUM** | Good match but some uncertainty (e.g., different duration or non-official channel) |
| **LOW** | Weak match — possibly a cover, remix, or incorrect result |
| **NOT_FOUND** | No suitable result found on YouTube |

---

## YouTube API Quota

The free YouTube Data API v3 quota is **10,000 units/day**.

- Each track search costs ~100–200 units (search + video details)
- A 50-track playlist uses ~5,000–10,000 units
- For larger playlists, request a quota increase in Google Cloud Console or spread the migration across multiple days

---

## Output

- Terminal: color-coded report grouped by confidence
- File: `migration_<playlist>_<timestamp>.json` with full details including match scores and reasons
