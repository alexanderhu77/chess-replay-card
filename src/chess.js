'use strict';

// A small, dependency-free chess move engine: enough to replay any legal game
// from SAN notation, including castling, en passant and promotion. It also
// knows the crazyhouse variant, where captured pieces change sides and can be
// dropped back onto the board ("N@f3").

const FILES = 'abcdefgh';
const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

const KNIGHT = [[1, 2], [2, 1], [2, -1], [1, -2], [-1, -2], [-2, -1], [-2, 1], [-1, 2]];
const KING = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];
const DIAG = [[1, 1], [1, -1], [-1, 1], [-1, -1]];
const ORTH = [[1, 0], [-1, 0], [0, 1], [0, -1]];

const at = (f, r) => (f >= 0 && f < 8 && r >= 0 && r < 8 ? r * 8 + f : -1);
const sqName = (i) => FILES[i & 7] + ((i >> 3) + 1);
const sqIndex = (s) => FILES.indexOf(s[0]) + (parseInt(s[1], 10) - 1) * 8;
const other = (c) => (c === 'w' ? 'b' : 'w');
const POCKET_TYPES = 'pnbrq';
const emptyPocket = () => ({ p: 0, n: 0, b: 0, r: 0, q: 0 });

/**
 * Reads a FEN. For crazyhouse, pockets may follow the placement in brackets
 * ("...RNBQKBNR[Qn] w ...") and "~" marks a promoted piece.
 */
function fromFEN(fen, variant = 'standard') {
  const [placementField, turn, castle, ep] = fen.trim().split(/\s+/);
  const [, placement, pocket] = placementField.match(/^([^[]*)(?:\[(.*)\])?$/);
  const pos = { board: new Array(64).fill(null), turn: turn || 'w', castling: {}, ep: -1, nextId: 0, variant, pockets: null };
  if (variant === 'crazyhouse') {
    pos.pockets = { w: emptyPocket(), b: emptyPocket() };
    for (const ch of (pocket || '').replace(/-/g, '')) pos.pockets[ch === ch.toUpperCase() ? 'w' : 'b'][ch.toLowerCase()]++;
  }
  placement.split('/').slice(0, 8).forEach((row, i) => {
    const rank = 7 - i;
    let file = 0;
    for (const ch of row) {
      if (/\d/.test(ch)) { file += Number(ch); continue; }
      if (ch === '~') { pos.board[rank * 8 + file - 1].promoted = true; continue; }
      const color = ch === ch.toUpperCase() ? 'w' : 'b';
      pos.board[rank * 8 + file] = { type: ch.toLowerCase(), color, id: pos.nextId++ };
      file++;
    }
  });
  for (const k of 'KQkq') pos.castling[k] = Boolean(castle && castle.includes(k));
  pos.ep = ep && ep !== '-' ? sqIndex(ep) : -1;
  return pos;
}

function clone(pos) {
  return {
    // Piece objects are never modified once created, so positions can share them.
    board: pos.board.slice(),
    turn: pos.turn,
    castling: { ...pos.castling },
    ep: pos.ep,
    nextId: pos.nextId,
    variant: pos.variant,
    pockets: pos.pockets ? { w: { ...pos.pockets.w }, b: { ...pos.pockets.b } } : null,
  };
}

function attacked(board, sq, by) {
  const f = sq & 7;
  const r = sq >> 3;
  const is = (s, types) => s >= 0 && board[s] && board[s].color === by && types.includes(board[s].type);
  const pawnRank = by === 'w' ? r - 1 : r + 1;
  if (is(at(f - 1, pawnRank), 'p') || is(at(f + 1, pawnRank), 'p')) return true;
  for (const [df, dr] of KNIGHT) if (is(at(f + df, r + dr), 'n')) return true;
  for (const [df, dr] of KING) if (is(at(f + df, r + dr), 'k')) return true;
  for (const [dirs, types] of [[DIAG, 'bq'], [ORTH, 'rq']]) {
    for (const [df, dr] of dirs) {
      for (let ff = f + df, rr = r + dr; ; ff += df, rr += dr) {
        const s = at(ff, rr);
        if (s < 0) break;
        if (board[s]) { if (is(s, types)) return true; break; }
      }
    }
  }
  return false;
}

function pseudoMoves(pos) {
  const { board, turn } = pos;
  const opp = other(turn);
  const moves = [];
  for (let sq = 0; sq < 64; sq++) {
    const p = board[sq];
    if (!p || p.color !== turn) continue;
    const f = sq & 7;
    const r = sq >> 3;
    const add = (to, extra = {}) => moves.push({ from: sq, to, piece: p.type, ...extra });

    if (p.type === 'p') {
      const dir = turn === 'w' ? 1 : -1;
      const lastRank = turn === 'w' ? 7 : 0;
      const addPawn = (to, extra = {}) => {
        if (to >> 3 === lastRank) for (const promo of 'qrbn') add(to, { ...extra, promo });
        else add(to, extra);
      };
      const one = at(f, r + dir);
      if (one >= 0 && !board[one]) {
        addPawn(one);
        const two = at(f, r + 2 * dir);
        if (r === (turn === 'w' ? 1 : 6) && !board[two]) add(two, { double: true });
      }
      for (const df of [-1, 1]) {
        const t = at(f + df, r + dir);
        if (t < 0) continue;
        if (board[t] && board[t].color === opp) addPawn(t, { capture: t });
        else if (t === pos.ep) add(t, { capture: at(f + df, r), ep: true });
      }
    } else if (p.type === 'n' || p.type === 'k') {
      for (const [df, dr] of p.type === 'n' ? KNIGHT : KING) {
        const t = at(f + df, r + dr);
        if (t < 0) continue;
        if (!board[t]) add(t);
        else if (board[t].color === opp) add(t, { capture: t });
      }
      const home = turn === 'w' ? 0 : 56;
      if (p.type === 'k' && sq === home + 4 && !attacked(board, sq, opp)) {
        const rookAt = (s) => board[s] && board[s].type === 'r' && board[s].color === turn;
        const [kSide, qSide] = turn === 'w' ? ['K', 'Q'] : ['k', 'q'];
        if (pos.castling[kSide] && rookAt(home + 7) && !board[home + 5] && !board[home + 6] &&
            !attacked(board, home + 5, opp) && !attacked(board, home + 6, opp)) {
          add(home + 6, { castle: 'K', rookFrom: home + 7, rookTo: home + 5 });
        }
        if (pos.castling[qSide] && rookAt(home) && !board[home + 1] && !board[home + 2] && !board[home + 3] &&
            !attacked(board, home + 3, opp) && !attacked(board, home + 2, opp)) {
          add(home + 2, { castle: 'Q', rookFrom: home, rookTo: home + 3 });
        }
      }
    } else {
      const dirs = p.type === 'b' ? DIAG : p.type === 'r' ? ORTH : DIAG.concat(ORTH);
      for (const [df, dr] of dirs) {
        for (let ff = f + df, rr = r + dr; ; ff += df, rr += dr) {
          const t = at(ff, rr);
          if (t < 0) break;
          if (!board[t]) { add(t); continue; }
          if (board[t].color === opp) add(t, { capture: t });
          break;
        }
      }
    }
  }
  if (pos.pockets) {
    // Crazyhouse drops: any pocket piece onto any empty square, except pawns on the back ranks.
    for (const type of POCKET_TYPES) {
      if (!pos.pockets[turn][type]) continue;
      for (let sq = type === 'p' ? 8 : 0; sq < (type === 'p' ? 56 : 64); sq++) {
        if (!board[sq]) moves.push({ from: -1, to: sq, piece: type, drop: true });
      }
    }
  }
  return moves;
}

function makeMove(pos, m) {
  const next = clone(pos);
  const b = next.board;
  if (m.drop) {
    next.pockets[pos.turn][m.piece]--;
    b[m.to] = { type: m.piece, color: pos.turn, id: next.nextId++ };
    next.ep = -1;
    next.turn = other(pos.turn);
    return next;
  }
  const piece = b[m.from];
  if (m.capture !== undefined) {
    // In crazyhouse the capturer pockets the piece; promoted pieces revert to pawns.
    const taken = b[m.capture];
    if (next.pockets && taken.type !== 'k') next.pockets[pos.turn][taken.promoted ? 'p' : taken.type]++;
    b[m.capture] = null;
  }
  b[m.to] = piece;
  b[m.from] = null;
  if (m.castle) { b[m.rookTo] = b[m.rookFrom]; b[m.rookFrom] = null; }
  if (m.promo) b[m.to] = { type: m.promo, color: piece.color, id: next.nextId++, promoted: true };
  if (piece.type === 'k') {
    if (piece.color === 'w') next.castling.K = next.castling.Q = false;
    else next.castling.k = next.castling.q = false;
  }
  for (const [s, k] of [[0, 'Q'], [7, 'K'], [56, 'q'], [63, 'k']]) {
    if (m.from === s || m.to === s) next.castling[k] = false;
  }
  next.ep = m.double ? (m.from + m.to) / 2 : -1;
  next.turn = other(pos.turn);
  return next;
}

const kingSquare = (board, color) => board.findIndex((p) => p && p.type === 'k' && p.color === color);

function inCheck(pos) {
  const k = kingSquare(pos.board, pos.turn);
  return k >= 0 && attacked(pos.board, k, other(pos.turn));
}

/** A pseudo-legal move is legal if it does not leave the mover's own king attacked. */
function isLegal(pos, m) {
  const next = makeMove(pos, m);
  return !attacked(next.board, kingSquare(next.board, pos.turn), next.turn);
}

function legalMoves(pos) {
  return pseudoMoves(pos).filter((m) => isLegal(pos, m));
}

/** Stops at the first legal move found, which is all that telling mate from check needs. */
const hasLegalMove = (pos) => pseudoMoves(pos).some((m) => isLegal(pos, m));

/** Finds the legal move that a SAN string such as "Nbd7", "exd6", "e8=Q+" or the drop "N@f3" describes. */
function moveFromSan(pos, san) {
  const clean = san.replace(/[+#!?]+$/, '').replace(/0/g, 'O');
  // Match the notation first and test legality only for the few moves that fit it.
  const moves = pseudoMoves(pos);
  if (clean === 'O-O' || clean === 'O-O-O') {
    const m = moves.find((x) => x.castle === (clean === 'O-O' ? 'K' : 'Q') && isLegal(pos, x));
    if (!m) throw new Error(`Castling "${san}" is not legal here`);
    return m;
  }
  const dropMt = clean.match(/^([PNBRQ])?@([a-h][1-8])$/);
  if (dropMt) {
    const type = (dropMt[1] || 'P').toLowerCase();
    const m = moves.find((x) => x.drop && x.piece === type && x.to === sqIndex(dropMt[2]) && isLegal(pos, x));
    if (!m) throw new Error(`The drop "${san}" is not legal here`);
    return m;
  }
  const mt = clean.match(/^([NBRQK])?([a-h])?([1-8])?x?([a-h][1-8])(?:=?([NBRQnbrq]))?$/);
  if (!mt) throw new Error(`Cannot read the move "${san}"`);
  const [, pc, ff, fr, to, promo] = mt;
  const type = pc ? pc.toLowerCase() : 'p';
  const toSq = sqIndex(to);
  const want = promo ? promo.toLowerCase() : null;
  const found = moves.filter((m) =>
    !m.drop && m.piece === type && m.to === toSq &&
    (!ff || (m.from & 7) === FILES.indexOf(ff)) &&
    (!fr || m.from >> 3 === Number(fr) - 1) &&
    (m.promo || null) === want &&
    isLegal(pos, m)
  );
  if (found.length !== 1) throw new Error(`The move "${san}" is ${found.length ? 'ambiguous' : 'not legal'} here`);
  return found[0];
}

/**
 * Replays a list of SAN moves and describes what happened on each ply,
 * in terms of stable piece ids that the renderer can animate.
 */
function replay(sanMoves, fen = START_FEN, variant = 'standard') {
  let pos = fromFEN(fen, variant);
  const initial = pos;
  const plies = [];
  sanMoves.forEach((san, i) => {
    const m = moveFromSan(pos, san);
    const next = makeMove(pos, m);
    const moved = m.drop ? [] : [{ id: pos.board[m.from].id, from: m.from, to: m.to }];
    const drop = m.drop ? { id: next.board[m.to].id, type: m.piece, color: pos.turn, square: m.to } : null;
    if (m.castle) moved.push({ id: pos.board[m.rookFrom].id, from: m.rookFrom, to: m.rookTo });
    const captured = m.capture !== undefined ? pos.board[m.capture].id : null;
    const promotion = m.promo
      ? { pawnId: pos.board[m.from].id, id: next.board[m.to].id, type: m.promo, color: pos.turn, square: m.to }
      : null;
    const check = inCheck(next);
    const mate = check && !hasLegalMove(next);
    plies.push({
      index: i,
      san,
      color: pos.turn,
      moveNumber: Math.floor(i / 2) + 1,
      from: m.from,
      to: m.to,
      moved,
      captured,
      promotion,
      drop,
      check,
      mate,
      checkedKing: check ? kingSquare(next.board, next.turn) : -1,
      before: pos,
      after: next,
    });
    pos = next;
  });
  return { initial, plies, final: pos };
}

/** Counts leaf nodes to a given depth; used to verify move generation. */
function perft(pos, depth) {
  if (depth === 0) return 1;
  let n = 0;
  for (const m of legalMoves(pos)) n += perft(makeMove(pos, m), depth - 1);
  return n;
}

module.exports = { START_FEN, POCKET_TYPES, fromFEN, legalMoves, makeMove, moveFromSan, replay, perft, inCheck, sqName, sqIndex };
