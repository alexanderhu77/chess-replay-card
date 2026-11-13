'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { fromFEN, perft, replay, START_FEN } = require('../src/chess');

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
