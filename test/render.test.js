'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { render } = require('../src/render');
const { demoGame } = require('../src/demo');
const { parsePgn } = require('../src/pgn');
const { normalizeLichess, openingFromEcoUrl } = require('../src/sources');

test('renders the Opera Game ending in checkmate', () => {
  const svg = render(demoGame(), { palette: 'dark', perspective: 'Paul Morphy' });
  assert.match(svg, /^<svg[\s\S]*<\/svg>$/);
  assert.match(svg, /CHECKMATE/);
  assert.match(svg, /17\. Rd8#/);
});

test('flips the board when the user played black', () => {
  const game = demoGame();
  const normal = render(game, { perspective: game.white.name });
  const flipped = render(game, { perspective: game.black.name });
  assert.notStrictEqual(normal, flipped);
  assert.match(flipped, />h<\/text>/);
});

test('max_moves trims long games to the last moves', () => {
  const svg = render(demoGame(), { maxMoves: 5 });
  assert.match(svg, /Last 5 of 17 moves/);
});

test('parsePgn strips comments, clocks, variations and results', () => {
  const { moves } = parsePgn('[Result "*"]\n1. e4 {[%clk 0:03:00]} 1... e5 (1... c5 2. Nf3) 2. Nf3 $1 Nc6 *');
  assert.deepStrictEqual(moves, ['e4', 'e5', 'Nf3', 'Nc6']);
});

test('normalizes a Lichess game', () => {
  const g = normalizeLichess({
    id: 'abc12345', speed: 'blitz', status: 'resign', winner: 'black', createdAt: 1700000000000,
    players: { white: { user: { name: 'alice' }, rating: 1500 }, black: { user: { name: 'bob' }, rating: 1600 } },
    opening: { name: 'Italian Game' }, clock: { initial: 180, increment: 2 }, moves: 'e4 e5 Nf3',
  });
  assert.strictEqual(g.result, '0-1');
  assert.strictEqual(g.ending, 'Black won by resignation');
  assert.strictEqual(g.clock, '3+2');
  assert.deepStrictEqual(g.moves, ['e4', 'e5', 'Nf3']);
});

test('reads opening names from Chess.com ECO urls', () => {
  assert.strictEqual(
    openingFromEcoUrl('https://www.chess.com/openings/Sicilian-Defense-Old-Sicilian-Variation-3.Nf3'),
    'Sicilian Defense Old Sicilian Variation'
  );
});

test('renders a Lichess crazyhouse game with drops and pockets', () => {
  const game = normalizeLichess({
    id: 'zh123456', variant: 'crazyhouse', speed: 'blitz', status: 'resign', winner: 'white', createdAt: 1700000000000,
    players: { white: { user: { name: 'alice' }, rating: 1500 }, black: { user: { name: 'bob' }, rating: 1600 } },
    clock: { initial: 180, increment: 0 },
    moves: 'e4 e5 Nf3 Nc6 Bc4 Nf6 Ng5 d5 exd5 Nxd5 Nxf7 Kxf7 Qf3+ Ke6 P@f7 Nce7 Qe4',
  });
  assert.strictEqual(game.variant, 'crazyhouse');
  const svg = render(game, { perspective: 'alice' });
  assert.match(svg, /Crazyhouse Blitz 3\+0/);
  assert.match(svg, /8\. P@f7/);
  assert.match(svg, /@keyframes zwp1/, 'the white pawn pocket is animated');
});
