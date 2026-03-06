import http from 'http';
import { URL } from 'url';
import open from 'open';
import chalk from 'chalk';
import axios from 'axios';

const SCOPES = 'playlist-read-private playlist-read-collaborative';
const AUTH_URL = 'https://accounts.spotify.com/authorize';
const TOKEN_URL = 'https://accounts.spotify.com/api/token';
const API_BASE = 'https://api.spotify.com/v1';

export function createSpotifyClient(clientId, clientSecret, redirectUri) {
  return { clientId, clientSecret, redirectUri, accessToken: null };
}

export async function authenticateSpotify(client) {
  const params = new URLSearchParams({
    client_id: client.clientId,
    response_type: 'code',
    redirect_uri: client.redirectUri,
    scope: SCOPES,
  });
  const authUrl = `${AUTH_URL}?${params}`;

  console.log(chalk.cyan('\n[Spotify] Opening browser for authentication...'));
  console.log(chalk.gray('If browser does not open, visit:\n') + chalk.underline(authUrl) + '\n');

  await open(authUrl);

  const code = await waitForCallback(client.redirectUri);

  // Exchange code for token
  const tokenRes = await axios.post(TOKEN_URL,
    new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: client.redirectUri,
    }),
    {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: 'Basic ' + Buffer.from(`${client.clientId}:${client.clientSecret}`).toString('base64'),
      },
    }
  );

  client.accessToken = tokenRes.data.access_token;

  // Verify token works
  try {
    const me = await axios.get(`${API_BASE}/me`, {
      headers: { Authorization: `Bearer ${client.accessToken}` },
    });
    console.log(chalk.green(`[Spotify] Authenticated as: ${me.data.display_name || me.data.id}\n`));
  } catch (e) {
    if (e.response?.status === 403) {
      throw new Error(
        'Spotify returned 403. Your app does not have Web API access.\n' +
        '  Fix: Go to developer.spotify.com/dashboard → your app → Settings\n' +
        '  → "Which API/SDKs are you planning to use?" → check "Web API" → Save.'
      );
    }
    throw e;
  }
  return client;
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
      res.end('<html><body><h2>Spotify authentication successful! You can close this tab.</h2></body></html>');
      server.close();

      if (error) reject(new Error(`Spotify auth error: ${error}`));
      else resolve(code);
    });

    server.listen(port, '127.0.0.1', () => {});
    server.on('error', reject);
  });
}

async function spotifyGet(client, path) {
  const res = await axios.get(`${API_BASE}${path}`, {
    headers: { Authorization: `Bearer ${client.accessToken}` },
  });
  return res.data;
}

export async function getPlaylistTracks(client, playlistId) {
  const playlist = await spotifyGet(client, `/playlists/${playlistId}`);
  const playlistName = playlist.name;
  const total = playlist.tracks.total;

  console.log(chalk.cyan(`[Spotify] Fetching "${playlistName}" (${total} tracks)...`));

  const tracks = [];
  let offset = 0;
  const limit = 50;

  while (offset < total) {
    const page = await spotifyGet(client, `/playlists/${playlistId}/tracks?offset=${offset}&limit=${limit}`);

    for (const item of page.items) {
      if (!item.track || !item.track.id) continue;
      const t = item.track;
      tracks.push({
        id: t.id,
        name: t.name,
        artists: (t.artists || []).map((a) => a.name),
        album: t.album?.name || '',
        duration_ms: t.duration_ms,
        isrc: t.external_ids?.isrc || null,
        popularity: t.popularity,
      });
    }

    offset += limit;
  }

  return { playlistName, tracks };
}

export function extractPlaylistId(input) {
  const urlMatch = input.match(/playlist\/([a-zA-Z0-9]+)/);
  if (urlMatch) return urlMatch[1];
  if (/^[a-zA-Z0-9]+$/.test(input.trim())) return input.trim();
  throw new Error('Could not parse Spotify playlist ID from input: ' + input);
}
