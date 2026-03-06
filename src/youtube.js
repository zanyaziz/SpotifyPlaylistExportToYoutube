import { google } from 'googleapis';
import http from 'http';
import { URL } from 'url';
import open from 'open';
import chalk from 'chalk';
import { buildSearchQueries, pickBestMatch, CONFIDENCE } from './matcher.js';

const SCOPES = [
  'https://www.googleapis.com/auth/youtube',
  'https://www.googleapis.com/auth/youtube.force-ssl',
];

// YouTube Data API v3 quota costs:
// search.list = 100 units, playlistItems.insert = 50, playlists.insert = 50
// Free quota = 10,000 units/day

export function createOAuthClient(clientId, clientSecret, redirectUri) {
  return new google.auth.OAuth2(clientId, clientSecret, redirectUri);
}

export async function authenticateYouTube(oauth2Client) {
  const authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
  });

  console.log(chalk.cyan('\n[YouTube] Opening browser for authentication...'));
  console.log(chalk.gray('If browser does not open, visit:\n') + chalk.underline(authUrl) + '\n');

  await open(authUrl);

  const redirectUri = oauth2Client._redirectUri || oauth2Client.redirectUri;
  const code = await waitForCallback(redirectUri);
  const { tokens } = await oauth2Client.getToken(code);
  oauth2Client.setCredentials(tokens);

  console.log(chalk.green('[YouTube] Authenticated successfully.\n'));
  return oauth2Client;
}

function waitForCallback(redirectUri) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(redirectUri);
    const port = parseInt(parsed.port) || 80;
    const pathname = parsed.pathname;

    const server = http.createServer((req, res) => {
      const reqUrl = new URL(req.url, redirectUri);
      if (reqUrl.pathname !== pathname) return;

      const code = reqUrl.searchParams.get('code');
      const error = reqUrl.searchParams.get('error');

      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end('<html><body><h2>YouTube authentication successful! You can close this tab.</h2></body></html>');
      server.close();

      if (error) reject(new Error(`YouTube auth error: ${error}`));
      else resolve(code);
    });

    server.listen(port, '127.0.0.1', () => {});
    server.on('error', reject);
  });
}

export async function searchYouTube(oauth2Client, track) {
  const youtube = google.youtube({ version: 'v3', auth: oauth2Client });
  const queries = buildSearchQueries(track);

  let allResults = [];

  for (const q of queries) {
    try {
      const searchRes = await youtube.search.list({
        part: ['snippet'],
        q,
        type: ['video'],
        videoCategoryId: '10', // Music
        maxResults: 5,
      });

      const items = searchRes.data.items || [];
      if (items.length === 0) continue;

      // Fetch content details (duration) for the top results
      const videoIds = items.map((i) => i.id?.videoId).filter(Boolean);
      if (videoIds.length > 0) {
        const detailsRes = await youtube.videos.list({
          part: ['contentDetails'],
          id: videoIds,
        });
        const detailsMap = {};
        for (const v of detailsRes.data.items || []) {
          detailsMap[v.id] = v;
        }
        for (const item of items) {
          const vid = item.id?.videoId;
          if (vid && detailsMap[vid]) {
            item.contentDetails = detailsMap[vid].contentDetails;
          }
        }
      }

      allResults = allResults.concat(items);

      // If first query gives a HIGH confidence result, no need for more queries
      const best = pickBestMatch(track, allResults);
      if (best.confidence === CONFIDENCE.HIGH) break;
    } catch (err) {
      if (err.code === 403) {
        throw new Error('YouTube API quota exceeded. Try again tomorrow or request a quota increase.');
      }
      // For other errors on a single query, continue with next query
    }
  }

  return pickBestMatch(track, allResults);
}

export async function createPlaylist(oauth2Client, name, description = '') {
  const youtube = google.youtube({ version: 'v3', auth: oauth2Client });

  const res = await youtube.playlists.insert({
    part: ['snippet', 'status'],
    requestBody: {
      snippet: { title: name, description },
      status: { privacyStatus: 'private' },
    },
  });

  return res.data.id;
}

export async function addVideoToPlaylist(oauth2Client, playlistId, videoId) {
  const youtube = google.youtube({ version: 'v3', auth: oauth2Client });

  await youtube.playlistItems.insert({
    part: ['snippet'],
    requestBody: {
      snippet: {
        playlistId,
        resourceId: {
          kind: 'youtube#video',
          videoId,
        },
      },
    },
  });
}
