'use strict';

// Original 9x10 pixel-art chess pieces. An outline ring is generated automatically.
const PIECES = {
  p: ['.........', '.........', '....#....', '...###...', '...###...', '....#....', '...###...', '..#####..', '.#######.', '.#######.'],
  n: ['...#.#...', '..#####..', '.#.#####.', '########.', '###.####.', '....####.', '...#####.', '..######.', '.#######.', '#########'],
  b: ['....#....', '...###...', '..###.#..', '.###.###.', '.##.####.', '..#####..', '...###...', '..#####..', '.#######.', '#########'],
  r: ['.#.#.#.#.', '.#######.', '..#####..', '..#####..', '..#####..', '..#####..', '..#####..', '.#######.', '#########', '#########'],
  q: ['....#....', '#..###..#', '.#..#..#.', '.#######.', '..#####..', '...###...', '...###...', '..#####..', '.#######.', '#########'],
  k: ['....#....', '...###...', '....#....', '.##.#.##.', '#########', '.#######.', '..#####..', '..#####..', '.#######.', '#########'],
};

// The white flag a king raises when its player resigns.
const FLAG = ['######.', '######.', '######.', '######.', '#......', '#......', '#......', '#......', '#......'];

// The stopwatch that rings beside a king whose clock ran out. Its hand points to 12.
const STOPWATCH = ['..###..', '...#...', '.#####.', '###.###', '###.###', '#######', '#######', '.#####.'];

/** Pads the bitmap by one pixel and returns { fill, outline } bitmaps. */
function withOutline(rows) {
  const h = rows.length + 2;
  const w = rows[0].length + 2;
  const filled = (x, y) => y >= 1 && y <= rows.length && x >= 1 && x <= rows[0].length && rows[y - 1][x - 1] === '#';
  const fill = [];
  const outline = [];
  for (let y = 0; y < h; y++) {
    let f = '';
    let o = '';
    for (let x = 0; x < w; x++) {
      const on = filled(x, y);
      let near = false;
      for (let dy = -1; dy <= 1 && !near; dy++) for (let dx = -1; dx <= 1; dx++) if (filled(x + dx, y + dy)) near = true;
      f += on ? '#' : '.';
      o += !on && near ? '#' : '.';
    }
    fill.push(f);
    outline.push(o);
  }
  return { fill, outline, width: w, height: h };
}

function bitmapPath(rows, px) {
  let d = '';
  rows.forEach((row, y) => {
    let x = 0;
    while (x < row.length) {
      if (row[x] !== '#') { x++; continue; }
      const start = x;
      while (x < row.length && row[x] === '#') x++;
      const w = (x - start) * px;
      d += `M${start * px} ${y * px}h${w}v${px}h-${w}z`;
    }
  });
  return d;
}

module.exports = { PIECES, FLAG, STOPWATCH, withOutline, bitmapPath };
