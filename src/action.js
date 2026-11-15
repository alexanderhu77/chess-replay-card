'use strict';

const fs = require('fs');
const path = require('path');
const { fetchGame, gameLink } = require('./sources');
const { render } = require('./render');

const input = (name, fallback = '') => (process.env[`INPUT_${name.toUpperCase()}`] || fallback).trim();

async function main() {
  const platform = input('platform', 'lichess').toLowerCase();
  const username = input('username');
  const gameId = input('game_id');
  const variant = input('variant');
  const outDir = input('output_dir', 'dist');
  const speed = Number(input('speed', '1'));
  const maxMoves = Number(input('max_moves', '60'));

  const game = await fetchGame({ platform, username, gameId, variant });
  fs.mkdirSync(outDir, { recursive: true });
  for (const palette of ['light', 'dark']) {
    const name = palette === 'dark' ? 'chess-replay-dark.svg' : 'chess-replay.svg';
    const svg = render(game, { palette, speed, maxMoves, perspective: username });
    fs.writeFileSync(path.join(outDir, name), svg);
    console.log(`Wrote ${path.join(outDir, name)} (${(svg.length / 1024).toFixed(1)} KB)`);
  }
  console.log(`Replayed ${game.white.name} vs ${game.black.name} (${game.result}), ${game.moves.length} plies.`);

  // Hand the workflow a link to the game, so the card can be made clickable.
  const link = gameLink(game, username);
  if (link) {
    console.log(`Game link: ${link}`);
    if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `game_url=${link}\n`);
  }
}

main().catch((err) => {
  console.log(`::error::${err.message}`);
  process.exitCode = 1;
});
