import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const fuzzball = require('fuzzball');

// Confidence thresholds
export const CONFIDENCE = {
  HIGH: 'HIGH',
  MEDIUM: 'MEDIUM',
  LOW: 'LOW',
  NOT_FOUND: 'NOT_FOUND',
};

const DURATION_TOLERANCE_HIGH = 5000;   // within 5s
const DURATION_TOLERANCE_MED  = 15000;  // within 15s

const OFFICIAL_CHANNEL_PATTERNS = [
  /vevo$/i,
  /official/i,
  /- topic$/i,
];

/**
 * Build YouTube search queries for a Spotify track.
 * Returns an array of queries ordered by specificity.
 */
export function buildSearchQueries(track) {
  const primaryArtist = track.artists[0];
  const queries = [
    `${primaryArtist} - ${track.name} official audio`,
    `${primaryArtist} ${track.name}`,
    `${track.name} ${primaryArtist}`,
  ];
  return queries;
}

/**
 * Score a YouTube search result against a Spotify track.
 * Returns { score: 0-100, confidence, reasons }
 */
export function scoreResult(track, ytResult) {
  const reasons = [];
  let score = 0;

  const trackTitle = track.name.toLowerCase();
  const trackArtist = track.artists.join(' ').toLowerCase();
  const ytTitle = (ytResult.snippet?.title || '').toLowerCase();
  const ytChannel = (ytResult.snippet?.channelTitle || '').toLowerCase();

  // --- Title similarity (0-40 pts) ---
  const titleScore = fuzzball.token_sort_ratio(trackTitle, ytTitle) * 0.4;
  score += titleScore;
  reasons.push(`title_sim=${Math.round(titleScore * 10 / 4)}%`);

  // --- Artist / channel match (0-30 pts) ---
  const artistVsTitle = fuzzball.partial_ratio(trackArtist, ytTitle) * 0.2;
  const artistVsChannel = fuzzball.partial_ratio(trackArtist, ytChannel) * 0.1;
  score += artistVsTitle + artistVsChannel;
  reasons.push(`artist_sim=${Math.round((artistVsTitle + artistVsChannel) * 10 / 3)}%`);

  // --- Official channel bonus (0-15 pts) ---
  const isOfficial = OFFICIAL_CHANNEL_PATTERNS.some((p) => p.test(ytChannel) || p.test(ytTitle));
  if (isOfficial) {
    score += 15;
    reasons.push('official_channel');
  }

  // --- Duration match (0-15 pts) ---
  if (track.duration_ms && ytResult.contentDetails?.duration) {
    const ytDurationMs = parseIsoDuration(ytResult.contentDetails.duration);
    const delta = Math.abs(track.duration_ms - ytDurationMs);
    if (delta <= DURATION_TOLERANCE_HIGH) {
      score += 15;
      reasons.push('duration_exact');
    } else if (delta <= DURATION_TOLERANCE_MED) {
      score += 7;
      reasons.push('duration_close');
    } else {
      reasons.push('duration_mismatch');
    }
  }

  // Clamp
  score = Math.min(100, Math.round(score));

  let confidence;
  if (score >= 70) confidence = CONFIDENCE.HIGH;
  else if (score >= 45) confidence = CONFIDENCE.MEDIUM;
  else if (score >= 20) confidence = CONFIDENCE.LOW;
  else confidence = CONFIDENCE.NOT_FOUND;

  return { score, confidence, reasons };
}

/**
 * Pick the best result from a list of YouTube search results.
 * Returns { videoId, title, channelTitle, score, confidence, reasons } or null.
 */
export function pickBestMatch(track, ytResults) {
  if (!ytResults || ytResults.length === 0) {
    return { confidence: CONFIDENCE.NOT_FOUND, score: 0, reasons: ['no_results'] };
  }

  let best = null;

  for (const result of ytResults) {
    const videoId = result.id?.videoId;
    if (!videoId) continue;

    const { score, confidence, reasons } = scoreResult(track, result);

    if (!best || score > best.score) {
      best = {
        videoId,
        title: result.snippet?.title,
        channelTitle: result.snippet?.channelTitle,
        score,
        confidence,
        reasons,
        url: `https://www.youtube.com/watch?v=${videoId}`,
      };
    }
  }

  return best || { confidence: CONFIDENCE.NOT_FOUND, score: 0, reasons: ['no_video_ids'] };
}

/**
 * Parse ISO 8601 duration (PT4M13S) to milliseconds.
 */
function parseIsoDuration(iso) {
  const match = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!match) return 0;
  const h = parseInt(match[1] || '0');
  const m = parseInt(match[2] || '0');
  const s = parseInt(match[3] || '0');
  return (h * 3600 + m * 60 + s) * 1000;
}
