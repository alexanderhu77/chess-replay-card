'use strict';

const { replay, POCKET_TYPES } = require('./chess');
const { PIECES, FLAG, withOutline, bitmapPath } = require('./sprites');

const S = 32;          // square size
const PAD = 16;
const PANEL_GAP = 28;
const PANEL_W = 250;
const PX = 2;          // sprite pixel size
const SPRITE_DX = (S - 11 * PX) / 2;   // offset that centers a sprite in its square
const SPRITE_DY = (S - 12 * PX) / 2;
const NAME_SIZE = 14;                  // player names
const SCORE_SIZE = 15;                 // the 1, 0 or ½ at the end of each player's row
const KING_SCALE = 0.85;               // the king beside each name, relative to a board piece
const POCKET_SCALE = 0.75;             // crazyhouse pocket pieces, relative to a board piece
const POCKET_SLOT = 32;                // horizontal spacing of pocket pieces
const COUNT_SIZE = 10;                 // the number beside a pocket piece held more than once
const CLOCK_SIZE = 11;                 // each player's remaining time, beside their name
const DROP_BUMP = 1.22;                // how oversized a dropped piece is at the moment it lands
// How long the replay spends on each move. The three averages decide how long the whole replay
// lasts. When the game's clocks are known, each move is placed between the shortest and longest
// time along an S-shaped curve of how long it really took, so that the moves still add up to
// that total; otherwise each move simply gets its average.
const MOVE_SECONDS = 0.9;                  // average time for a move that captures, drops, checks or promotes
const MOVE_SECONDS_DEVIATION = 0.06;       // standard deviation of the random variation added to those moves
const LONGEST_MOVE_SECONDS = 1.4;          // the most time one of those moves can get
const QUIET_MOVE_SECONDS = 0.5;            // average time for any other move, a quiet one
const QUIET_MOVE_SECONDS_DEVIATION = 0.03; // standard deviation of the random variation added to quiet moves
const LONGEST_QUIET_MOVE_SECONDS = 0.7;    // the most time a quiet move can get
const CLOSING_MOVE_SECONDS = 1.1;          // average time for each of the last two moves, varied and capped like the first kind
const SHORTEST_MOVE_SECONDS = 0.38;        // no move of any kind gets less time than this (a piece needs about this long to finish sliding)
const THINKING_TIME_CONTRAST = 1.5;        // how sharply the curve tells quick moves from slow ones: lower spreads the times more evenly
// What the whole card does as the last move lands. Set any of the first three to 0 to leave it out.
const FLASH_STRENGTH = 0.42;           // how strongly the card flashes in the accent colour, from 0 to 1
const JOLT_PIXELS = 3;                 // how far the card jolts from side to side
const CONFETTI_PIECES = 48;            // how many pieces of confetti fall when the player the card is for has won
const CONFETTI_SECONDS = 1.7;          // how long a piece of confetti takes to fall past the card
// The winning side's pieces bounce from just after the last move until the board clears. Set the height to 0 to leave it out.
const BOUNCE_PIXELS = 8;               // how high each piece bounces
const BOUNCE_SECONDS = 0.4;            // one bounce: up, down and a moment on the ground
const BOUNCE_DELAY = 0.35;             // how long after the last move lands the first pieces start
const BOUNCE_SPREAD = 0.3;             // each piece starts at a random moment within this many seconds of the first
const INTRO_SPEED = 1.3;               // how many times faster than its original pace the opening sequence plays
const INTRO_PACE = { rollFrom: 0.2, rollTo: 1.2, rodsGone: 1.45, vsOut: 2.05, doorsFrom: 2.2, doorsTo: 2.85, rain: 2.85, gameStarts: 3.65 };
const INTRO = Object.fromEntries(Object.entries(INTRO_PACE).map(([step, seconds]) => [step, Number((seconds / INTRO_SPEED).toFixed(3))]));
INTRO.gameStarts = Number(((INTRO_PACE.gameStarts + 1) / INTRO_SPEED - 1).toFixed(3));   // the first move comes a second after the game starts

const PALETTES = {
  light: {
    bg: '#ffffff', lightSq: '#eef1f4', darkSq: '#b7c0ca', frame: '#d0d7de',
    whiteFill: '#ffffff', whiteLine: '#1f2328', blackFill: '#1f2328', blackLine: '#ffffff',
    move: '#2da44e', check: '#cf222e', text: '#1f2328', muted: '#656d76', accent: '#1a7f37',
    drop: '#218bff', gain: '#a475f9', gold: '#d4a72c', goldText: '#9a6700', wood: '#c49a5e', woodDark: '#7d5c2e', woodLight: '#ecd4a4',
  },
  dark: {
    bg: '#0d1117', lightSq: '#3b4450', darkSq: '#262c36', frame: '#30363d',
    whiteFill: '#f0f6fc', whiteLine: '#0d1117', blackFill: '#0d1117', blackLine: '#c9d1d9',
    move: '#2ea043', check: '#f85149', text: '#e6edf3', muted: '#8b949e', accent: '#3fb950',
    drop: '#388bfd', gain: '#a371f7', gold: '#d4a72c', goldText: '#d4a72c', wood: '#a8824c', woodDark: '#5f4523', woodLight: '#d2b07a',
  },
};

const num = (n) => Number(n.toFixed(3)).toString();

/**
 * Random numbers from 0 up to 1. They are seeded by a text, so the same game always gets the
 * same sequence and its card never changes.
 */
function uniformSampler(seed) {
  let state = 2166136261;
  for (const ch of seed) state = Math.imul(state ^ ch.charCodeAt(0), 16777619);
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), state | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Random numbers from a normal distribution (mean 0, standard deviation 1), seeded the same way. */
function normalSampler(seed) {
  const uniform = uniformSampler(seed);
  return () => Math.sqrt(-2 * Math.log(1 - uniform())) * Math.cos(2 * Math.PI * uniform());
}

/** How long each move really took, in seconds, from the clock readings taken after every move. */
function thinkingSeconds(clocks) {
  return clocks.afterMove.map((left, i) => {
    const before = i >= 2 ? clocks.afterMove[i - 2] + clocks.increment : clocks.start;
    return Math.max(0, before - left) / 100;
  });
}

/**
 * Stretches or shrinks `shares` by one common factor so that, with each kept between its own
 * shortest and longest value, they add up to `total`.
 */
function shareOut(shares, shortest, longest, total) {
  const fit = (factor) => shares.map((share, i) => Math.min(longest[i], Math.max(shortest[i], share * factor)));
  const sum = (list) => list.reduce((a, b) => a + b, 0);
  let [low, high] = [0, 1];
  while (sum(fit(high)) < total && high < 1e6) high *= 2;
  for (let n = 0; n < 50; n++) {
    const middle = (low + high) / 2;
    if (sum(fit(middle)) < total) low = middle;
    else high = middle;
  }
  return fit(high);
}

/**
 * Gives each move a time between its shortest and longest along an S-shaped curve of how long
 * it really took, measured on a logarithmic scale. The middle of the curve is placed so that
 * the times add up to `total`: quick moves land near the shortest, long thinks near the
 * longest, and few sit right on either.
 */
function spreadAlongCurve(thought, shortest, longest, total) {
  const effort = thought.map((seconds) => Math.log(seconds + 1));
  const along = (middle) => effort.map((x, i) => shortest[i] + (longest[i] - shortest[i]) / (1 + Math.exp(-THINKING_TIME_CONTRAST * (x - middle))));
  const sum = (list) => list.reduce((a, b) => a + b, 0);
  let [low, high] = [-20, 20];
  for (let n = 0; n < 60; n++) {
    const middle = (low + high) / 2;
    if (sum(along(middle)) > total) low = middle;
    else high = middle;
  }
  return along(high);
}

const clockText = (centiseconds) => {
  const sec = Math.max(0, Math.round(centiseconds / 100));
  const [h, m, s] = [Math.floor(sec / 3600), Math.floor(sec / 60) % 60, String(sec % 60).padStart(2, '0')];
  return h ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
};
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const trunc = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

const END_LABEL = {
  mate: 'CHECKMATE', resign: 'RESIGNATION', resigned: 'RESIGNATION', outoftime: 'TIME OUT', timeout: 'TIME OUT',
  stalemate: 'STALEMATE', draw: 'DRAW', agreed: 'DRAW', repetition: 'DRAW', insufficient: 'DRAW',
  '50move': 'DRAW', timevsinsufficient: 'DRAW', abandoned: 'ABANDONED',
};

/**
 * Renders an animated SVG replay of a game.
 * @param {object} game normalized game (see sources.js)
 * @param {{palette?: 'light'|'dark', speed?: number, maxMoves?: number, perspective?: string}} options
 */
function render(game, options = {}) {
  const pal = PALETTES[options.palette] || PALETTES.light;
  const speed = Math.max(0.25, Math.min(4, Number(options.speed) || 1));
  const maxPlies = Math.max(2, Math.round((Number(options.maxMoves) || 60) * 2));

  const { initial, plies } = replay(game.moves, undefined, game.variant || 'standard');
  const startPly = Math.max(0, plies.length - maxPlies);
  const shown = plies.slice(startPly);
  const startPos = startPly > 0 ? plies[startPly].before : initial;

  // Orientation: show the board from the perspective user's side.
  const me = (options.perspective || '').toLowerCase();
  const flipped = me && game.black.name.toLowerCase() === me;

  const sqX = (sq) => (flipped ? 7 - (sq & 7) : sq & 7) * S;
  const sqY = (sq) => (flipped ? sq >> 3 : 7 - (sq >> 3)) * S;
  const BX = PAD;
  const BY = PAD;
  const width = PAD + 8 * S + PANEL_GAP + PANEL_W + PAD;
  const height = PAD + 8 * S + PAD;
  const PX0 = PAD + 8 * S + PANEL_GAP;   // left edge of the side panel
  const topSide = flipped ? 'w' : 'b';
  const bottomSide = flipped ? 'b' : 'w';
  // Where a crazyhouse pocket piece is drawn in the side panel (page coordinates, at POCKET_SCALE).
  // Player rows hug the top and bottom edges of the board; each pocket sits just inside its row.
  const topNameY = BY + Math.round(12 * PX * KING_SCALE) - 2;   // text baseline of the top player's name
  const bottomNameY = BY + 8 * S - 4;
  const pocketTop = topNameY + 8;
  const pocketBottom = Math.round(bottomNameY + 1 - 12 * PX * KING_SCALE - 5 - 12 * PX * POCKET_SCALE);
  const pocketXY = (side, type) => [
    PX0 + POCKET_TYPES.indexOf(type) * POCKET_SLOT,
    side === topSide ? pocketTop : pocketBottom,
  ];

  // Timeline (seconds)
  const MOVE = Math.min(0.35, (QUIET_MOVE_SECONDS / speed) * 0.6);
  const quiet = (ply) => ply.captured === null && !ply.drop && !ply.check && !ply.promotion;
  const kinds = shown.map((ply, i) => {
    const closing = startPly + i >= plies.length - 2;
    const calm = quiet(ply) && !closing;
    return {
      average: closing ? CLOSING_MOVE_SECONDS : calm ? QUIET_MOVE_SECONDS : MOVE_SECONDS,
      deviation: calm ? QUIET_MOVE_SECONDS_DEVIATION : MOVE_SECONDS_DEVIATION,
      longest: calm ? LONGEST_QUIET_MOVE_SECONDS : LONGEST_MOVE_SECONDS,
    };
  });
  // Every move but the last decides how long the replay is, and that length is fixed by the
  // averages. Each move is placed along the curve by the time it really took, then varies a
  // little at random, and the total is restored exactly.
  const hasClocks = Boolean(game.clocks) && game.clocks.afterMove.length >= plies.length;
  const vary = normalSampler(game.moves.join(' '));
  const timed = kinds.slice(0, -1);
  const budget = timed.reduce((sum, kind) => sum + kind.average, 0);
  const limits = [timed.map(() => SHORTEST_MOVE_SECONDS), timed.map((kind) => kind.longest)];
  const thought = hasClocks ? thinkingSeconds(game.clocks).slice(startPly, startPly + timed.length) : [];
  const shared = thought.some((seconds) => seconds > 0) ? spreadAlongCurve(thought, ...limits, budget) : timed.map((kind) => kind.average);
  const paces = shareOut(shared.map((seconds, i) => Math.max(0.01, seconds + vary() * timed[i].deviation)), ...limits, budget);
  if (kinds.length) {
    const last = kinds[kinds.length - 1];
    paces.push(Math.min(last.longest, Math.max(SHORTEST_MOVE_SECONDS, last.average + vary() * last.deviation)));
  }
  const steps = paces.map((seconds) => Math.max(MOVE * 1.25, seconds / speed));
  // A captured crazyhouse piece flies to the capturer's pocket. It leaves its square halfway
  // through the capturing move and takes a quick flight, arriving just as the capturer lands.
  const FLY_WAIT = MOVE * 0.5;
  const FLY = MOVE * 0.55;
  const START = 1.0;
  const END_HOLD = 3.2;
  const times = [];
  steps.reduce((t, step) => { times.push(t); return t + step; }, START);
  const tPly = (i) => times[i];
  const lastT = shown.length ? tPly(shown.length - 1) + MOVE : START;
  const holdEnd = lastT + END_HOLD;
  const FADE = 0.75;
  const resetAt = holdEnd + FADE + 0.05;   // everything goes back to how the game started, ready for the next replay
  const D = holdEnd + FADE + 0.4;
  // At the end the board clears in eight waves, each a scattered handful of squares. `i` counts
  // the squares as drawn, from the top left, row by row.
  const clearWave = (i) => Math.floor(((i * 37 + 11) % 64) / 8);
  const clearsAt = (wave) => holdEnd + 0.05 + wave * 0.085;
  const pct = (sec) => num(Math.min(100, Math.max(0, (sec / D) * 100)));
  const dur = `${num(D)}s`;
  const loop = (name, timing) => `animation:${name} ${dur} ${timing} ${INTRO.gameStarts}s infinite backwards`;

  // Build per-piece tracks
  const flights = [];   // crazyhouse captures, flown to the capturer's pocket
  const tracks = new Map();
  startPos.board.forEach((p, sq) => {
    if (p) tracks.set(p.id, { ...p, sq0: sq, moves: [], appear: null, vanish: null, last: sq });
  });
  shown.forEach((ply, i) => {
    const t = tPly(i);
    for (const mv of ply.moved) {
      const tr = tracks.get(mv.id);
      tr.moves.push({ t, from: mv.from, to: mv.to });
      tr.last = mv.to;
    }
    if (ply.captured !== null) {
      const victim = tracks.get(ply.captured);
      if (startPos.pockets) {
        // Crazyhouse: the captured piece leaves its square and flies to the capturer's pocket.
        // The pocket tells us what it becomes there (a promoted piece turns back into a pawn).
        const [before, now] = [ply.before.pockets[ply.color], ply.after.pockets[ply.color]];
        const as = [...POCKET_TYPES].find((type) => now[type] > before[type]);
        flights.push({ t: t + FLY_WAIT, nextMove: t + steps[i], sq: victim.last, sprite: victim.type + victim.color, side: ply.color, as });
        victim.vanish = t + FLY_WAIT;
        victim.snap = true;
      } else {
        victim.vanish = t + MOVE;
      }
    }
    if (ply.drop) {
      const d = ply.drop;
      tracks.set(d.id, { type: d.type, color: d.color, id: d.id, sq0: d.square, moves: [], appear: t, vanish: null, last: d.square, drop: true });
    }
    if (ply.promotion) {
      const pr = ply.promotion;
      tracks.get(pr.pawnId).vanish = t + MOVE;
      tracks.set(pr.id, { type: pr.type, color: pr.color, id: pr.id, sq0: pr.square, moves: [], appear: t + MOVE, vanish: null, last: pr.square, promoted: true });
    }
  });

  const css = [];
  const body = [];
  css.push(
    `text{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;fill:${pal.text}}`,
    `.m{fill:${pal.muted}}.a{fill:${pal.accent}}.g{fill:${pal.goldText}}`
  );

  const background = `<rect width="${width}" height="${height}" fill="${pal.bg}"/>`;

  // Sprite definitions
  const defs = [];
  for (const [type, rows] of Object.entries(PIECES)) {
    const { fill, outline } = withOutline(rows);
    defs.push(`<g id="${type}w"><path d="${bitmapPath(outline, PX)}" fill="${pal.whiteLine}"/><path d="${bitmapPath(fill, PX)}" fill="${pal.whiteFill}"/></g>`);
    defs.push(`<g id="${type}b"><path d="${bitmapPath(outline, PX)}" fill="${pal.blackLine}"/><path d="${bitmapPath(fill, PX)}" fill="${pal.blackFill}"/></g>`);
  }
  body.push(`<defs>${defs.join('')}</defs>`);

  // Board
  const squares = [];
  for (let sq = 0; sq < 64; sq++) {
    const dark = ((sq & 7) + (sq >> 3)) % 2 === 0;
    if (dark) squares.push(`<rect x="${sqX(sq)}" y="${sqY(sq)}" width="${S}" height="${S}"/>`);
  }
  body.push(
    `<g transform="translate(${BX} ${BY})">` +
      `<rect x="-3" y="-3" width="${8 * S + 6}" height="${8 * S + 6}" fill="${pal.frame}"/>` +
      `<rect width="${8 * S}" height="${8 * S}" fill="${pal.lightSq}"/>` +
      `<g fill="${pal.darkSq}">${squares.join('')}</g>`
  );

  // Coordinates
  const coords = [];
  for (let i = 0; i < 8; i++) {
    const file = flipped ? 'hgfedcba'[i] : 'abcdefgh'[i];
    const rank = flipped ? i + 1 : 8 - i;
    coords.push(`<text x="${i * S + S - 3}" y="${8 * S - 3}" text-anchor="end" font-size="7" class="m" opacity=".8">${file}</text>`);
    coords.push(`<text x="2" y="${i * S + 8}" font-size="7" class="m" opacity=".8">${rank}</text>`);
  }
  body.push(coords.join(''));

  // Last-move and check highlights (discrete jumps)
  const onSquare = (sq) => `translate(${sqX(sq)}px,${sqY(sq)}px)`;
  // The square-sized highlight, shrunk and moved to frame one pocket slot in the side panel.
  const onPocket = (side, type) => {
    const [x, y] = pocketXY(side, type);
    const [w, h] = [11 * PX * POCKET_SCALE + 4, 12 * PX * POCKET_SCALE + 4];
    return `translate(${num(x - BX - 2)}px,${num(y - BY - 2)}px) scale(${num(w / S)},${num(h / S)})`;
  };
  // Where a move came from: the square it left or, for a crazyhouse drop, the pocket slot.
  const cameFrom = (ply) => (ply.drop ? onPocket(ply.color, ply.drop.type) : onSquare(ply.from));
  // In crazyhouse the highlight is also coloured: green for an ordinary move, blue for a drop.
  const tint = (ply) => (startPos.pockets && ply.drop ? pal.drop : pal.move);
  // These keyframes step from one to the next, so a value only needs writing when it changes.
  const hlFrames = (where) => {
    let k = `0%{opacity:0;transform:translate(0px,0px)}`;
    let colour = pal.move;
    shown.forEach((ply, i) => {
      k += `${pct(tPly(i))}%{${i === 0 ? 'opacity:.5;' : ''}transform:${where(ply)}${tint(ply) === colour ? '' : `;fill:${tint(ply)}`}}`;
      colour = tint(ply);
    });
    k += `${pct(holdEnd)}%,100%{opacity:0}`;
    return k;
  };
  if (shown.length) {
    css.push(`@keyframes hf{${hlFrames(cameFrom)}}@keyframes ht{${hlFrames((ply) => onSquare(ply.to))}}`);
    css.push(`.hf{${loop('hf', 'steps(1,end)')}}.ht{${loop('ht', 'steps(1,end)')}}`);
    body.push(`<rect class="hf" width="${S}" height="${S}" fill="${pal.move}" opacity="0"/>`);
    body.push(`<rect class="ht" width="${S}" height="${S}" fill="${pal.move}" opacity="0"/>`);
    if (flights.length) {
      // When a captured piece arrives in a pocket, its slot lights up until the next move starts.
      let hp = `0%{opacity:0}`;
      for (const f of flights) hp += `${pct(f.t + FLY)}%{opacity:.5;transform:${onPocket(f.side, f.as)}}${pct(f.nextMove)}%{opacity:0}`;
      css.push(`@keyframes hp{${hp}${pct(holdEnd)}%,100%{opacity:0}}.hp{${loop('hp', 'steps(1,end)')}}`);
      body.push(`<rect class="hp" width="${S}" height="${S}" fill="${pal.gain}" opacity="0"/>`);
    }

    let ck = `0%{opacity:0}`;
    let lit = false;
    shown.forEach((ply, i) => {
      // A king stepping out of check leaves the red square behind, so clear it as the king
      // sets off: the square it came from then shows the green last-move highlight.
      const kingEscapes = i > 0 && shown[i - 1].check && ply.from >= 0 && ply.before.board[ply.from].type === 'k';
      if (kingEscapes && lit) ck += `${pct(tPly(i))}%{opacity:0}`;
      const t = pct(tPly(i) + MOVE);
      if (ply.check) ck += `${t}%{opacity:.6;transform:translate(${sqX(ply.checkedKing)}px,${sqY(ply.checkedKing)}px)}`;
      else if (lit && !kingEscapes) ck += `${t}%{opacity:0}`;
      lit = ply.check;
    });
    ck += `${pct(holdEnd)}%,100%{opacity:0}`;
    css.push(`@keyframes ck{${ck}}.ck{${loop('ck', 'steps(1,end)')}}`);
    body.push(`<rect class="ck" width="${S}" height="${S}" fill="${pal.check}" opacity="0"/>`);
  }

  // Pieces
  const pos = (sq) => `translate(${sqX(sq)}px,${sqY(sq)}px)`;
  // The transform that puts a board piece exactly over a pocket piece in the side panel.
  const pocketPos = (side, type) => {
    const [x, y] = pocketXY(side, type);
    return `translate(${num(x - BX - SPRITE_DX * POCKET_SCALE)}px,${num(y - BY - SPRITE_DY * POCKET_SCALE)}px) scale(${POCKET_SCALE})`;
  };
  // The king that lost acts out how the game ended: knocked over by checkmate, raising a white
  // flag to resign, or blinking when its clock ran out. Then it sinks and fades with the rest of
  // its side. Nothing happens until the last move has landed, and the king is itself again
  // before the next replay.
  const loser = shown.length ? { '1-0': 'b', '0-1': 'w' }[game.result] : undefined;
  const defeat = game.termination === 'mate' ? 'mate' : /resign/.test(game.termination) ? 'resign' : /time/.test(game.termination) ? 'time' : null;
  // `steps` pairs a number of seconds after the last move with a style. The first style is how
  // things rest until then, and the last is held until the replay ends.
  const afterLastMove = (name, steps, timing) => {
    const [rest, held] = [steps[0][1], steps[steps.length - 1][1]];
    const frames = [[0, rest], ...steps.map(([seconds, style]) => [lastT + seconds, style]), [resetAt - 0.01, held], [resetAt, rest], [D, rest]];
    css.push(`@keyframes ${name}{${frames.map(([at, style]) => `${pct(at)}%{${style}}`).join('')}}.${name}{${loop(name, timing)}}`);
  };
  const kingEnding = (king) => {
    const shifted = (y, opacity) => `transform:translate(0px,${y}px);opacity:${opacity}`;
    if (defeat === 'mate') {
      // The king shudders, topples onto its side and rocks to a stop.
      const leaning = (degrees) => `transform:translate(${S / 2}px,20px) rotate(${degrees}deg) translate(${-S / 2}px,-20px)`;
      const steps = [[0.12, 0], [0.18, -12], [0.24, 12], [0.3, -12], [0.36, 8], [0.62, 98], [0.72, 86], [0.8, 90]];
      afterLastMove('ke', steps.map(([seconds, degrees]) => [seconds, leaning(degrees)]), 'ease-in-out');
      return `<g class="ke" transform="rotate(90 ${S / 2} 20)">${king}</g>`;
    }
    if (defeat === 'resign') {
      // The king stays standing, and a white flag pops up beside it.
      const { fill, outline } = withOutline(FLAG);
      afterLastMove('ke', [[0.22, shifted(7, 0)], [0.44, shifted(-2, 1)], [0.57, shifted(1, 1)], [0.68, shifted(0, 1)]], 'ease-in-out');
      return (
        `${king}<g transform="translate(${S - 15} 0)"><g class="ke">` +
        `<path d="${bitmapPath(outline, 1.5)}" fill="${pal.whiteLine}"/><path d="${bitmapPath(fill, 1.5)}" fill="${pal.whiteFill}"/></g></g>`
      );
    }
    if (defeat === 'time') {
      // The king blinks twice.
      afterLastMove('ke', [[0.12, 'opacity:1'], [0.27, 'opacity:0.25'], [0.42, 'opacity:1'], [0.57, 'opacity:0.25'], [0.72, 'opacity:1']], 'linear');
      return `<g class="ke">${king}</g>`;
    }
    return king;
  };
  // The winning side's pieces celebrate: each one starts bouncing at its own random moment
  // (seeded by the game, so its card never changes) and keeps going until the board clears
  // under it. It leaves as soon as its square, or the square above that it bounces up into,
  // has cleared, so no part of it is left hanging over an empty square.
  const winningSide = loser === 'b' ? 'w' : loser === 'w' ? 'b' : null;
  const bounceStart = uniformSampler(`${game.moves.join(' ')} jump`);
  const bounce = (tr, el) => {
    if (BOUNCE_PIXELS <= 0 || tr.color !== winningSide || tr.vanish !== null) return el;
    const [col, row] = [sqX(tr.last) / S, sqY(tr.last) / S];
    const leaves = Math.min(clearsAt(clearWave(row * 8 + col)), row > 0 ? clearsAt(clearWave((row - 1) * 8 + col)) : Infinity);
    // Every moment on the ground shares one keyframe rule and every moment in the air another,
    // so a whole celebration costs a piece only a few hundred characters.
    const [ground, air] = [[0, resetAt - 0.01, resetAt], []];
    const keep = (list, sec) => { if (sec < resetAt - 0.02) list.push(sec); };
    for (let t = lastT + BOUNCE_DELAY + bounceStart() * BOUNCE_SPREAD; t < leaves; t += BOUNCE_SECONDS) {
      keep(ground, t);
      keep(air, t + BOUNCE_SECONDS * 0.425);
      keep(ground, t + BOUNCE_SECONDS * 0.85);
    }
    if (!air.length) return el;
    const at = (list) => [...new Set(list.map(pct))].map((p) => `${p}%`).join(',');
    const name = `bo${tr.id}`;
    css.push(
      `@keyframes ${name}{${at(ground)},100%{transform:translateY(0px);animation-timing-function:ease-out}` +
        `${at(air)}{transform:translateY(${-BOUNCE_PIXELS}px);animation-timing-function:ease-in}` +
        `0%{opacity:1}${pct(leaves - 0.005)}%{opacity:1}${pct(leaves)}%,${pct(resetAt - 0.01)}%{opacity:0}${pct(resetAt)}%{opacity:1}}` +
        `.${name}{${loop(name, 'linear')}}`
    );
    return `<g class="${name}">${el}</g>`;
  };
  // The losing side, king and all, sinks a little and fades as one, once its king has acted out
  // the ending. A sunk piece reaches down into the square below, so it leaves as soon as its own
  // square or that one has cleared. Pieces that leave together share one animation.
  const sinking = new Set();
  const sink = (tr, el) => {
    if (tr.color !== loser || tr.vanish !== null) return el;
    const [col, row] = [sqX(tr.last) / S, sqY(tr.last) / S];
    const wave = Math.min(clearWave(row * 8 + col), row < 7 ? clearWave((row + 1) * 8 + col) : Infinity);
    const name = `sk${wave}`;
    if (!sinking.has(name)) {
      sinking.add(name);
      const shifted = (y, opacity) => `transform:translate(0px,${y}px);opacity:${opacity}`;
      const leaves = clearsAt(wave) - lastT;
      afterLastMove(name, [[0.72, shifted(0, 1)], [1.57, shifted(7, 0.3)], [leaves - 0.005, shifted(7, 0.3)], [leaves, shifted(7, 0)]], 'linear');
    }
    return `<g class="${name}" transform="translate(0 7)" opacity=".3">${el}</g>`;
  };
  // In a draw the two kings nod to each other: each leans in toward the other, pauses and
  // straightens up again. Kings on the same file, one straight above the other, both lean
  // toward the middle of the board instead.
  const drawn = shown.length > 0 && game.result === '1/2-1/2';
  const kingX = {};
  for (const t of tracks.values()) if (t.type === 'k') kingX[t.color] = sqX(t.last);
  const nod = (tr, el) => {
    if (!drawn || tr.type !== 'k') return el;
    const x = sqX(tr.last);
    const toward = Math.sign(kingX[tr.color === 'w' ? 'b' : 'w'] - x) || (x < 4 * S ? 1 : -1);
    const leaning = (degrees) => `transform:translate(${S / 2}px,27px) rotate(${degrees}deg) translate(${-S / 2}px,-27px)`;
    const name = `kd${tr.color}`;
    afterLastMove(name, [[0.12, leaning(0)], [0.4, leaning(16 * toward)], [0.75, leaning(16 * toward)], [1.05, leaning(0)]], 'ease-in-out');
    return `<g class="${name}">${el}</g>`;
  };

  const pieceEls = [];
  for (const tr of tracks.values()) {
    // A browser re-evaluates every running animation on every frame, even while nothing moves,
    // so a piece is only animated in the ways it needs: one that stays put all game gets no track
    // of its own (though at the end it may still bounce, sink or nod).
    const travels = tr.drop || tr.moves.length > 0;
    const fades = tr.appear !== null || tr.vanish !== null;
    // In crazyhouse a promoted piece turns back into a pawn when captured, so it carries a
    // small pawn in the corner of its square.
    const badge = startPos.pockets && tr.promoted ? `<use href="#p${tr.color}" transform="translate(${S - 10} 0) scale(.45)"/>` : '';
    const rainDelay = INTRO.rain + ((7 - sqY(tr.sq0) / S) * 0.09 + (sqX(tr.sq0) / S) * 0.03) / INTRO_SPEED;
    const rain = tr.appear === null ? ` class="rn" style="animation-delay:${num(rainDelay)}s"` : '';
    const sprite = `<use${rain} href="#${tr.type}${tr.color}" x="${SPRITE_DX}" y="${SPRITE_DY}"/>`;
    // The ending's effects move the piece and its badge together.
    const figure = (tr.type === 'k' && tr.color === loser ? kingEnding(sprite) : nod(tr, sprite)) + badge;
    const piece =
      `transform="translate(${sqX(tr.last)} ${sqY(tr.last)})"${tr.vanish === null ? '' : ' opacity="0"'}>` +
      `${sink(tr, bounce(tr, figure))}</g>`;
    if (!travels && !fades) {
      pieceEls.push(`<g ${piece}`);
      continue;
    }
    // Merge transform and opacity keyframes so each percentage appears once.
    const frames = new Map();
    const set = (sec, prop, value) => {
      const key = sec === 'end' ? '100' : pct(sec);
      if (!frames.has(key)) frames.set(key, {});
      frames.get(key)[prop] = value;
    };
    // A dropped piece waits, hidden, on its pocket slot in the side panel, then slides onto
    // the board while growing to full size. Its keyframes all carry a scale so they interpolate.
    const on = tr.drop ? (sq) => `${pos(sq)} scale(1)` : pos;
    const home = tr.drop ? pocketPos(tr.color, tr.type) : pos(tr.sq0);
    if (travels) {
      set(0, 'transform', home);
      if (tr.drop) {
        // It lands a little oversized, centred on its square, and settles: a small bump.
        const grown = ((DROP_BUMP - 1) * S) / 2;
        set(tr.appear, 'transform', home);
        set(tr.appear + MOVE, 'transform', `translate(${num(sqX(tr.sq0) - grown)}px,${num(sqY(tr.sq0) - grown)}px) scale(${DROP_BUMP})`);
        set(tr.appear + MOVE + 0.16, 'transform', on(tr.sq0));
      }
      for (const mv of tr.moves) {
        set(mv.t, 'transform', on(mv.from));
        set(mv.t + MOVE, 'transform', on(mv.to));
      }
      set(resetAt, 'transform', on(tr.last));
      set('end', 'transform', home);
    }
    // Promoted and dropped pieces appear mid-game; captured ones vanish. A piece can do both.
    if (fades) {
      const born = tr.appear === null ? 1 : 0;
      set(0, 'opacity', born);
      if (tr.appear !== null) { set(tr.appear - 0.01, 'opacity', 0); set(tr.appear, 'opacity', 1); }
      if (tr.vanish !== null) {
        // A captured piece fades out, unless a flying copy takes over from it at once (crazyhouse).
        set(tr.vanish - (tr.snap ? 0.01 : 0.02), 'opacity', 1);
        set(tr.vanish + (tr.snap ? 0 : 0.12), 'opacity', 0);
      }
      const remains = tr.vanish === null;
      if (tr.drop && remains) set(resetAt - 0.01, 'opacity', 1);
      set(resetAt, 'opacity', remains && !tr.drop ? 1 : 0);
      set('end', 'opacity', born);
    }
    const frameCss = [...frames.entries()]
      .sort((a, b) => Number(a[0]) - Number(b[0]))
      .map(([k, v]) => `${k}%{${Object.entries(v).map(([prop, val]) => `${prop}:${val}`).join(';')}}`)
      .join('');
    css.push(`@keyframes p${tr.id}{${frameCss}}.p${tr.id}{${loop(`p${tr.id}`, 'ease-in-out')}}`);
    pieceEls.push(`<g class="p${tr.id}" ${piece}`);
  }
  // Crazyhouse captures: a copy of the captured piece flies from its square to the capturer's
  // pocket, shrinking and changing sides on the way. Drawn after the pieces, so it passes over them.
  // Flights never overlap, so every capture of one kind (say, a black knight) re-uses a single
  // flyer instead of getting its own: far fewer animations for the browser to keep running.
  // A flyer holds each keyframe until the next, except where a keyframe asks for a smooth change.
  const EASED = ';animation-timing-function:ease-in-out';
  const EVEN = ';animation-timing-function:linear';
  const flyers = new Map();
  for (const f of flights) {
    const kind = f.sprite + f.as;
    if (!flyers.has(kind)) flyers.set(kind, []);
    flyers.get(kind).push(f);
  }
  [...flyers.values()].forEach((kind, n) => {
    let to = `${pos(kind[0].sq)} scale(1)`;
    let fly = `0%{transform:${to};opacity:0}`;
    let oldSprite = `0%{opacity:1}`;   // the captured piece, fading out over the second half
    let newSprite = `0%{opacity:0}`;   // what it becomes in the pocket, fading in over the first half
    for (const f of kind) {
      const [start, half, end, gone] = [pct(f.t), pct(f.t + FLY / 2), pct(f.t + FLY), pct(f.t + FLY + 0.01)];
      to = pocketPos(f.side, f.as);
      fly += `${start}%{transform:${pos(f.sq)} scale(1);opacity:1${EASED}}${end}%{transform:${to};opacity:1}${gone}%{opacity:0}`;
      newSprite += `${start}%{opacity:0${EVEN}}${half}%{opacity:1}${gone}%{opacity:0}`;
      oldSprite += `${half}%{opacity:1${EVEN}}${end}%{opacity:0}${gone}%{opacity:1}`;
    }
    css.push(
      `@keyframes fl${n}{${fly}100%{transform:${to};opacity:0}}.fl${n}{${loop(`fl${n}`, 'steps(1,end)')}}` +
        `@keyframes fo${n}{${oldSprite}100%{opacity:1}}.fo${n}{${loop(`fo${n}`, 'steps(1,end)')}}` +
        `@keyframes fi${n}{${newSprite}100%{opacity:0}}.fi${n}{${loop(`fi${n}`, 'steps(1,end)')}}`
    );
    const { sprite, as, side } = kind[0];
    const use = (cls, id) => `<use class="${cls}" href="#${id}" x="${SPRITE_DX}" y="${SPRITE_DY}"/>`;
    pieceEls.push(`<g class="fl${n}" opacity="0">${use(`fo${n}`, sprite)}${use(`fi${n}`, as + side)}</g>`);
  });

  // Pieces and the end banner are drawn last, above the side panel, so that pieces stay on
  // top while they travel between the board and a pocket.
  const pieceLayer = `<g>${pieceEls.join('')}</g>`;

  // End-of-game overlay
  // The banner says who won and, on a second line, how.
  const label = END_LABEL[game.termination] || (game.result === '1/2-1/2' ? 'DRAW' : 'GAME OVER');
  const winner = { '1-0': 'WHITE WINS', '0-1': 'BLACK WINS', '1/2-1/2': 'DRAW' }[game.result] || label;
  const how = label === winner ? '' : label;
  css.push(
    `@keyframes eo{0%,${pct(lastT + 0.3)}%{opacity:0}${pct(lastT + 0.6)}%,${pct(holdEnd)}%{opacity:1}${pct(holdEnd + FADE)}%,100%{opacity:0}}` +
      `.eo{${loop('eo', 'linear')}}`
  );
  const bannerY = S * 3.05;
  const endBanner =
    `<g class="eo" opacity="0"><rect x="${S * 1.5}" y="${bannerY}" width="${S * 5}" height="${S * (how ? 1.9 : 1.4)}" fill="${pal.bg}" opacity=".88"/>` +
    `<text x="${S * 4}" y="${bannerY + 26}" text-anchor="middle" font-size="15" font-weight="700" letter-spacing="2" class="a">${winner}</text>` +
    (how ? `<text x="${S * 4}" y="${bannerY + 45}" text-anchor="middle" font-size="10" letter-spacing="2" class="m">${how}</text>` : '') +
    `</g>`;
  body.push(`</g>`);

  // Side panel
  const score = (side) => {
    if (game.result === '1/2-1/2') return '½';
    if (game.result === '1-0') return side === 'w' ? '1' : '0';
    if (game.result === '0-1') return side === 'b' ? '1' : '0';
    return '';
  };
  // Everything that gives the result away (each player's score and the "won by" line) is
  // collected here and kept hidden until the last move has been played.
  const result = [];
  const playerRow = (side, y) => {
    const p = side === 'w' ? game.white : game.black;
    const isMe = me && p.name.toLowerCase() === me;
    // A name is cut to what fits between the king and the score (monospace letters are 0.6em wide).
    const nameX = PX0 + 11 * PX * KING_SCALE + 7.5;
    // The player's clock: one line per move they made, on a strip behind a one-line window,
    // stepped along by a single animation. A player who ran out of time ends on 0:00.
    let clock = '';
    let clockWidth = 0;
    if (hasClocks && shown.length) {
      const mine = shown.map((ply, i) => i).filter((i) => shown[i].color === side);
      const earlier = startPly + (mine.length ? mine[0] : 0) - 2;
      const values = [earlier >= 0 ? game.clocks.afterMove[earlier] : game.clocks.start, ...mine.map((i) => game.clocks.afterMove[startPly + i])];
      const when = mine.map((i) => tPly(i));
      if (game.termination === 'outoftime' && shown[shown.length - 1].color !== side) {
        values.push(0);
        when.push(lastT + 0.3);
      }
      const texts = values.map(clockText);
      clockWidth = Math.max(...texts.map((t) => t.length)) * 0.6 * CLOCK_SIZE + 6;
      const right = PX0 + PANEL_W - (0.6 * SCORE_SIZE + 10);
      const LINE = 20;
      let frames = `0%{transform:translate(0px,0px)}`;
      when.forEach((t, n) => { frames += `${pct(t)}%{transform:translate(0px,${-(n + 1) * LINE}px)}`; });
      frames += `${pct(resetAt)}%,100%{transform:translate(0px,0px)}`;
      css.push(`@keyframes cl${side}{${frames}}.cl${side}{${loop(`cl${side}`, 'steps(1,end)')}}`);
      clock =
        `<clipPath id="cc${side}"><rect x="${num(right - clockWidth)}" y="${y - 11}" width="${num(clockWidth + 2)}" height="15"/></clipPath>` +
        `<g clip-path="url(#cc${side})"><g class="cl${side}" transform="translate(0 ${-(texts.length - 1) * LINE})">` +
        `<text text-anchor="end" font-size="${CLOCK_SIZE}" class="m">${texts.map((t, n) => `<tspan x="${num(right)}" y="${y + n * LINE}">${t}</tspan>`).join('')}</text>` +
        `</g></g>`;
    }
    const maxName = Math.floor((PX0 + PANEL_W - nameX - (0.6 * SCORE_SIZE + 8) - clockWidth) / (0.6 * NAME_SIZE));
    result.push(`<text x="${PX0 + PANEL_W}" y="${y}" text-anchor="end" font-size="${SCORE_SIZE}" font-weight="700" class="a">${score(side)}</text>`);
    return (
      `<use href="#k${side}" transform="translate(${PX0} ${num(y + 1 - 12 * PX * KING_SCALE)}) scale(${KING_SCALE})"/>` +
      `<text x="${num(nameX)}" y="${y}" font-size="${NAME_SIZE}"${isMe ? ` font-weight="700" class="g"` : ''}>${esc(trunc(p.name, maxName))}</text>` +
      clock
    );
  };
  body.push(playerRow(topSide, topNameY));
  body.push(playerRow(bottomSide, bottomNameY));

  // Crazyhouse pockets: the pieces each player holds in hand, next to their name.
  if (startPos.pockets) {
    const fadeFrom = holdEnd + 0.05;
    const pocketRow = (side) => {
      [...POCKET_TYPES].forEach((type) => {
        // Count over time: a dropped piece leaves the pocket as it starts to slide, a captured one is added when it flies in.
        const first = startPos.pockets[side][type];
        const changes = [[0, first]];
        let count = first;
        shown.forEach((ply, i) => {
          const c = ply.after.pockets[side][type];
          if (c !== count) changes.push([ply.drop ? tPly(i) : tPly(i) + FLY_WAIT + FLY, c]);
          count = c;
        });
        const [x, y] = pocketXY(side, type);
        // Every slot always shows its piece faintly, so an empty pocket still reads as a pocket.
        body.push(`<use href="#${type}${side}" transform="translate(${x} ${y}) scale(${POCKET_SCALE})" opacity=".22"/>`);
        for (const v of new Set(changes.map((c) => c[1]))) {
          if (v === 0) continue;
          const el =
            `<use href="#${type}${side}" transform="translate(${x} ${y}) scale(${POCKET_SCALE})"/>` +
            (v > 1 ? `<text x="${num(x + 11 * PX * POCKET_SCALE + 1.8)}" y="${num(y + 12 * PX * POCKET_SCALE - 1.4)}" font-size="${COUNT_SIZE}" class="m">${v}</text>` : '');
          if (changes.length === 1) { body.push(el); continue; }
          const frames = new Map(changes.map(([t, c]) => [pct(t), c === v ? 1 : 0]));
          const [atEnd, atStart] = [count === v ? 1 : 0, first === v ? 1 : 0];
          const fade = atEnd === atStart ? '' : `${pct(fadeFrom)}%{opacity:${atEnd};animation-timing-function:linear}`;
          const name = `z${side}${type}${v}`;
          css.push(`@keyframes ${name}{${[...frames].map(([k, o]) => `${k}%{opacity:${o}}`).join('')}${fade}${pct(resetAt)}%{opacity:${atStart}}}.${name}{${loop(name, 'steps(1,end)')}}`);
          body.push(`<g class="${name}" opacity="${count === v ? 1 : 0}">${el}</g>`);
        }
      });
    };
    pocketRow(topSide);
    pocketRow(bottomSide);
  }

  // Middle of the panel: the current move, where the game was played, then the result.
  const moveY = BY + 4 * S - 11;
  if (shown.length) {
    // The current move. Each move is a line on one tall strip seen through a one-line window,
    // and a single stepped animation scrolls the strip: one running animation, not one per move.
    const LINE = 40;
    const scroll = (lines) => `translate(0px,${-lines * LINE}px)`;
    let mv = `0%{transform:${scroll(0)}}`;   // the strip starts on an empty line, before the first move
    const lines = shown.map((ply, i) => {
      mv += `${pct(tPly(i))}%{transform:${scroll(i + 1)}}`;
      const san = ply.san.replace(/^P@/, '@');
      const label = ply.color === 'w' ? `${ply.moveNumber}. ${san}` : `${ply.moveNumber}… ${san}`;
      return `<tspan x="${PX0}" y="${moveY + (i + 1) * LINE}">${esc(label)}</tspan>`;
    });
    mv += `${pct(tPly(shown.length - 1) + steps[shown.length - 1] + END_HOLD)}%,100%{transform:${scroll(0)}}`;
    css.push(`@keyframes mv{${mv}}.mv{${loop('mv', 'steps(1,end)')}}`);
    body.push(
      `<clipPath id="mw"><rect x="${PX0 - 2}" y="${moveY - 24}" width="${PANEL_W + 4}" height="32"/></clipPath>` +
        `<g clip-path="url(#mw)"><g class="mv" transform="translate(0 ${-shown.length * LINE})"><text font-size="22" font-weight="700">${lines.join('')}</text></g></g>`
    );
  }

  body.push(`<text x="${PX0}" y="${moveY + 21}" font-size="9" class="m">${esc([game.source, game.clock].filter(Boolean).join(' · '))}</text>`);
  result.push(`<text x="${PX0}" y="${moveY + 39}" font-size="11" class="a">${esc(game.ending || '')}</text>`);

  // The result appears as the end banner does. Its animation plays once and then holds, so on
  // the first pass the result is a surprise and on every replay after that it stays in view.
  css.push(`@keyframes rk{0%,${pct(lastT + 0.3)}%{opacity:0}${pct(lastT + 0.6)}%,100%{opacity:1}}.rs{animation:rk ${dur} linear ${INTRO.gameStarts}s both}`);
  body.push(`<g class="rs">${result.join('')}</g>`);

  const B = 8 * S;
  const share = (sec, total) => num((sec / total) * 100);
  css.push(`@keyframes rn{0%{transform:translateY(${-(B + 40)}px)}72%{transform:translateY(5px)}100%{transform:translateY(0px)}}.rn{animation:rn ${num(0.42 / INTRO_SPEED)}s ease-in backwards}`);

  let outro = '';
  for (let g = 0; g < 8; g++) {
    let rects = '';
    for (let i = 0; i < 64; i++) {
      if (clearWave(i) !== g) continue;
      rects += `<rect x="${(i % 8) * S - 1}" y="${Math.floor(i / 8) * S - 1}" width="${S + 2}" height="${S + 2}"/>`;
    }
    css.push(`@keyframes dg${g}{0%{opacity:0}${pct(clearsAt(g))}%,100%{opacity:1}}.dg${g}{${loop(`dg${g}`, 'steps(1,end)')}}`);
    outro += `<g class="dg${g}" fill="${pal.bg}" opacity="0">${rects}</g>`;
  }
  let stairs = '';
  for (let row = 0; row < 8; row++) stairs += `M${-(7 - row) * S - 1} ${row * S - 1}h${B + (7 - row) * S + 2}v${S + 2}h${-(B + (7 - row) * S + 2)}z`;
  let sweep = `0%{transform:translateX(0px);opacity:1}`;
  for (let k = 1; k <= 15; k++) sweep += `${pct(0.08 + k * 0.055)}%{transform:translateX(${k * S}px)${k === 15 ? ';opacity:0' : ''}}`;
  sweep += `${pct(D - 0.08)}%,100%{transform:translateX(0px);opacity:1}`;
  css.push(
    `@keyframes sw{${sweep}}.sw{${loop('sw', 'steps(1,end)')}}` +
      `@keyframes sw1{0%,100%{opacity:0}}.sw1{animation:sw1 ${num(INTRO.gameStarts + 1)}s linear}`
  );
  outro +=
    `<clipPath id="sc"><rect x="-1" y="-1" width="${B + 2}" height="${B + 2}"/></clipPath>` +
    `<g class="sw1" clip-path="url(#sc)"><path class="sw" d="${stairs}" fill="${pal.bg}" opacity="0"/></g>`;

  const cardName = (side) => esc(trunc((side === 'w' ? game.white : game.black).name, 22));
  const cardClass = (side) => (me && (side === 'w' ? game.white : game.black).name.toLowerCase() === me ? ' class="g"' : '');
  const open = B / 2 + 3;
  const rod = (cls, mirrored) =>
    `<g class="${cls}" opacity="0"><rect x="-6" y="-10" width="12" height="${B + 20}" rx="3" fill="${pal.wood}"/>` +
    `<rect x="-7" y="-12" width="14" height="8" rx="2" fill="${pal.woodDark}"/><rect x="-7" y="${B + 4}" width="14" height="8" rx="2" fill="${pal.woodDark}"/>` +
    `<rect x="${mirrored ? 1 : -3}" y="-3" width="2" height="${B + 6}" fill="${pal.woodLight}" opacity=".7"/></g>`;
  const [rollFrom, rollTo] = [share(INTRO.rollFrom, INTRO.rodsGone), share(INTRO.rollTo, INTRO.rodsGone)];
  const doorsLast = INTRO.doorsTo + 0.05 / INTRO_SPEED;
  const [doorsFrom, doorsTo] = [share(INTRO.doorsFrom, doorsLast), share(INTRO.doorsTo, doorsLast)];
  css.push(
    `@keyframes sl{0%,${rollFrom}%{transform:translateX(0px);opacity:1}${rollTo}%{transform:translateX(${-open}px);opacity:1}100%{transform:translateX(${-open}px);opacity:0}}` +
      `@keyframes sr{0%,${rollFrom}%{transform:translateX(0px);opacity:1}${rollTo}%{transform:translateX(${open}px);opacity:1}100%{transform:translateX(${open}px);opacity:0}}` +
      `@keyframes rl{0%,${rollFrom}%{transform:translateX(${B / 2 - 6}px);opacity:1}${rollTo}%{transform:translateX(-9px);opacity:1}100%{transform:translateX(-9px);opacity:0}}` +
      `@keyframes rr{0%,${rollFrom}%{transform:translateX(${B / 2 + 6}px);opacity:1}${rollTo}%{transform:translateX(${B + 9}px);opacity:1}100%{transform:translateX(${B + 9}px);opacity:0}}` +
      ['sl', 'sr', 'rl', 'rr'].map((n) => `.${n}{animation:${n} ${INTRO.rodsGone}s ease-in-out forwards}`).join('') +
      `@keyframes vt{0%,${doorsFrom}%{transform:translateY(0px);opacity:1}${doorsTo}%{transform:translateY(${-open}px);opacity:1}100%{transform:translateY(${-open}px);opacity:0}}` +
      `@keyframes vb{0%,${doorsFrom}%{transform:translateY(0px);opacity:1}${doorsTo}%{transform:translateY(${open}px);opacity:1}100%{transform:translateY(${open}px);opacity:0}}` +
      `@keyframes vv{0%,${share(INTRO.vsOut, INTRO.doorsFrom)}%{opacity:1}100%{opacity:0}}` +
      `.vt{animation:vt ${num(doorsLast)}s ease-in forwards}.vb{animation:vb ${num(doorsLast)}s ease-in forwards}.vv{animation:vv ${INTRO.doorsFrom}s linear forwards}`
  );
  const intro =
    `<clipPath id="bc"><rect x="-3" y="-3" width="${B + 6}" height="${B + 6}"/></clipPath><g clip-path="url(#bc)">` +
    `<g class="vt" opacity="0"><rect x="-3" y="-3" width="${B + 6}" height="${open}" fill="${pal.bg}"/><use href="#k${topSide}" x="${B / 2 - 11}" y="36"/>` +
    `<text x="${B / 2}" y="86" text-anchor="middle" font-size="15" font-weight="700"${cardClass(topSide)}>${cardName(topSide)}</text></g>` +
    `<g class="vb" opacity="0"><rect x="-3" y="${B / 2}" width="${B + 6}" height="${open}" fill="${pal.bg}"/><use href="#k${bottomSide}" x="${B / 2 - 11}" y="${B - 60}"/>` +
    `<text x="${B / 2}" y="${B - 74}" text-anchor="middle" font-size="15" font-weight="700"${cardClass(bottomSide)}>${cardName(bottomSide)}</text></g>` +
    `<text class="vv a" x="${B / 2}" y="${B / 2 + 8}" text-anchor="middle" font-size="24" font-weight="700" letter-spacing="3" opacity="0">VS</text>` +
    `<rect class="sl" x="-3" y="-3" width="${open}" height="${B + 6}" fill="${pal.bg}" opacity="0"/>` +
    `<rect class="sr" x="${B / 2}" y="-3" width="${open}" height="${B + 6}" fill="${pal.bg}" opacity="0"/></g>${rod('rl')}${rod('rr', true)}`;

  body.push(`<g transform="translate(${BX} ${BY})">${pieceLayer}${outro}${endBanner}${intro}</g>`);

  // As the last move lands the whole card flashes and jolts, and confetti falls over it if the
  // player the card is for has won.
  const hit = lastT + 0.05;
  const flashes = shown.length > 0 && FLASH_STRENGTH > 0;
  const jolts = shown.length > 0 && JOLT_PIXELS > 0;
  const victor = loser === 'b' ? game.white : loser === 'w' ? game.black : null;
  let effects = '';
  if (flashes) {
    css.push(`@keyframes wf{0%,${pct(hit)}%{opacity:0}${pct(hit + 0.07)}%{opacity:${FLASH_STRENGTH}}${pct(hit + 0.55)}%,100%{opacity:0}}.wf{${loop('wf', 'linear')}}`);
    effects += `<rect class="wf" width="${width}" height="${height}" fill="${pal.accent}" opacity="0"/>`;
  }
  if (jolts) {
    // Seconds after the hit, then how far across and down, in thirds of the full jolt.
    const path = [[0.04, -3, 1], [0.08, 3, -1], [0.12, -2, -1], [0.16, 2, 1], [0.2, -1, 0], [0.26, 0, 0]];
    const frames = path.map(([seconds, x, y]) => `${pct(hit + seconds)}%{transform:translate(${num((x * JOLT_PIXELS) / 3)}px,${num((y * JOLT_PIXELS) / 3)}px)}`);
    css.push(`@keyframes wk{0%,${pct(hit)}%{transform:translate(0px,0px)}${frames.join('')}100%{transform:translate(0px,0px)}}.wk{${loop('wk', 'linear')}}`);
  }
  if (CONFETTI_PIECES > 0 && victor && victor.name.toLowerCase() === me) {
    // The pieces wait above the card and fall past it in a few waves, one animation per wave.
    const WAVES = 6;
    const random = uniformSampler(game.moves.join(' '));
    const colours = [pal.accent, pal.drop, pal.gain, pal.gold];
    for (let wave = 0; wave < Math.min(WAVES, CONFETTI_PIECES); wave++) {
      let pieces = '';
      for (let n = wave; n < CONFETTI_PIECES; n += WAVES) {
        const size = 3 + Math.floor(random() * 3);
        pieces += `<rect x="${Math.round(random() * (width - 8))}" y="${-Math.round(8 + random() * 150)}" width="${size}" height="${size}" fill="${colours[Math.floor(random() * colours.length)]}"/>`;
      }
      const from = hit + 0.05 + wave * 0.11;
      const to = from + CONFETTI_SECONDS;
      const [waiting, fallen] = ['transform:translateY(0px)', `transform:translateY(${height + 170}px)`];
      css.push(
        `@keyframes wc${wave}{0%,${pct(from - 0.01)}%{opacity:0;${waiting}}${pct(from)}%{opacity:1;${waiting}}` +
          `${pct(to)}%{opacity:1;${fallen}}${pct(to + 0.01)}%,100%{opacity:0;${waiting}}}.wc${wave}{${loop(`wc${wave}`, 'ease-in')}}`
      );
      effects += `<g class="wc${wave}" opacity="0">${pieces}</g>`;
    }
  }

  const alt = `Animated replay of ${game.white.name} vs ${game.black.name}, ${game.result}`;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-label="${esc(alt)}">` +
    `<style>${css.join('')}@media (prefers-reduced-motion:reduce){*{animation:none!important}}</style>` +
    background +
    (jolts ? `<g class="wk">${body.join('')}</g>` : body.join('')) +
    effects +
    `</svg>`
  );
}

module.exports = { render, PALETTES };
