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
const POCKET_SCALE = 0.6;              // crazyhouse pocket pieces are drawn smaller
const POCKET_SLOT = 28;                // horizontal spacing of pocket pieces

const PALETTES = {
  light: {
    bg: '#ffffff', lightSq: '#eef1f4', darkSq: '#b7c0ca', frame: '#d0d7de',
    whiteFill: '#ffffff', whiteLine: '#1f2328', blackFill: '#1f2328', blackLine: '#ffffff',
    move: '#2da44e', check: '#cf222e', text: '#1f2328', muted: '#656d76', accent: '#1a7f37',
  },
  dark: {
    bg: '#0d1117', lightSq: '#3b4450', darkSq: '#262c36', frame: '#30363d',
    whiteFill: '#f0f6fc', whiteLine: '#0d1117', blackFill: '#0d1117', blackLine: '#c9d1d9',
    move: '#2ea043', check: '#f85149', text: '#e6edf3', muted: '#8b949e', accent: '#3fb950',
  },
};

const num = (n) => Number(n.toFixed(3)).toString();
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const trunc = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

function wrap(text, width, maxLines) {
  const words = text.split(/\s+/);
  const lines = [''];
  for (const w of words) {
    const cur = lines[lines.length - 1];
    if ((cur + ' ' + w).trim().length <= width) lines[lines.length - 1] = (cur + ' ' + w).trim();
    else if (lines.length < maxLines) lines.push(w);
    else { lines[lines.length - 1] = trunc(cur + ' ' + w, width); break; }
  }
  return lines;
}

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
  const pocketXY = (side, type) => [
    PX0 + POCKET_TYPES.indexOf(type) * POCKET_SLOT,
    side === topSide ? BY + 24 : BY + 8 * S - 40,
  ];

  // Timeline (seconds)
  const STEP = 0.9 / speed;
  const MOVE = Math.min(0.35, STEP * 0.6);
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
    if (ply.captured !== null) tracks.get(ply.captured).vanish = t + MOVE;
    if (ply.drop) {
      const d = ply.drop;
      tracks.set(d.id, { type: d.type, color: d.color, id: d.id, sq0: d.square, moves: [], appear: t, vanish: null, last: d.square, drop: true });
    }
    if (ply.promotion) {
      const pr = ply.promotion;
      tracks.get(pr.pawnId).vanish = t + MOVE;
      tracks.set(pr.id, { type: pr.type, color: pr.color, id: pr.id, sq0: pr.square, moves: [], appear: t + MOVE, vanish: null, last: pr.square });
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
  const hlFrames = (pick) => {
    let k = `0%{opacity:0;transform:translate(0px,0px)}`;
    shown.forEach((ply, i) => {
      const sq = pick(ply);
      k += `${pct(tPly(i))}%{opacity:.5;transform:translate(${sqX(sq)}px,${sqY(sq)}px)}`;
    });
    k += `${pct(holdEnd)}%,100%{opacity:0}`;
    return k;
  };
  if (shown.length) {
    css.push(`@keyframes hf{${hlFrames((p) => (p.from >= 0 ? p.from : p.to))}}@keyframes ht{${hlFrames((p) => p.to)}}`);
    css.push(`.hf{animation:hf ${dur} steps(1,end) infinite}.ht{animation:ht ${dur} steps(1,end) infinite}`);
    body.push(`<rect class="hf" width="${S}" height="${S}" fill="${pal.move}" opacity="0"/>`);
    body.push(`<rect class="ht" width="${S}" height="${S}" fill="${pal.move}" opacity="0"/>`);

    let ck = `0%{opacity:0}`;
    shown.forEach((ply, i) => {
      const t = pct(tPly(i) + MOVE);
      ck += ply.check
        ? `${t}%{opacity:.6;transform:translate(${sqX(ply.checkedKing)}px,${sqY(ply.checkedKing)}px)}`
        : `${t}%{opacity:0}`;
    });
    ck += `${pct(holdEnd)}%,100%{opacity:0}`;
    css.push(`@keyframes ck{${ck}}.ck{animation:ck ${dur} steps(1,end) infinite}`);
    body.push(`<rect class="ck" width="${S}" height="${S}" rx="6" fill="${pal.check}" opacity="0"/>`);
  }

  // Pieces
  const pos = (sq) => `translate(${sqX(sq)}px,${sqY(sq)}px)`;
  css.push(
    `@keyframes pc{0%{opacity:0}${pct(START - 0.6)}%,${pct(holdEnd)}%{opacity:1}${pct(holdEnd + FADE)}%,100%{opacity:0}}` +
      `.pc{animation:pc ${dur} linear infinite}`
  );
  const pieceEls = [];
  for (const tr of tracks.values()) {
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
    let home = pos(tr.sq0);
    if (tr.drop) {
      const [x, y] = pocketXY(tr.color, tr.type);
      const hx = num(x - BX - SPRITE_DX * POCKET_SCALE);
      const hy = num(y - BY - SPRITE_DY * POCKET_SCALE);
      home = `translate(${hx}px,${hy}px) scale(${POCKET_SCALE})`;
    }
    set(0, 'transform', home);
    if (tr.drop) {
      set(tr.appear, 'transform', home);
      set(tr.appear + MOVE, 'transform', on(tr.sq0));
    }
    for (const mv of tr.moves) {
      set(mv.t, 'transform', on(mv.from));
      set(mv.t + MOVE, 'transform', on(mv.to));
    }
    set(after, 'transform', on(tr.last));
    set('end', 'transform', home);
    // Promoted and dropped pieces appear mid-game; captured ones vanish. A piece can do both.
    if (tr.appear !== null || tr.vanish !== null) {
      const born = tr.appear === null ? 1 : 0;
      set(0, 'opacity', born);
      if (tr.appear !== null) { set(tr.appear - 0.01, 'opacity', 0); set(tr.appear, 'opacity', 1); }
      if (tr.vanish !== null) { set(tr.vanish - 0.02, 'opacity', 1); set(tr.vanish + 0.12, 'opacity', 0); }
      set(after, 'opacity', tr.vanish === null ? 1 : 0);
      set('end', 'opacity', born);
    }
    const frameCss = [...frames.entries()]
      .sort((a, b) => Number(a[0]) - Number(b[0]))
      .map(([k, v]) => `${k}%{${Object.entries(v).map(([prop, val]) => `${prop}:${val}`).join(';')}}`)
      .join('');
    css.push(`@keyframes p${tr.id}{${frameCss}}.p${tr.id}{animation:p${tr.id} ${dur} ease-in-out infinite}`);
    const finalVisible = tr.vanish === null;
    pieceEls.push(
      `<g class="p${tr.id}" transform="translate(${sqX(tr.last)} ${sqY(tr.last)})"${finalVisible ? '' : ' opacity="0"'}>` +
        `<use href="#${tr.type}${tr.color}" x="${SPRITE_DX}" y="${SPRITE_DY}"/></g>`
    );
  }
  // Pieces and the end banner are drawn last, above the side panel, so that a dropped
  // piece stays on top while it slides in from its pocket.
  const pieceLayer = `<g class="pc">${pieceEls.join('')}</g>`;

  // End-of-game overlay
  const label = END_LABEL[game.termination] || (game.result === '1/2-1/2' ? 'DRAW' : 'GAME OVER');
  css.push(
    `@keyframes eo{0%,${pct(lastT + 0.3)}%{opacity:0}${pct(lastT + 0.6)}%,${pct(holdEnd)}%{opacity:1}${pct(holdEnd + FADE)}%,100%{opacity:0}}` +
      `.eo{animation:eo ${dur} linear infinite}`
  );
  const endBanner = (
    `<g class="eo" opacity="0"><rect x="${S * 1.5}" y="${S * 3.3}" width="${S * 5}" height="${S * 1.4}" rx="6" fill="${pal.bg}" opacity=".88"/>` +
      `<text x="${S * 4}" y="${S * 4 + 5}" text-anchor="middle" font-size="15" font-weight="700" letter-spacing="2" class="a">${label}</text></g>`
  );
  body.push(`</g>`);

  // Side panel
  const score = (side) => {
    if (game.result === '1/2-1/2') return '½';
    if (game.result === '1-0') return side === 'w' ? '1' : '0';
    if (game.result === '0-1') return side === 'b' ? '1' : '0';
    return '';
  };
  const playerRow = (side, y) => {
    const p = side === 'w' ? game.white : game.black;
    const isMe = me && p.name.toLowerCase() === me;
    const rating = p.rating ? ` (${p.rating})` : '';
    return (
      `<use href="#k${side}" transform="translate(${PX0} ${y - 17}) scale(.75)"/>` +
      `<text x="${PX0 + 24}" y="${y}" font-size="12"${isMe ? ` font-weight="700"` : ''}>${esc(trunc(p.name, 22))}<tspan class="m" font-weight="400">${esc(rating)}</tspan></text>` +
      `<text x="${PX0 + PANEL_W}" y="${y}" text-anchor="end" font-size="13" font-weight="700" class="a">${score(side)}</text>`
    );
  };
  body.push(playerRow(topSide, BY + 16));
  body.push(playerRow(bottomSide, BY + 8 * S - 4));

  // Crazyhouse pockets: the pieces each player holds in hand, next to their name.
  if (startPos.pockets) {
    const reset = holdEnd + FADE + 0.05;
    const pocketRow = (side) => {
      [...POCKET_TYPES].forEach((type) => {
        // Count over time: a dropped piece leaves the pocket as it starts to slide, captures arrive when the move ends.
        const first = startPos.pockets[side][type];
        const changes = [[0, first]];
        let count = first;
        shown.forEach((ply, i) => {
          const c = ply.after.pockets[side][type];
          if (c !== count) changes.push([ply.drop ? tPly(i) : tPly(i) + MOVE, c]);
          count = c;
        });
        changes.push([reset, first]);
        const [x, y] = pocketXY(side, type);
        for (const v of new Set(changes.map((c) => c[1]))) {
          if (v === 0) continue;
          const el =
            `<use href="#${type}${side}" transform="translate(${x} ${y}) scale(${POCKET_SCALE})"/>` +
            (v > 1 ? `<text x="${x + 15}" y="${y + 13}" font-size="9" class="m">${v}</text>` : '');
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

  // Middle: game info and the current move
  let y = BY + 52;
  const variantName = game.variant === 'crazyhouse' ? 'Crazyhouse' : null;
  const info = [variantName, game.timeClass, game.clock].filter(Boolean).join(' ');
  const date = game.date
    ? game.date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
    : null;
  const meta = [info, date].filter(Boolean).join(', ');
  if (meta) { body.push(`<text x="${PX0}" y="${y}" font-size="10" class="m">${esc(meta)}</text>`); y += 16; }
  if (game.opening) {
    for (const line of wrap(game.opening, 34, 2)) {
      body.push(`<text x="${PX0}" y="${y}" font-size="10" class="m">${esc(line)}</text>`);
      y += 13;
    }
  }

  const moveY = BY + 4 * S + 18;
  const stepPct = num((STEP / D) * 100);
  css.push(`@keyframes mv{0%{opacity:1}${stepPct}%,100%{opacity:0}}.mv{animation:mv ${dur} steps(1,end) infinite;opacity:0}`);
  const lastLen = num(((STEP + END_HOLD) / D) * 100);
  css.push(`@keyframes ml{0%{opacity:1}${lastLen}%,100%{opacity:0}}.ml{animation:ml ${dur} steps(1,end) infinite}`);
  const moveTexts = shown.map((ply, i) => {
    const label = ply.color === 'w' ? `${ply.moveNumber}. ${ply.san}` : `${ply.moveNumber}… ${ply.san}`;
    const delay = num(-(D - tPly(i)));
    const isLast = i === shown.length - 1;
    return `<text class="${isLast ? 'ml' : 'mv'}" style="animation-delay:${delay}s" x="${PX0}" y="${moveY}" font-size="22" font-weight="700"${isLast ? '' : ' opacity="0"'}>${esc(label)}</text>`;
  });
  body.push(`<text x="${PX0}" y="${moveY - 28}" font-size="10" class="m">Move</text>`);
  body.push(moveTexts.join(''));

  const progress = startPly > 0 ? `Last ${Math.ceil(shown.length / 2)} of ${Math.ceil(plies.length / 2)} moves` : `${Math.ceil(plies.length / 2)} moves`;
  body.push(`<text x="${PX0}" y="${moveY + 20}" font-size="10" class="m">${esc(progress)}</text>`);
  body.push(`<text x="${PX0}" y="${moveY + 48}" font-size="11" class="a">${esc(game.ending || '')}</text>`);
  body.push(`<text x="${PX0}" y="${moveY + 62}" font-size="9" class="m">${esc(game.source || '')}</text>`);

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
