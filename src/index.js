#!/usr/bin/env node

import 'dotenv/config';
import chalk from 'chalk';
import Enquirer from 'enquirer';
const { prompt } = Enquirer;
import cliProgress from 'cli-progress';

import {
  createSpotifyClient,
  authenticateSpotify,
  getPlaylistTracks,
  extractPlaylistId,
} from './spotify.js';

import {
  createOAuthClient,
  authenticateYouTube,
  searchYouTube,
  createPlaylist,
  addVideoToPlaylist,
} from './youtube.js';

import { CONFIDENCE } from './matcher.js';
import { printReport, saveReport } from './report.js';

const YOUTUBE_REDIRECT_URI = process.env.YOUTUBE_REDIRECT_URI || 'http://127.0.0.1:8001/callback';
const SPOTIFY_REDIRECT_URI = process.env.SPOTIFY_REDIRECT_URI || 'http://127.0.0.1:8000/callback';

async function main() {
  printBanner();
  validateEnv();

  // ── Step 1: Get Spotify playlist URL from user ──────────────────────────────
  const { playlistInput } = await prompt({
    type: 'input',
    name: 'playlistInput',
    message: 'Enter Spotify playlist URL or ID:',
    validate: (v) => v.trim().length > 0 || 'Please enter a playlist URL or ID',
  });

  let playlistId;
  try {
    playlistId = extractPlaylistId(playlistInput);
  } catch (e) {
    console.error(chalk.red('Error: ' + e.message));
    process.exit(1);
  }

  // ── Step 2: Ask which confidence levels to migrate ──────────────────────────
  const CONFIDENCE_CHOICES = {
    'HIGH only (most accurate, fewest tracks)': 'HIGH',
    'MEDIUM and above (recommended)': 'MEDIUM',
    'LOW and above (include uncertain matches)': 'LOW',
  };
  const { minConfidenceLabel } = await prompt({
    type: 'select',
    name: 'minConfidenceLabel',
    message: 'Minimum confidence level to add to YouTube playlist:',
    choices: Object.keys(CONFIDENCE_CHOICES),
  });
  const minConfidence = CONFIDENCE_CHOICES[minConfidenceLabel];

  // ── Step 3: Authenticate Spotify ────────────────────────────────────────────
  const spotifyApi = createSpotifyClient(
    process.env.SPOTIFY_CLIENT_ID,
    process.env.SPOTIFY_CLIENT_SECRET,
    SPOTIFY_REDIRECT_URI
  );
  await authenticateSpotify(spotifyApi);

  // ── Step 4: Fetch tracks ────────────────────────────────────────────────────
  let playlistName, tracks;
  try {
    ({ playlistName, tracks } = await getPlaylistTracks(spotifyApi, playlistId));
  } catch (e) {
    const status = e.response?.status || e.statusCode || 'unknown';
    const body = e.response?.data || e.message;
    console.error(chalk.red(`[Spotify] Failed to fetch playlist (HTTP ${status}): ${JSON.stringify(body)}`));
    process.exit(1);
  }

  console.log(chalk.green(`[Spotify] Fetched ${tracks.length} tracks from "${playlistName}"\n`));

  // ── Step 5: Authenticate YouTube ────────────────────────────────────────────
  const oauth2Client = createOAuthClient(
    process.env.YOUTUBE_CLIENT_ID,
    process.env.YOUTUBE_CLIENT_SECRET,
    YOUTUBE_REDIRECT_URI
  );
  await authenticateYouTube(oauth2Client);

  // ── Step 6: Search YouTube for each track ───────────────────────────────────
  console.log(chalk.cyan('[YouTube] Searching for tracks...\n'));

  const bar = new cliProgress.SingleBar({
    format: '  Searching |{bar}| {value}/{total} | {track}',
    barCompleteChar: '█',
    barIncompleteChar: '░',
    hideCursor: true,
  }, cliProgress.Presets.shades_classic);

  bar.start(tracks.length, 0, { track: '' });

  const results = [];
  for (const track of tracks) {
    bar.update(results.length, { track: truncate(`${track.artists[0]} - ${track.name}`, 30) });

    let match = null;
    try {
      match = await searchYouTube(oauth2Client, track);
    } catch (e) {
      if (e.message.includes('quota')) {
        bar.stop();
        console.error(chalk.red('\n[YouTube] ' + e.message));
        process.exit(1);
      }
      match = { confidence: CONFIDENCE.NOT_FOUND, score: 0, reasons: ['search_error: ' + e.message] };
    }

    results.push({ track, match, confidence: match?.confidence || CONFIDENCE.NOT_FOUND });

    // Small delay to be polite to the API
    await sleep(300);
  }

  bar.update(tracks.length, { track: 'Done!' });
  bar.stop();

  // ── Step 7: Create YouTube playlist & add videos ────────────────────────────
  const CONFIDENCE_ORDER = [CONFIDENCE.HIGH, CONFIDENCE.MEDIUM, CONFIDENCE.LOW];
  const minIdx = CONFIDENCE_ORDER.indexOf(minConfidence);
  const toMigrate = results.filter((r) => {
    const idx = CONFIDENCE_ORDER.indexOf(r.confidence);
    return idx !== -1 && idx <= minIdx;
  });

  console.log(chalk.cyan(`\n[YouTube] Creating playlist "${playlistName}"...`));
  const ytPlaylistId = await createPlaylist(
    oauth2Client,
    playlistName,
    `Migrated from Spotify by spotify-to-youtube`
  );
  const ytPlaylistUrl = `https://www.youtube.com/playlist?list=${ytPlaylistId}`;

  console.log(chalk.cyan(`[YouTube] Adding ${toMigrate.length} videos to playlist...`));

  const addBar = new cliProgress.SingleBar({
    format: '  Adding    |{bar}| {value}/{total} | {track}',
    barCompleteChar: '█',
    barIncompleteChar: '░',
    hideCursor: true,
  }, cliProgress.Presets.shades_classic);

  addBar.start(toMigrate.length, 0, { track: '' });

  let added = 0;
  for (const r of toMigrate) {
    addBar.update(added, { track: truncate(`${r.track.artists[0]} - ${r.track.name}`, 30) });
    try {
      await addVideoToPlaylist(oauth2Client, ytPlaylistId, r.match.videoId);
      added++;
    } catch (e) {
      // Video might be unavailable/region locked; mark but continue
      r.addError = e.message;
    }
    await sleep(300);
  }

  addBar.update(toMigrate.length, { track: 'Done!' });
  addBar.stop();

  // ── Step 8: Print + save report ─────────────────────────────────────────────
  printReport(results, playlistName, ytPlaylistUrl);

  const reportPath = saveReport(results, playlistName, ytPlaylistUrl, process.cwd());
  console.log(chalk.green(`Report saved to: ${reportPath}\n`));
  console.log(chalk.bold.cyan(`YouTube playlist: ${ytPlaylistUrl}\n`));
}

function printBanner() {
  console.log(chalk.bold.green('\n  Spotify → YouTube Playlist Migrator'));
  console.log(chalk.gray('  ────────────────────────────────────\n'));
}

function validateEnv() {
  const required = [
    'SPOTIFY_CLIENT_ID',
    'SPOTIFY_CLIENT_SECRET',
    'YOUTUBE_CLIENT_ID',
    'YOUTUBE_CLIENT_SECRET',
  ];

  const missing = required.filter((k) => !process.env[k]);
  if (missing.length > 0) {
    console.error(chalk.red('Missing required environment variables:'));
    for (const k of missing) {
      console.error(chalk.red(`  - ${k}`));
    }
    console.error(chalk.yellow('\nCopy .env.example to .env and fill in your credentials.'));
    console.error(chalk.yellow('See instructions in the README for obtaining API credentials.\n'));
    process.exit(1);
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function truncate(str, len) {
  return str.length > len ? str.slice(0, len - 1) + '…' : str;
}

main().catch((e) => {
  console.error(chalk.red('\nUnexpected error: ' + e.message));
  if (process.env.DEBUG) console.error(e.stack);
  process.exit(1);
});
