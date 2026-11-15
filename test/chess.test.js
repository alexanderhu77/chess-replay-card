'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { fromFEN, legalMoves, perft, replay, sqIndex, START_FEN } = require('../src/chess');

test('perft: starting position', () => {
  assert.strictEqual(perft(fromFEN(START_FEN), 3), 8902);
});

test('perft: castling, pins and promotions (Kiwipete)', () => {
  const fen = 'r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1';
  assert.strictEqual(perft(fromFEN(fen), 3), 97862);
});

test('perft: en passant edge cases', () => {
  assert.strictEqual(perft(fromFEN('8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1'), 4), 43238);
});

test('replay tracks en passant captures and promotion', () => {
  const { plies } = replay(['e4', 'd5', 'e5', 'f5', 'exf6', 'g6', 'fxe7', 'Nf6', 'exf8=Q+']);
  assert.notStrictEqual(plies[4].captured, null, 'en passant captures the f5 pawn');
  const last = plies[plies.length - 1];
  assert.strictEqual(last.promotion.type, 'q');
  assert.ok(last.check);
});

test('replay rejects illegal moves with a clear message', () => {
  assert.throws(() => replay(['e4', 'e4']), /not legal/);
});

test('perft: crazyhouse drops', () => {
  const fen = 'r1bqkb1r/ppp2ppp/2n2n2/3pp3/4P3/2N2N2/PPPP1PPP/R1BQKB1R[Pn] w KQkq - 0 1';
  const pos = fromFEN(fen, 'crazyhouse');
  const drops = legalMoves(pos).filter((m) => m.drop);
  assert.strictEqual(drops.length, 28, 'a pawn can drop on any empty square of ranks 2 to 7');
  assert.strictEqual(perft(fromFEN(START_FEN, 'crazyhouse'), 4), 197281);
});

test('crazyhouse: captured pieces switch sides and can be dropped', () => {
  const moves = ['e4', 'd5', 'exd5', 'Qxd5', 'Nc3', 'Qe5+', 'Be2', 'P@d4', '@a3'];
  const { plies, final } = replay(moves, START_FEN, 'crazyhouse');
  assert.deepStrictEqual(plies[3].after.pockets.b, { p: 1, n: 0, b: 0, r: 0, q: 0 });
  assert.strictEqual(plies[7].drop.type, 'p');
  assert.strictEqual(final.board[sqIndex('d4')].color, 'b');
  assert.strictEqual(final.board[sqIndex('a3')].color, 'w');
  assert.strictEqual(final.pockets.w.p + final.pockets.b.p, 0);
  assert.throws(() => replay(['e4', 'N@f3'], START_FEN, 'crazyhouse'), /not legal/);
  assert.throws(() => replay(['e4', 'd5', 'exd5', 'Qxd5', 'Nc3', 'P@d4']), /not legal/, 'no drops in standard chess');
});

test('crazyhouse: a captured promoted piece goes back to the pocket as a pawn', () => {
  const pos = fromFEN('1n5k/P7/8/8/8/8/8/K7[] w - - 0 1', 'crazyhouse');
  const { final } = replay(['axb8=Q+', 'Kh7', 'Qg8+', 'Kxg8'], '1n5k/P7/8/8/8/8/8/K7[] w - - 0 1', 'crazyhouse');
  assert.strictEqual(pos.pockets.w.n, 0);
  assert.deepStrictEqual(final.pockets, { w: { p: 0, n: 1, b: 0, r: 0, q: 0 }, b: { p: 1, n: 0, b: 0, r: 0, q: 0 } });
});
