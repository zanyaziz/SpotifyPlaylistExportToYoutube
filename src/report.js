import chalk from 'chalk';
import fs from 'fs';
import path from 'path';
import { CONFIDENCE } from './matcher.js';

const CONFIDENCE_COLORS = {
  [CONFIDENCE.HIGH]: chalk.green,
  [CONFIDENCE.MEDIUM]: chalk.yellow,
  [CONFIDENCE.LOW]: chalk.red,
  [CONFIDENCE.NOT_FOUND]: chalk.gray,
};

const CONFIDENCE_ICONS = {
  [CONFIDENCE.HIGH]: '✓',
  [CONFIDENCE.MEDIUM]: '~',
  [CONFIDENCE.LOW]: '?',
  [CONFIDENCE.NOT_FOUND]: '✗',
};

export function printReport(results, playlistName, youtubePlaylistUrl) {
  const migrated = results.filter((r) => r.confidence === CONFIDENCE.HIGH || r.confidence === CONFIDENCE.MEDIUM);
  const flagged = results.filter((r) => r.confidence === CONFIDENCE.LOW || r.confidence === CONFIDENCE.NOT_FOUND);

  console.log('\n' + chalk.bold('═'.repeat(60)));
  console.log(chalk.bold.white(' Migration Report: ') + chalk.cyan(playlistName));
  console.log(chalk.bold('═'.repeat(60)));

  if (youtubePlaylistUrl) {
    console.log(chalk.bold('\nYouTube Playlist: ') + chalk.underline.cyan(youtubePlaylistUrl));
  }

  console.log(chalk.bold(`\nTotal tracks: ${results.length}`));
  console.log(chalk.green(`  Migrated (HIGH):   ${results.filter((r) => r.confidence === CONFIDENCE.HIGH).length}`));
  console.log(chalk.yellow(`  Migrated (MEDIUM): ${results.filter((r) => r.confidence === CONFIDENCE.MEDIUM).length}`));
  console.log(chalk.red(`  Flagged (LOW):     ${results.filter((r) => r.confidence === CONFIDENCE.LOW).length}`));
  console.log(chalk.gray(`  Not found:         ${results.filter((r) => r.confidence === CONFIDENCE.NOT_FOUND).length}`));

  if (migrated.length > 0) {
    console.log(chalk.bold('\n--- Successfully Migrated ---'));
    for (const r of migrated) {
      const color = CONFIDENCE_COLORS[r.confidence];
      const icon = CONFIDENCE_ICONS[r.confidence];
      const tag = `[${r.confidence.padEnd(6)}]`;
      const trackLabel = `${r.track.artists[0]} - ${r.track.name}`;
      console.log(
        color(`  ${icon} ${tag} `) +
        chalk.white(truncate(trackLabel, 45)) +
        chalk.gray(`  → `) +
        chalk.cyan(r.match?.url || '')
      );
    }
  }

  if (flagged.length > 0) {
    console.log(chalk.bold('\n--- Needs Manual Review ---'));
    for (const r of flagged) {
      const color = CONFIDENCE_COLORS[r.confidence];
      const icon = CONFIDENCE_ICONS[r.confidence];
      const tag = `[${r.confidence.padEnd(9)}]`;
      const trackLabel = `${r.track.artists[0]} - ${r.track.name}`;
      const matchInfo = r.match?.url ? chalk.gray(`  (best guess: ${r.match.url})`) : '';
      console.log(color(`  ${icon} ${tag} `) + chalk.white(truncate(trackLabel, 45)) + matchInfo);
    }
  }

  console.log(chalk.bold('\n' + '═'.repeat(60) + '\n'));
}

export function saveReport(results, playlistName, youtubePlaylistUrl, outputDir = '.') {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const safeName = playlistName.replace(/[^a-z0-9]/gi, '_').toLowerCase();
  const filename = `migration_${safeName}_${timestamp}.json`;
  const filepath = path.join(outputDir, filename);

  const report = {
    generatedAt: new Date().toISOString(),
    playlistName,
    youtubePlaylistUrl,
    summary: {
      total: results.length,
      high: results.filter((r) => r.confidence === CONFIDENCE.HIGH).length,
      medium: results.filter((r) => r.confidence === CONFIDENCE.MEDIUM).length,
      low: results.filter((r) => r.confidence === CONFIDENCE.LOW).length,
      not_found: results.filter((r) => r.confidence === CONFIDENCE.NOT_FOUND).length,
    },
    tracks: results.map((r) => ({
      spotify: {
        id: r.track.id,
        name: r.track.name,
        artists: r.track.artists,
        album: r.track.album,
        isrc: r.track.isrc,
        duration_ms: r.track.duration_ms,
      },
      match: r.match
        ? {
            videoId: r.match.videoId,
            title: r.match.title,
            channel: r.match.channelTitle,
            url: r.match.url,
            score: r.match.score,
            confidence: r.confidence,
            reasons: r.match.reasons,
          }
        : null,
      confidence: r.confidence,
    })),
  };

  fs.writeFileSync(filepath, JSON.stringify(report, null, 2));
  return filepath;
}

function truncate(str, len) {
  return str.length > len ? str.slice(0, len - 1) + '…' : str.padEnd(len);
}
