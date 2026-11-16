'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { render } = require('../src/render');
const { replay } = require('../src/chess');
const { demoGame } = require('../src/demo');
const { parsePgn } = require('../src/pgn');
const { firstGame, gameLink, normalizeLichess, openingFromEcoUrl, wantedVariants } = require('../src/sources');

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
  assert.doesNotMatch(svg, />11[.…] /, 'moves before the last five are left out');
  assert.match(svg, />12… Rd8</);
  assert.match(svg, /17\. Rd8#/);
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
  assert.doesNotMatch(svg, /Blitz|Crazyhouse|moves</, 'the panel shows no speed name, variant or move count');
  assert.match(svg, />8\. @f7</);
  assert.doesNotMatch(svg, /P@/);
  assert.match(svg, /@keyframes zwp1/, 'the white pawn pocket is animated');
  assert.match(svg, /@keyframes zwp1\{[^@]*%\{opacity:1;animation-timing-function:linear\}[\d.]+%\{opacity:0\}\}\.zwp1\{/);
  assert.doesNotMatch(svg.match(/@keyframes zwp2\{[^@]*/)[0], /linear/);
  // 5. exd5: the black pawn flies from d5 to white's pawn pocket, turning white on the way.
  assert.match(svg, /@keyframes fl0\{0%\{transform:translate\(96px,96px\) scale\(1\);opacity:0\}/);
  assert.match(svg, /<g class="fl0" opacity="0"><use class="fo0" href="#pb"[^>]*\/><use class="fi0" href="#pw"[^>]*\/><\/g>/);
  // 6. Nxf7 takes another black pawn, which re-uses the same flyer from f7.
  assert.match(svg.match(/@keyframes fl0\{.*?\}\.fl0/)[0], /translate\(160px,32px\) scale\(1\);opacity:1/);
  assert.strictEqual(svg.match(/<g class="fl\d+"/g).length, 3, 'four captures of three kinds share three flyers');
  assert.doesNotMatch(render(demoGame()), /class="fl\d+"/, 'standard games have no flights to a pocket');
  // 8. @f7: the pawn slides from the pocket, lands on f7 slightly oversized, then settles.
  assert.match(
    svg,
    /translate\(280\.25px,207px\) scale\(0\.75\);opacity:1\}[\d.]+%\{transform:translate\(156\.48px,28\.48px\) scale\(1\.22\)\}[\d.]+%\{transform:translate\(160px,32px\) scale\(1\)/,
    'the dropped pawn slides from the pocket to f7 and lands with a bump'
  );
  // The drop's "from" highlight frames the pawn slot of white's pocket instead of a square, in blue.
  const from = svg.match(/@keyframes hf\{(.*?)\}@keyframes ht/)[1];
  const to = svg.match(/@keyframes ht\{(.*?)\}\.hf/)[1];
  assert.match(from, /translate\(282px,208px\) scale\(0\.641,0\.688\);fill:#218bff\}/);
  assert.match(to, /translate\(160px,32px\);fill:#218bff\}/, 'the square it lands on is blue too');
  assert.strictEqual(from.match(/fill:#218bff/g).length, 1, 'only the drop is blue');
  assert.strictEqual(from.match(/fill:#2da44e/g).length, 1, 'the highlight turns green again on the next ordinary move');
  // 5. exd5: white's pawn slot lights up purple when the captured pawn arrives.
  assert.match(svg, /<rect class="hp" [^>]*fill="#a475f9"/);
  assert.match(svg.match(/@keyframes hp\{.*?\}\.hp/)[0], /%\{opacity:\.5;transform:translate\(282px,208px\) scale\(0\.641,0\.688\)\}[\d.]+%\{opacity:0\}/);
  const standard = render(demoGame());
  assert.doesNotMatch(standard, /class="hp"|#218bff|fill:#2da44e/, 'standard games keep the plain green highlight');
  assert.strictEqual(svg.match(/scale\(0\.75\)" opacity="\.22"\/>/g).length, 10, 'all five slots of both pockets are always drawn faintly');
  assert.doesNotMatch(render(demoGame()), /opacity="\.22"/, 'standard games have no pockets');
});

test('the variant option narrows which games are shown', () => {
  assert.deepStrictEqual(wantedVariants(''), ['standard', 'crazyhouse']);
  assert.deepStrictEqual(wantedVariants('Crazyhouse'), ['crazyhouse']);
  assert.throws(() => wantedVariants('atomic'), /Unknown variant/);
});

test('the check highlight clears as the king starts to move out of check', () => {
  const game = { ...demoGame(), moves: ['e4', 'e5', 'Qh5', 'Nc6', 'Qxf7+', 'Kxf7'], result: '0-1', termination: 'resign' };
  const svg = render(game);
  // The moment the king leaves e8: its square becomes the green "from" highlight.
  const start = svg.match(/@keyframes hf\{.*?([\d.]+)%\{(?:opacity:\.5;)?transform:translate\(128px,0px\)\}/)[1];
  const check = svg.match(/@keyframes ck\{(.*?)\}\.ck/)[1];
  assert.match(check, /\{opacity:\.6;transform:translate\(128px,0px\)\}/, 'e8 turns red after Qxf7+');
  assert.ok(check.includes(`}${start}%{opacity:0}`), 'the red is gone when the king sets off, not when it lands');

  // A check answered without moving the king stays red until the reply lands.
  const blocked = render({ ...game, moves: ['e4', 'd5', 'Bb5+', 'c6'] });
  const blockStart = blocked.match(/@keyframes hf\{.*?([\d.]+)%\{(?:opacity:\.5;)?transform:translate\(64px,32px\)\}/)[1];
  assert.ok(!blocked.match(/@keyframes ck\{(.*?)\}\.ck/)[1].includes(`}${blockStart}%{opacity:0}`));
});

test('the Lichess download stops at the first usable game', async () => {
  const enc = new TextEncoder();
  // A response that sends two games, the second split across chunks, and then never finishes.
  let cancelled = false;
  const body = new ReadableStream({
    start(controller) {
      controller.enqueue(enc.encode('{"id":"a","variant":"atomic"}\n{"id":"b","vari'));
      controller.enqueue(enc.encode('ant":"standard"}\n{"id":"c","variant":"standard"}\n'));
    },
    cancel() { cancelled = true; },
  });
  const game = await firstGame(new Response(body), (g) => g.variant === 'standard');
  assert.strictEqual(game.id, 'b');
  assert.ok(cancelled, 'the rest of the download is abandoned');

  const none = await firstGame(new Response('{"id":"a","variant":"atomic"}\n'), (g) => g.variant === 'standard');
  assert.strictEqual(none, null);
  const noNewline = await firstGame(new Response('{"id":"z","variant":"standard"}'), () => true);
  assert.strictEqual(noNewline.id, 'z', 'a final line without a newline still counts');
});

test('only pieces that move or change are animated, and the move text is one animation', () => {
  const svg = render(demoGame());
  const animated = svg.match(/<g class="p\d+"/g).length;
  const still = svg.match(/<g transform="translate\(\d+ \d+\)">(?:<g class="(?:ke|bo\d+|sk\d|kd[wb])"[^>]*>)*<use class="rn"/g).length;
  assert.strictEqual(animated + still, 32, 'every piece is drawn');
  assert.ok(still >= 8, 'pieces that never move have no animation');
  assert.strictEqual(svg.match(/class="mv"/g).length, 1, 'one scrolling strip shows the current move');
});

test('crazyhouse: a promoted piece is badged and goes to the pocket as a pawn', () => {
  const game = normalizeLichess({
    id: 'zhpromo1', variant: 'crazyhouse', speed: 'blitz', status: 'resign', winner: 'black',
    players: { white: { user: { name: 'alice' } }, black: { user: { name: 'bob' } } },
    moves: 'e4 d5 exd5 Nf6 d6 Nc6 dxc7 Bd7 cxd8=Q+ Rxd8',
  });
  const svg = render(game, { perspective: 'alice' });
  assert.match(svg, /<use href="#qw" [^>]*\/><use href="#pw" transform="translate\(22 0\) scale\(\.45\)"\/><\/g>/, 'the new queen carries a pawn badge');
  assert.match(svg, /<use class="fo\d+" href="#qw"[^>]*\/><use class="fi\d+" href="#pb"/, 'captured, it flies to the pocket as a black pawn');
  assert.doesNotMatch(render({ ...game, variant: 'standard' }), /scale\(\.45\)/, 'no badge in standard chess');
});

test('the result is hidden until the last move lands, then stays', () => {
  const svg = render(demoGame());
  // The scores and the "won by" line live in one group and nowhere else.
  const hidden = svg.match(/<g class="rs">(.*?)<\/g>/)[1];
  assert.match(hidden, />0<\/text>.*>1<\/text>.*>White won by checkmate<\/text>/);
  assert.strictEqual(svg.split('White won by checkmate').length, 2);
  // That group's animation plays once and holds its last frame, so the result stays on later replays.
  assert.match(svg, /@keyframes rk\{0%,[\d.]+%\{opacity:0\}[\d.]+%,100%\{opacity:1\}\}\.rs\{animation:rk [\d.]+s linear 2\.577s both\}/);
  // The banner over the board names the winner, then how.
  assert.match(svg, />WHITE WINS<\/text><text [^>]*>CHECKMATE<\/text><\/g>/);

  const draw = render({ ...demoGame(), moves: ['e4', 'e5'], result: '1/2-1/2', termination: 'draw', ending: 'Draw' });
  assert.match(draw, /class="a">DRAW<\/text><\/g>/, 'an agreed draw needs only one line');
  assert.match(draw.match(/<g class="rs">(.*?)<\/g>/)[1], />½<\/text>.*>½<\/text>/);
});

test('the game link opens from the same side of the board as the card', () => {
  const game = normalizeLichess({
    id: 'abc12345', speed: 'blitz', status: 'resign', winner: 'black',
    players: { white: { user: { name: 'Alice' } }, black: { user: { name: 'Bob' } } }, moves: 'e4 e5',
  });
  assert.strictEqual(gameLink(game, 'alice'), 'https://lichess.org/abc12345/white');
  assert.strictEqual(gameLink(game, 'BOB'), 'https://lichess.org/abc12345/black');
  assert.strictEqual(gameLink(game, 'someone-else'), 'https://lichess.org/abc12345/white', 'a spectator sees White at the bottom, as on the card');
  assert.strictEqual(gameLink(game, ''), 'https://lichess.org/abc12345/white');
  // The link and the card agree on which way round the board is.
  assert.match(render(game, { perspective: 'bob' }), />h<\/text>/);
  assert.strictEqual(gameLink({ ...game, source: 'chess.com', url: 'https://www.chess.com/game/live/1' }, 'bob'), 'https://www.chess.com/game/live/1');
  assert.strictEqual(gameLink(demoGame(), 'Paul Morphy'), null, 'no link for a game with no page');
});

test('the card opens with scrolls, a versus card and falling pieces, once', () => {
  const svg = render(demoGame(), { perspective: 'Paul Morphy' });
  assert.strictEqual(svg.match(/<g class="r[lr]" opacity="0">/g).length, 2);
  assert.match(svg, /<g class="vt" opacity="0">.*?>Duke Karl \/ Count Iso…<\/text><\/g><g class="vb" opacity="0">.*?>Paul Morphy<\/text><\/g><text class="vv a"[^>]*>VS<\/text>/);
  assert.strictEqual(svg.match(/<use class="rn" style="animation-delay:[\d.]+s"/g).length, 32);
  assert.match(svg, /<g transform="translate\(0 192\)"><g class="bo\d+"><use class="rn" style="animation-delay:2\.261s" href="#pw"/);
  assert.match(svg, /<g transform="translate\(224 0\)"><g class="sk\d"[^>]*><use class="rn" style="animation-delay:2\.838s" href="#rb"/);
  for (const name of ['sl', 'sr', 'rl', 'rr', 'vt', 'vb', 'vv']) assert.match(svg, new RegExp(`\\.${name}\\{animation:${name} [\\d.]+s [a-z-]+ forwards\\}`));
  assert.match(svg, /\.rn\{animation:rn 0\.323s ease-in backwards\}/);
  assert.strictEqual(svg.match(/ infinite backwards\}/g).length, svg.match(/ infinite/g).length);
  assert.strictEqual(svg.match(/ 2\.577s infinite backwards\}/g).length, svg.match(/ infinite/g).length);
});

test('between replays the board dissolves and returns in a diagonal sweep', () => {
  const svg = render(demoGame());
  const groups = svg.match(/<g class="dg\d" fill="#ffffff" opacity="0">(?:<rect [^>]*\/>){8}<\/g>/g);
  assert.strictEqual(groups.length, 8);
  const squares = new Set(groups.join('').match(/x="-?\d+" y="-?\d+"/g));
  assert.strictEqual(squares.size, 64);
  const sweep = svg.match(/@keyframes sw\{(.*?)\}\.sw\{/)[1];
  assert.strictEqual(sweep.match(/translateX\(\d+px\)/g).length, 17);
  assert.match(sweep, /translateX\(448px\)\}[\d.]+%\{transform:translateX\(480px\);opacity:0\}[\d.]+%,100%\{transform:translateX\(0px\);opacity:1\}$/);
  assert.match(svg, /\.sw1\{animation:sw1 3\.577s linear\}/);
  assert.match(svg, /<g class="sw1" clip-path="url\(#sc\)"><path class="sw" [^>]*opacity="0"\/><\/g>/);
  assert.doesNotMatch(svg, /class="pc"/);
});

test('a dropped piece is hidden before it returns to the pocket for the next replay', () => {
  const game = normalizeLichess({
    id: 'zhreset1', variant: 'crazyhouse', speed: 'blitz', status: 'resign', winner: 'white',
    players: { white: { user: { name: 'alice' } }, black: { user: { name: 'bob' } } },
    moves: 'e4 e5 Nf3 Nc6 Bc4 Nf6 Ng5 d5 exd5 Nxd5 Nxf7 Kxf7 Qf3+ Ke6 P@f7 Nce7 Qe4',
  });
  const svg = render(game, { perspective: 'alice' });
  const dropped = svg.match(/@keyframes p\d+\{0%\{transform:translate\(280\.25px,207px\) scale\(0\.75\);opacity:0\}.*?\}\}/)[0];
  assert.match(dropped, /%\{opacity:1\}[\d.]+%\{transform:translate\(160px,32px\) scale\(1\);opacity:0\}100%\{transform:translate\(280\.25px,207px\) scale\(0\.75\);opacity:0\}\}$/);
});

const moveTimes = (svg) => {
  const length = Number(svg.match(/animation:hf ([\d.]+)s/)[1]);
  const starts = [...svg.match(/@keyframes hf\{(.*?)\}@keyframes ht/)[1].matchAll(/([\d.]+)%\{(?:opacity:\.5;)?transform:/g)].map((m) => (Number(m[1]) / 100) * length);
  return starts.slice(1).map((t, i) => t - starts[i]);
};
const total = (list) => list.reduce((sum, seconds) => sum + seconds, 0);
const isQuiet = (ply) => ply.captured === null && !ply.drop && !ply.check && !ply.promotion;

test('without clocks each move gets about its average time, and the replay length is fixed', () => {
  const game = demoGame();
  const svg = render(game);
  assert.strictEqual(render(game), svg);
  const times = moveTimes(svg);
  const { plies } = replay(game.moves);
  const averages = times.map((seconds, i) => (i >= plies.length - 2 ? 1.1 : isQuiet(plies[i]) ? 0.5 : 0.9));
  times.forEach((seconds, i) => assert.ok(Math.abs(seconds - averages[i]) <= 0.25, `move ${i} took ${seconds.toFixed(3)}s, expected about ${averages[i]}s`));
  assert.ok(Math.abs(total(times) - total(averages)) < 0.02, 'the times add up to exactly what the averages do');
  assert.ok(new Set(times.map((seconds) => seconds.toFixed(2))).size >= 6, 'they still vary a little');
});

test('with clocks a move gets more time the longer it really took, and the replay length is the same', () => {
  const lichess = (clocks) => normalizeLichess({
    id: 'pace1234', variant: 'standard', speed: 'blitz', status: 'resign', winner: 'white',
    clock: { initial: 180, increment: 0 }, clocks,
    players: { white: { user: { name: 'alice' } }, black: { user: { name: 'bob' } } }, moves: 'e4 e5 Nf3 Nc6 Bc4 Bc5 c3 Nf6 d3 d6',
  });
  const timed = moveTimes(render(lichess([18000, 18000, 17900, 17900, 15900, 17800, 15800, 16800, 15700, 16700])));
  const plain = moveTimes(render(lichess(undefined)));
  assert.ok(Math.abs(total(timed) - 5.1) < 0.02 && Math.abs(total(plain) - 5.1) < 0.02, 'both replays last as long as the averages add up to');
  const average = (moves) => total(moves.map((i) => timed[i])) / moves.length;
  const [instant, quick, slow] = [average([0, 1]), average([2, 3, 5, 6]), average([4, 7])];
  assert.ok(instant + 0.04 < quick && quick + 0.08 < slow, `instant ${instant.toFixed(3)}s < one-second ${quick.toFixed(3)}s < long thinks ${slow.toFixed(3)}s`);
  timed.slice(0, 8).forEach((seconds, i) => assert.ok(seconds > 0.385 && seconds < 0.695, `quiet move ${i} sits inside its caps, not on them (${seconds.toFixed(3)}s)`));
});

test('clocks sit beside the names and the time control beside the site', () => {
  const game = normalizeLichess({
    id: 'clk12345', variant: 'standard', speed: 'blitz', status: 'outoftime', winner: 'black',
    clock: { initial: 180, increment: 2 }, clocks: [18000, 18000, 17650, 17820],
    players: { white: { user: { name: 'alice' } }, black: { user: { name: 'bob' } } }, moves: 'e4 e5 Nf3 Nc6',
  });
  assert.deepStrictEqual(game.clocks, { start: 18000, increment: 200, afterMove: [18000, 18000, 17650, 17820] });
  const svg = render(game, { perspective: 'alice' });
  assert.match(svg, />lichess\.org · 3\+2</);
  const shown = (side) => [...svg.match(new RegExp(`<g class="cl${side}"[^>]*>(.*?)</g>`))[1].matchAll(/>([\d:]+)</g)].map((m) => m[1]);
  assert.deepStrictEqual(shown('w'), ['3:00', '3:00', '2:57', '0:00']);
  assert.deepStrictEqual(shown('b'), ['3:00', '3:00', '2:58']);
  assert.match(svg, /<g class="clw" transform="translate\(0 -60\)">/);
  assert.doesNotMatch(render(demoGame()), /class="cl[wb]"/);
  assert.match(render(demoGame()), />Paris, 1858</);
});

test('the king that lost acts out how the game ended', () => {
  const mate = render(demoGame());
  // Checkmate: Black's king ends on its side, and stands upright until the last move has landed.
  assert.match(mate, /<g class="ke" transform="rotate\(90 16 20\)"><use class="rn" [^>]*href="#kb"[^>]*\/><\/g>/);
  const upright = 'transform:translate\\(16px,20px\\) rotate\\(0deg\\) translate\\(-16px,-20px\\)';
  const act = mate.match(new RegExp(`@keyframes ke\\{0%\\{${upright}\\}([\\d.]+)%\\{${upright}\\}.*?100%\\{${upright}\\}\\}\\.ke\\{`));
  assert.ok(act, 'the king is upright at the start and the end of every replay');
  assert.strictEqual(mate.match(/class="ke"/g).length, 1, 'the winning king is left alone');
  // The card flashes first, then the king falls, then the banner appears.
  const flash = Number(mate.match(/@keyframes wf\{0%,([\d.]+)%\{opacity:0\}/)[1]);
  const banner = Number(mate.match(/@keyframes eo\{0%,([\d.]+)%\{opacity:0\}/)[1]);
  assert.ok(flash < Number(act[1]) && Number(act[1]) < banner);

  const lost = (termination) => render({ ...demoGame(), moves: ['e4', 'e5', 'Nf3'], result: '0-1', termination });
  // Resignation: White's king stays as it is, and a flag that was hidden appears beside it.
  for (const termination of ['resign', 'resigned']) {
    assert.match(lost(termination), /href="#kw" x="5" y="4"\/><g transform="translate\(17 0\)"><g class="ke"><path [^>]*\/><path [^>]*fill="#ffffff"\/><\/g><\/g>/);
    assert.match(lost(termination), /@keyframes ke\{0%\{transform:translate\(0px,7px\);opacity:0\}.*?100%\{transform:translate\(0px,7px\);opacity:0\}\}\.ke\{/);
  }
  // Out of time: White's king blinks, then sinks with the rest of its side.
  for (const termination of ['outoftime', 'timeout']) {
    assert.match(lost(termination), /<g class="sk\d" transform="translate\(0 7\)" opacity="\.3"><g class="ke"><use class="rn" [^>]*href="#kw"/);
    assert.match(lost(termination), /@keyframes ke\{0%\{opacity:1\}[\d.]+%\{opacity:1\}[\d.]+%\{opacity:0\.25\}.*?100%\{opacity:1\}\}\.ke\{/);
  }
  // Any other ending leaves both kings alone.
  for (const other of [{ result: '1/2-1/2', termination: 'stalemate' }, { result: '1/2-1/2', termination: 'timevsinsufficient' }, { result: '0-1', termination: 'abandoned' }]) {
    assert.doesNotMatch(render({ ...demoGame(), moves: ['e4', 'e5'], ...other }), /class="ke"|@keyframes ke/);
  }
});

test('the card flashes and jolts as the game ends, with confetti only when the featured player won', () => {
  const won = render(demoGame(), { perspective: 'Paul Morphy' });
  assert.match(won, /<rect class="wf" width="566" height="288" fill="#1a7f37" opacity="0"\/>/);
  assert.match(won, /@keyframes wf\{0%,[\d.]+%\{opacity:0\}[\d.]+%\{opacity:0\.42\}[\d.]+%,100%\{opacity:0\}\}/);
  // Everything but the background jolts, and comes to rest exactly where it started.
  assert.match(won, /<\/style><rect width="566" height="288" fill="#ffffff"\/><g class="wk"><defs>/);
  assert.match(won, /@keyframes wk\{0%,[\d.]+%\{transform:translate\(0px,0px\)\}[\d.]+%\{transform:translate\(-3px,1px\)\}.*?%\{transform:translate\(0px,0px\)\}100%\{transform:translate\(0px,0px\)\}\}/);
  const waves = won.match(/<g class="wc\d" opacity="0">(?:<rect [^>]*\/>){8}<\/g>/g);
  assert.strictEqual(waves.length, 6, '48 pieces of confetti in six waves');
  assert.match(won, /(?:<g class="wc\d" opacity="0">.*?<\/g>){6}<\/svg>$/, 'confetti is drawn over everything else');

  for (const perspective of ['Duke Karl / Count Isouard', undefined]) {
    const svg = render(demoGame(), { perspective });
    assert.doesNotMatch(svg, /class="wc\d"|@keyframes wc/, 'no confetti for a loss, or when the card is for nobody');
    assert.match(svg, /class="wf"/);
    assert.match(svg, /class="wk"/);
  }
  const draw = render({ ...demoGame(), moves: ['e4', 'e5'], result: '1/2-1/2', termination: 'draw' }, { perspective: 'Paul Morphy' });
  assert.doesNotMatch(draw, /class="wc\d"/, 'no confetti for a draw');
});

test("the featured player's name is gold, in the panel and on the intro card", () => {
  const svg = render(demoGame(), { perspective: 'Paul Morphy' });
  assert.match(svg, /\.g\{fill:#9a6700\}/, 'a darker gold on the light card, so the name stays readable');
  assert.match(render(demoGame(), { palette: 'dark', perspective: 'Paul Morphy' }), /\.g\{fill:#d4a72c\}/);
  assert.match(svg, /font-size="14" font-weight="700" class="g">Paul Morphy</);
  assert.match(svg, /font-size="15" font-weight="700" class="g">Paul Morphy</);
  assert.strictEqual(svg.match(/class="g"/g).length, 2, "the opponent's name stays plain");
  assert.doesNotMatch(render(demoGame()), /class="g"/, 'no gold name when the card is for nobody');
});

test('the board frame, intro clip and end banner have square corners; only the wooden rollers are rounded', () => {
  const svg = render(demoGame(), { perspective: 'Paul Morphy' });
  assert.match(svg, /<rect x="-3" y="-3" width="262" height="262" fill="#d0d7de"\/>/, 'square board frame');
  assert.match(svg, /<clipPath id="bc"><rect x="-3" y="-3" width="262" height="262"\/><\/clipPath>/, 'square intro clip');
  assert.match(svg, /<g class="eo" opacity="0"><rect [^>]*fill="#ffffff" opacity="\.88"\/>/);
  assert.doesNotMatch(svg.match(/<g class="eo" opacity="0"><rect [^>]*>/)[0], /rx=/, 'square end banner');
  const rounded = svg.match(/<rect [^>]*rx="[^"]*"[^>]*>/g);
  assert.strictEqual(rounded.length, 6, 'two rollers, each with a rounded body and two rounded caps');
  assert.ok(rounded.every((r) => /fill="#(c49a5e|7d5c2e)"/.test(r)), 'every rounded rect is part of a roller');
});

test("the intro's two wooden rollers mirror each other, with their light strips on the outer sides", () => {
  const svg = render(demoGame(), { perspective: 'Paul Morphy' });
  const strip = (cls) => svg.match(new RegExp(`<g class="${cls}" opacity="0">.*?<rect x="(-?\\d+)" y="-3" width="2" height="262" fill="#ecd4a4" opacity="\\.7"\\/><\\/g>`))[1];
  assert.strictEqual(strip('rl'), '-3', 'left roller: strip just left of its centre');
  assert.strictEqual(strip('rr'), '1', 'right roller: strip just right of its centre');
  assert.strictEqual(Number(strip('rl')) + 2, -Number(strip('rr')), 'the strips are mirror images about each roller\'s centre');
});

test('the winning side bounces from just after the last move until the board clears under each piece', () => {
  const svg = render(demoGame(), { perspective: 'Paul Morphy' });
  assert.strictEqual(render(demoGame(), { perspective: 'Paul Morphy' }), svg, 'the same game always bounces the same way');
  const wrapped = [...svg.matchAll(/<g class="bo\d+"><use[^>]*href="#[a-z]([wb])"/g)];
  assert.strictEqual(wrapped.length, 10, "white's ten pieces left on the board bounce");
  assert.ok(wrapped.every((m) => m[1] === 'w'), 'only the winning side bounces');
  const bouncers = [...svg.matchAll(/@keyframes (bo\d+)\{(.*?)\}\}\.\1\{animation:\1 ([\d.]+)s linear/g)];
  assert.strictEqual(bouncers.length, 10);
  const starts = new Set();
  for (const [, name, frames, seconds] of bouncers) {
    const ground = frames.match(/^([\d.,%]+)\{transform:translateY\(0px\)/)[1].split(',').map(parseFloat);
    const air = frames.match(/([\d.,%]+)\{transform:translateY\(-8px\)/)[1].split(',').map(parseFloat);
    const leaves = parseFloat(frames.match(/([\d.]+)%,[\d.]+%\{opacity:0\}/)[1]);
    starts.add(Math.min(...ground.filter((p) => p > 0)));
    assert.ok(air.length >= 7, `${name} keeps bouncing through the end of the replay`);
    assert.ok(((leaves - Math.max(...air.filter((p) => p <= leaves))) / 100) * Number(seconds) < 0.4, `${name} is still bouncing when its square clears`);
  }
  assert.ok(starts.size > 1, 'each piece starts bouncing at its own moment');

  assert.strictEqual(render(demoGame(), { perspective: 'Duke Karl / Count Isouard' }).match(/<g class="bo\d+">/g).length, 10, 'the winner bounces on the loser\'s card too');
  const foolsMate = render({ ...demoGame(), moves: ['f3', 'e5', 'g4', 'Qh4#'], result: '0-1', termination: 'mate' });
  const black = [...foolsMate.matchAll(/<g class="bo\d+"><use[^>]*href="#[a-z]([wb])"/g)];
  assert.strictEqual(black.length, 16);
  assert.ok(black.every((m) => m[1] === 'b'));
  assert.doesNotMatch(render({ ...demoGame(), moves: ['e4', 'e5'], result: '1/2-1/2', termination: 'draw' }), /class="bo\d+"/, 'no one bounces after a draw');
});

test('the losing side sinks and fades as one, and each piece leaves as the board clears under it', () => {
  const mate = render(demoGame());
  const sunk = [...mate.matchAll(/<g class="(sk\d)" transform="translate\(0 7\)" opacity="\.3">(?:<g class="ke"[^>]*>)?<use class="rn"[^>]*href="#[a-z]([wb])"/g)];
  assert.strictEqual(sunk.length, 10, "Black's ten pieces left on the board sink, the toppled king too");
  assert.ok(sunk.every((m) => m[2] === 'b'), 'only the losing side sinks');
  const starts = new Set();
  for (const name of new Set(sunk.map((m) => m[1]))) {
    const frames = mate.match(new RegExp(`@keyframes ${name}\\{(.*?)\\}\\.${name}\\{`))[1];
    starts.add(frames.match(/^0%\{[^}]*\}([\d.]+)%/)[1]);
    assert.match(frames, /%\{transform:translate\(0px,7px\);opacity:0\.3\}/, 'sunk 7px and faded to 30%');
    const clears = mate.match(new RegExp(`@keyframes dg${name.slice(2)}\\{0%\\{opacity:0\\}([\\d.]+)%`))[1];
    assert.ok(frames.includes(`${clears}%{transform:translate(0px,7px);opacity:0}`), `${name} leaves just as its wave of squares clears`);
  }
  assert.strictEqual(starts.size, 1, 'the whole side starts sinking at the same moment');

  const lost = (termination) => render({ ...demoGame(), moves: ['e4', 'e5', 'Nf3'], result: '0-1', termination });
  assert.match(lost('resign'), /<g class="sk\d"[^>]*><use [^>]*href="#kw"[^>]*\/><g transform="translate\(17 0\)"><g class="ke">/, 'the flag sinks with its king');
  for (const termination of ['resign', 'outoftime', 'abandoned']) {
    assert.strictEqual(lost(termination).match(/<g class="sk\d"/g).length, 16, `White's whole side sinks after ${termination}`);
  }
  assert.doesNotMatch(render({ ...demoGame(), moves: ['e4', 'e5'], result: '1/2-1/2', termination: 'draw' }), /class="sk\d"/, 'nobody sinks in a draw');
});

test('in a draw the kings nod to each other and straighten up again', () => {
  const degrees = (svg, name) => svg.match(new RegExp(`@keyframes ${name}\\{(.*?)\\}\\.${name}\\{`))[1].match(/rotate\((-?\d+)deg\)/g).map((r) => Number(r.match(/-?\d+/)[0]));
  const draw = render({ ...demoGame(), moves: demoGame().moves.slice(0, -1), result: '1/2-1/2', termination: 'agreed' });
  assert.match(draw, /<g class="kdw"><use class="rn"[^>]*href="#kw"/);
  assert.match(draw, /<g class="kdb"><use class="rn"[^>]*href="#kb"/);
  const [white, black] = [degrees(draw, 'kdw'), degrees(draw, 'kdb')];
  assert.strictEqual(Math.max(...white), 16, "White's king on c1 leans right, toward Black's on e8");
  assert.strictEqual(Math.min(...black), -16, "Black's king on e8 leans left, toward White's on c1");
  for (const list of [white, black]) {
    assert.strictEqual(list[0], 0, 'upright before the nod');
    assert.strictEqual(list[list.length - 1], 0, 'upright again after it');
  }
  assert.doesNotMatch(draw, /class="(?:bo|sk)\d/, 'nobody bounces or sinks in a draw');
  const sameFile = render({ ...demoGame(), moves: ['e4', 'e5', 'Ke2', 'Ke7', 'Ke1', 'Ke8'], result: '1/2-1/2', termination: 'agreed' });
  assert.strictEqual(Math.min(...degrees(sameFile, 'kdw')), -16, 'kings on the e-file both lean toward the middle of the board');
  assert.strictEqual(Math.min(...degrees(sameFile, 'kdb')), -16);
  assert.doesNotMatch(render(demoGame()), /class="kd[wb]"/, 'no nod after a win');
});

test("crazyhouse: a promoted piece's badge bounces with it", () => {
  const game = normalizeLichess({
    id: 'zhbadge1', variant: 'crazyhouse', speed: 'blitz', status: 'resign', winner: 'white', createdAt: 1700000000000,
    players: { white: { user: { name: 'alice' } }, black: { user: { name: 'bob' } } },
    moves: 'e4 d5 exd5 Nf6 d6 Nc6 dxc7 Bd7 c8=Q e6',
  });
  assert.match(render(game, { perspective: 'alice' }), /<g class="bo\d+"><use[^>]*href="#qw"[^>]*\/><use href="#pw" transform="translate\(22 0\) scale\(\.45\)"\/><\/g>/);
});

test('after a timeout a stopwatch pops up beside the losing king and rings, then sinks with it', () => {
  const lost = (termination) => render({ ...demoGame(), moves: ['e4', 'e5', 'Nf3'], result: '0-1', termination });
  for (const termination of ['outoftime', 'timeout']) {
    const svg = lost(termination);
    assert.match(svg, /<g class="sk\d"[^>]*><g class="ke"><use [^>]*href="#kw"[^>]*\/><\/g><g transform="translate\(17 0\)"><g class="kc"><path [^>]*\/><path [^>]*fill="#6e4a2a"\/><\/g><\/g><\/g>/, 'a brown stopwatch beside the king, inside its side\'s sink');
    assert.match(render({ ...demoGame(), moves: ['e4', 'e5', 'Nf3'], result: '0-1', termination }, { palette: 'dark' }), /<g class="kc"><path [^>]*\/><path [^>]*fill="#5c3e23"\/>/, 'a darker brown in the dark theme');
    const frames = svg.match(/@keyframes kc\{(.*?)\}\.kc\{/)[1];
    assert.match(frames, /^0%\{transform:translate\(0px,7px\)[^}]*rotate\(0deg\)[^}]*;opacity:0\}/, 'hidden until the last move has landed');
    assert.match(frames, /rotate\(-16deg\).*rotate\(16deg\).*rotate\(-16deg\).*rotate\(16deg\)/, 'it rings');
    assert.match(frames, /100%\{transform:translate\(0px,7px\)[^}]*;opacity:0\}$/, 'hidden again for the next replay');
  }
  for (const termination of ['mate', 'resign', 'abandoned']) assert.doesNotMatch(lost(termination), /class="kc"/);
  assert.doesNotMatch(render({ ...demoGame(), result: '1/2-1/2', termination: 'timevsinsufficient' }), /class="kc"/, 'not in a draw');
});

test("after a timeout the banner's second line has a stopwatch before it, centred on the capitals", () => {
  const svg = render({ ...demoGame(), moves: ['e4', 'e5', 'Nf3'], result: '0-1', termination: 'outoftime' });
  const [, left, top, textX, baseline] = svg.match(/<path transform="translate\(([\d.]+) ([\d.]+)\)" d="[^"]*" fill="#656d76"\/><text x="([\d.]+)" y="([\d.]+)" font-size="10" letter-spacing="2" class="m">TIME OUT<\/text>/).map(Number);
  assert.strictEqual(Number((textX - (left + 7 * 1.25)).toFixed(3)), 4, 'a 4px gap between the stopwatch and the text');
  assert.strictEqual(Number((top + 5 - (baseline - 3.7)).toFixed(3)), 0, 'its middle level with the middle of the capitals');
  const groupMiddle = (left + textX + 8 * 'TIME OUT'.length - 2) / 2;
  assert.ok(Math.abs(groupMiddle - 128) <= 0.5, 'the stopwatch and text are centred together under the first line');
  assert.match(render(demoGame()), /<text x="128" y="[\d.]+" text-anchor="middle" font-size="10" letter-spacing="2" class="m">CHECKMATE<\/text>/, 'other endings keep a plain centred line');
});

test('the stopwatch rings until the losing side has finished sinking', () => {
  const svg = render({ ...demoGame(), moves: ['e4', 'e5', 'Nf3'], result: '0-1', termination: 'outoftime' });
  const D = Number(svg.match(/\.kc\{animation:kc ([\d.]+)s/)[1]);
  const sunk = Number(svg.match(/@keyframes sk\d\{0%\{[^}]*\}[\d.]+%\{[^}]*\}([\d.]+)%\{transform:translate\(0px,7px\);opacity:0\.3\}/)[1]);
  const frames = svg.match(/@keyframes kc\{(.*?)\}\.kc\{/)[1];
  const swings = [...frames.matchAll(/([\d.]+)%\{transform:[^}]*rotate\((-?\d+)deg\)[^}]*;opacity:1\}/g)].filter((m) => m[2] !== '0').map((m) => Number(m[1]));
  assert.ok(swings.length >= 12, 'it keeps swinging through the whole fade');
  const lastSwing = Math.max(...swings);
  assert.ok(lastSwing < sunk && ((sunk - lastSwing) / 100) * D < 0.15, 'its last swing comes just before the side has sunk');
  assert.match(frames, new RegExp(`${String(sunk).replace('.', '\\.')}%\\{transform:translate\\(0px,0px\\)[^}]*rotate\\(0deg\\)[^}]*;opacity:1\\}`), 'and it comes to rest just as the side has sunk');
});
