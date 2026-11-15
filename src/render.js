'use strict';

const { replay, POCKET_TYPES } = require('./chess');
const { PIECES, withOutline, bitmapPath } = require('./sprites');

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
const DROP_BUMP = 1.22;                // how oversized a dropped piece is at the moment it lands

const PALETTES = {
  light: {
    bg: '#ffffff', lightSq: '#eef1f4', darkSq: '#b7c0ca', frame: '#d0d7de',
    whiteFill: '#ffffff', whiteLine: '#1f2328', blackFill: '#1f2328', blackLine: '#ffffff',
    move: '#2da44e', check: '#cf222e', text: '#1f2328', muted: '#656d76', accent: '#1a7f37',
    drop: '#218bff', gain: '#a475f9',
  },
  dark: {
    bg: '#0d1117', lightSq: '#3b4450', darkSq: '#262c36', frame: '#30363d',
    whiteFill: '#f0f6fc', whiteLine: '#0d1117', blackFill: '#0d1117', blackLine: '#c9d1d9',
    move: '#2ea043', check: '#f85149', text: '#e6edf3', muted: '#8b949e', accent: '#3fb950',
    drop: '#388bfd', gain: '#a371f7',
  },
};

const num = (n) => Number(n.toFixed(3)).toString();
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
  const STEP = 0.9 / speed;
  const MOVE = Math.min(0.35, STEP * 0.6);
  // A captured crazyhouse piece flies to the capturer's pocket. It leaves its square halfway
  // through the capturing move and takes a quick flight, arriving just as the capturer lands.
  const FLY_WAIT = MOVE * 0.5;
  const FLY = MOVE * 0.55;
  const START = 1.0;
  const END_HOLD = 3.2;
  const tPly = (i) => START + i * STEP;
  const lastT = shown.length ? tPly(shown.length - 1) + MOVE : START;
  const holdEnd = lastT + END_HOLD;
  const FADE = 0.4;
  const D = holdEnd + FADE + 0.4;
  const pct = (sec) => num(Math.min(100, Math.max(0, (sec / D) * 100)));
  const dur = `${num(D)}s`;

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
        flights.push({ t: t + FLY_WAIT, sq: victim.last, sprite: victim.type + victim.color, side: ply.color, as });
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
    `.m{fill:${pal.muted}}.a{fill:${pal.accent}}`
  );

  body.push(`<rect width="${width}" height="${height}" fill="${pal.bg}"/>`);

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
      `<rect x="-3" y="-3" width="${8 * S + 6}" height="${8 * S + 6}" rx="4" fill="${pal.frame}"/>` +
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
  const tint = startPos.pockets ? (ply) => `;fill:${ply.drop ? pal.drop : pal.move}` : () => '';
  const hlFrames = (where) => {
    let k = `0%{opacity:0;transform:translate(0px,0px)}`;
    shown.forEach((ply, i) => {
      k += `${pct(tPly(i))}%{opacity:.5;transform:${where(ply)}${tint(ply)}}`;
    });
    k += `${pct(holdEnd)}%,100%{opacity:0}`;
    return k;
  };
  if (shown.length) {
    css.push(`@keyframes hf{${hlFrames(cameFrom)}}@keyframes ht{${hlFrames((ply) => onSquare(ply.to))}}`);
    css.push(`.hf{animation:hf ${dur} steps(1,end) infinite}.ht{animation:ht ${dur} steps(1,end) infinite}`);
    body.push(`<rect class="hf" width="${S}" height="${S}" fill="${pal.move}" opacity="0"/>`);
    body.push(`<rect class="ht" width="${S}" height="${S}" fill="${pal.move}" opacity="0"/>`);
    if (flights.length) {
      // When a captured piece arrives in a pocket, its slot lights up until the next move starts.
      let hp = `0%{opacity:0}`;
      for (const f of flights) hp += `${pct(f.t + FLY)}%{opacity:.5;transform:${onPocket(f.side, f.as)}}${pct(f.t - FLY_WAIT + STEP)}%{opacity:0}`;
      css.push(`@keyframes hp{${hp}${pct(holdEnd)}%,100%{opacity:0}}.hp{animation:hp ${dur} steps(1,end) infinite}`);
      body.push(`<rect class="hp" width="${S}" height="${S}" fill="${pal.gain}" opacity="0"/>`);
    }

    let ck = `0%{opacity:0}`;
    shown.forEach((ply, i) => {
      // A king stepping out of check leaves the red square behind, so clear it as the king
      // sets off: the square it came from then shows the green last-move highlight.
      const kingEscapes = i > 0 && shown[i - 1].check && ply.from >= 0 && ply.before.board[ply.from].type === 'k';
      if (kingEscapes) ck += `${pct(tPly(i))}%{opacity:0}`;
      const t = pct(tPly(i) + MOVE);
      ck += ply.check
        ? `${t}%{opacity:.6;transform:translate(${sqX(ply.checkedKing)}px,${sqY(ply.checkedKing)}px)}`
        : `${t}%{opacity:0}`;
    });
    ck += `${pct(holdEnd)}%,100%{opacity:0}`;
    css.push(`@keyframes ck{${ck}}.ck{animation:ck ${dur} steps(1,end) infinite}`);
    body.push(`<rect class="ck" width="${S}" height="${S}" fill="${pal.check}" opacity="0"/>`);
  }

  // Pieces
  const pos = (sq) => `translate(${sqX(sq)}px,${sqY(sq)}px)`;
  // The transform that puts a board piece exactly over a pocket piece in the side panel.
  const pocketPos = (side, type) => {
    const [x, y] = pocketXY(side, type);
    return `translate(${num(x - BX - SPRITE_DX * POCKET_SCALE)}px,${num(y - BY - SPRITE_DY * POCKET_SCALE)}px) scale(${POCKET_SCALE})`;
  };
  css.push(
    `@keyframes pc{0%{opacity:0}${pct(START - 0.6)}%,${pct(holdEnd)}%{opacity:1}${pct(holdEnd + FADE)}%,100%{opacity:0}}` +
      `.pc{animation:pc ${dur} linear infinite}`
  );
  const pieceEls = [];
  for (const tr of tracks.values()) {
    // A browser re-evaluates every running animation on every frame, even while nothing moves,
    // so a piece is only animated in the ways it needs: one that stays put all game gets none.
    const travels = tr.drop || tr.moves.length > 0;
    const fades = tr.appear !== null || tr.vanish !== null;
    // In crazyhouse a promoted piece turns back into a pawn when captured, so it carries a
    // small pawn in the corner of its square.
    const badge = startPos.pockets && tr.promoted ? `<use href="#p${tr.color}" transform="translate(${S - 10} 0) scale(.45)"/>` : '';
    const piece =
      `transform="translate(${sqX(tr.last)} ${sqY(tr.last)})"${tr.vanish === null ? '' : ' opacity="0"'}>` +
      `<use href="#${tr.type}${tr.color}" x="${SPRITE_DX}" y="${SPRITE_DY}"/>${badge}</g>`;
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
    const after = holdEnd + FADE + 0.05;
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
      set(after, 'transform', on(tr.last));
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
      set(after, 'opacity', tr.vanish === null ? 1 : 0);
      set('end', 'opacity', born);
    }
    const frameCss = [...frames.entries()]
      .sort((a, b) => Number(a[0]) - Number(b[0]))
      .map(([k, v]) => `${k}%{${Object.entries(v).map(([prop, val]) => `${prop}:${val}`).join(';')}}`)
      .join('');
    css.push(`@keyframes p${tr.id}{${frameCss}}.p${tr.id}{animation:p${tr.id} ${dur} ease-in-out infinite}`);
    pieceEls.push(`<g class="p${tr.id}" ${piece}`);
  }
  // Crazyhouse captures: a copy of the captured piece flies from its square to the capturer's
  // pocket, shrinking and changing sides on the way. Drawn after the pieces, so it passes over them.
  // Flights never overlap, so every capture of one kind (say, a black knight) re-uses a single
  // flyer instead of getting its own: far fewer animations for the browser to keep running.
  const HOLD = ';animation-timing-function:step-end';   // stay as is until the next keyframe, then jump
  const flyers = new Map();
  for (const f of flights) {
    const kind = f.sprite + f.as;
    if (!flyers.has(kind)) flyers.set(kind, []);
    flyers.get(kind).push(f);
  }
  [...flyers.values()].forEach((kind, n) => {
    let to = `${pos(kind[0].sq)} scale(1)`;
    let fly = `0%{transform:${to};opacity:0${HOLD}}`;
    let oldSprite = `0%{opacity:1${HOLD}}`;   // the captured piece, fading out over the second half
    let newSprite = `0%{opacity:0${HOLD}}`;   // what it becomes in the pocket, fading in over the first half
    for (const f of kind) {
      const [start, half, end, gone] = [pct(f.t), pct(f.t + FLY / 2), pct(f.t + FLY), pct(f.t + FLY + 0.01)];
      to = pocketPos(f.side, f.as);
      fly += `${start}%{transform:${pos(f.sq)} scale(1);opacity:1}${end}%{transform:${to};opacity:1${HOLD}}${gone}%{transform:${to};opacity:0${HOLD}}`;
      newSprite += `${start}%{opacity:0}${half}%{opacity:1${HOLD}}${gone}%{opacity:0${HOLD}}`;
      oldSprite += `${half}%{opacity:1}${end}%{opacity:0${HOLD}}${gone}%{opacity:1${HOLD}}`;
    }
    css.push(
      `@keyframes fl${n}{${fly}100%{transform:${to};opacity:0}}.fl${n}{animation:fl${n} ${dur} ease-in-out infinite}` +
        `@keyframes fo${n}{${oldSprite}100%{opacity:1}}.fo${n}{animation:fo${n} ${dur} linear infinite}` +
        `@keyframes fi${n}{${newSprite}100%{opacity:0}}.fi${n}{animation:fi${n} ${dur} linear infinite}`
    );
    const { sprite, as, side } = kind[0];
    const use = (cls, id) => `<use class="${cls}" href="#${id}" x="${SPRITE_DX}" y="${SPRITE_DY}"/>`;
    pieceEls.push(`<g class="fl${n}" opacity="0">${use(`fo${n}`, sprite)}${use(`fi${n}`, as + side)}</g>`);
  });

  // Pieces and the end banner are drawn last, above the side panel, so that pieces stay on
  // top while they travel between the board and a pocket.
  const pieceLayer = `<g class="pc">${pieceEls.join('')}</g>`;

  // End-of-game overlay
  // The banner says who won and, on a second line, how.
  const label = END_LABEL[game.termination] || (game.result === '1/2-1/2' ? 'DRAW' : 'GAME OVER');
  const winner = { '1-0': 'WHITE WINS', '0-1': 'BLACK WINS', '1/2-1/2': 'DRAW' }[game.result] || label;
  const how = label === winner ? '' : label;
  css.push(
    `@keyframes eo{0%,${pct(lastT + 0.3)}%{opacity:0}${pct(lastT + 0.6)}%,${pct(holdEnd)}%{opacity:1}${pct(holdEnd + FADE)}%,100%{opacity:0}}` +
      `.eo{animation:eo ${dur} linear infinite}`
  );
  const bannerY = S * 3.05;
  const endBanner =
    `<g class="eo" opacity="0"><rect x="${S * 1.5}" y="${bannerY}" width="${S * 5}" height="${S * (how ? 1.9 : 1.4)}" rx="6" fill="${pal.bg}" opacity=".88"/>` +
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
    const maxName = Math.floor((PX0 + PANEL_W - nameX - (0.6 * SCORE_SIZE + 8)) / (0.6 * NAME_SIZE));
    result.push(`<text x="${PX0 + PANEL_W}" y="${y}" text-anchor="end" font-size="${SCORE_SIZE}" font-weight="700" class="a">${score(side)}</text>`);
    return (
      `<use href="#k${side}" transform="translate(${PX0} ${num(y + 1 - 12 * PX * KING_SCALE)}) scale(${KING_SCALE})"/>` +
      `<text x="${num(nameX)}" y="${y}" font-size="${NAME_SIZE}"${isMe ? ` font-weight="700"` : ''}>${esc(trunc(p.name, maxName))}</text>`
    );
  };
  body.push(playerRow(topSide, topNameY));
  body.push(playerRow(bottomSide, bottomNameY));

  // Crazyhouse pockets: the pieces each player holds in hand, next to their name.
  if (startPos.pockets) {
    const reset = holdEnd + FADE + 0.05;
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
        changes.push([reset, first]);
        const [x, y] = pocketXY(side, type);
        // Every slot always shows its piece faintly, so an empty pocket still reads as a pocket.
        body.push(`<use href="#${type}${side}" transform="translate(${x} ${y}) scale(${POCKET_SCALE})" opacity=".22"/>`);
        for (const v of new Set(changes.map((c) => c[1]))) {
          if (v === 0) continue;
          const el =
            `<use href="#${type}${side}" transform="translate(${x} ${y}) scale(${POCKET_SCALE})"/>` +
            (v > 1 ? `<text x="${num(x + 11 * PX * POCKET_SCALE + 1.8)}" y="${num(y + 12 * PX * POCKET_SCALE - 1.4)}" font-size="${COUNT_SIZE}" class="m">${v}</text>` : '');
          if (changes.length === 2) { body.push(el); continue; }
          const frames = new Map(changes.map(([t, c]) => [pct(t), c === v ? 1 : 0]));
          const name = `z${side}${type}${v}`;
          css.push(`@keyframes ${name}{${[...frames].map(([k, o]) => `${k}%{opacity:${o}}`).join('')}}.${name}{animation:${name} ${dur} steps(1,end) infinite}`);
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
      const label = ply.color === 'w' ? `${ply.moveNumber}. ${ply.san}` : `${ply.moveNumber}… ${ply.san}`;
      return `<text x="${PX0}" y="${moveY + (i + 1) * LINE}" font-size="22" font-weight="700">${esc(label)}</text>`;
    });
    mv += `${pct(tPly(shown.length - 1) + STEP + END_HOLD)}%,100%{transform:${scroll(0)}}`;
    css.push(`@keyframes mv{${mv}}.mv{animation:mv ${dur} steps(1,end) infinite}`);
    body.push(
      `<clipPath id="mw"><rect x="${PX0 - 2}" y="${moveY - 24}" width="${PANEL_W + 4}" height="32"/></clipPath>` +
        `<g clip-path="url(#mw)"><g class="mv" transform="translate(0 ${-shown.length * LINE})">${lines.join('')}</g></g>`
    );
  }

  body.push(`<text x="${PX0}" y="${moveY + 21}" font-size="9" class="m">${esc(game.source || '')}</text>`);
  result.push(`<text x="${PX0}" y="${moveY + 39}" font-size="11" class="a">${esc(game.ending || '')}</text>`);

  // The result appears as the end banner does. Its animation plays once and then holds, so on
  // the first pass the result is a surprise and on every replay after that it stays in view.
  css.push(`@keyframes rk{0%,${pct(lastT + 0.3)}%{opacity:0}${pct(lastT + 0.6)}%,100%{opacity:1}}.rs{animation:rk ${dur} linear forwards}`);
  body.push(`<g class="rs">${result.join('')}</g>`);

  body.push(`<g transform="translate(${BX} ${BY})">${pieceLayer}${endBanner}</g>`);

  const alt = `Animated replay of ${game.white.name} vs ${game.black.name}, ${game.result}`;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-label="${esc(alt)}">` +
    `<style>${css.join('')}@media (prefers-reduced-motion:reduce){*{animation:none!important}}</style>` +
    body.join('') +
    `</svg>`
  );
}

module.exports = { render, PALETTES };
