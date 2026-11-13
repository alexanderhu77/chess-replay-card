#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { render } = require('./src/render');
const { fetchGame } = require('./src/sources');
const { demoGame } = require('./src/demo');

const HELP = `chess-replay-card: turn your latest chess game into an animated SVG replay

Usage:
  chess-replay-card --user <name> [--platform lichess|chesscom] [options]
  chess-replay-card --game <lichess-game-id> [options]
  chess-replay-card --demo [options]

Options:
  --user <name>        Your Lichess or Chess.com username
  --platform <name>    lichess (default) or chesscom
  --game <id>          A specific Lichess game id instead of your latest game
  --demo               Render the famous 1858 "Opera Game" (no network needed)
  --out <dir>          Output directory (default: dist)
  --speed <n>          Animation speed multiplier, 0.25 to 4 (default: 1)
  --max-moves <n>      Only replay the last n moves of long games (default: 60)
  -h, --help           Show this help`;

function parseArgs(argv) {
  const args = { out: 'dist', platform: 'lichess', speed: 1, 'max-moves': 60 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-h' || a === '--help') args.help = true;
    else if (a === '--demo') args.demo = true;
    else if (a.startsWith('--')) args[a.slice(2)] = argv[++i];
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || (!args.user && !args.game && !args.demo)) {
    console.log(HELP);
    return;
  }
  const game = args.demo
    ? demoGame()
    : await fetchGame({ platform: args.platform, username: args.user, gameId: args.game });
  const perspective = args.demo ? game.white.name : args.user;

  fs.mkdirSync(args.out, { recursive: true });
  for (const palette of ['light', 'dark']) {
    const name = palette === 'dark' ? 'chess-replay-dark.svg' : 'chess-replay.svg';
    const svg = render(game, { palette, speed: args.speed, maxMoves: args['max-moves'], perspective });
    fs.writeFileSync(path.join(args.out, name), svg);
    console.log(`Wrote ${path.join(args.out, name)} (${(svg.length / 1024).toFixed(1)} KB)`);
  }
}

main().catch((err) => {
  console.error(`Error: ${err.message}`);
  process.exitCode = 1;
});
