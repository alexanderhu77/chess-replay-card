'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { render } = require('../src/render');
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
  assert.doesNotMatch(svg, /Blitz|Crazyhouse|moves</, 'the panel shows no time control, variant or move count');
  assert.match(svg, /8\. P@f7/);
  assert.match(svg, /@keyframes zwp1/, 'the white pawn pocket is animated');
  // 5. exd5: the black pawn flies from d5 to white's pawn pocket, turning white on the way.
  assert.match(svg, /@keyframes fl0\{0%\{transform:translate\(96px,96px\) scale\(1\);opacity:0;/);
  assert.match(svg, /<g class="fl0" opacity="0"><use class="fo0" href="#pb"[^>]*\/><use class="fi0" href="#pw"[^>]*\/><\/g>/);
  // 6. Nxf7 takes another black pawn, which re-uses the same flyer from f7.
  assert.match(svg.match(/@keyframes fl0\{.*?\}\.fl0/)[0], /translate\(160px,32px\) scale\(1\);opacity:1/);
  assert.strictEqual(svg.match(/<g class="fl\d+"/g).length, 3, 'four captures of three kinds share three flyers');
  assert.doesNotMatch(render(demoGame()), /class="fl\d+"/, 'standard games have no flights to a pocket');
  // 8. P@f7: the pawn slides from the pocket, lands on f7 slightly oversized, then settles.
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
  assert.strictEqual(from.match(/fill:#2da44e/g).length, 16, 'ordinary moves stay green');
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
  const start = svg.match(/@keyframes hf\{.*?([\d.]+)%\{opacity:\.5;transform:translate\(128px,0px\)\}/)[1];
  const check = svg.match(/@keyframes ck\{(.*?)\}\.ck/)[1];
  assert.match(check, /\{opacity:\.6;transform:translate\(128px,0px\)\}/, 'e8 turns red after Qxf7+');
  assert.ok(check.includes(`}${start}%{opacity:0}`), 'the red is gone when the king sets off, not when it lands');

  // A check answered without moving the king stays red until the reply lands.
  const blocked = render({ ...game, moves: ['e4', 'd5', 'Bb5+', 'c6'] });
  const blockStart = blocked.match(/@keyframes hf\{.*?([\d.]+)%\{opacity:\.5;transform:translate\(64px,32px\)\}/)[1];
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
  const still = svg.match(/<g transform="translate\(\d+ \d+\)"><use href="#[a-z]{2}"/g).length;
  assert.strictEqual(animated + still, 32, 'every piece is drawn');
  assert.ok(still >= 8, 'pieces that never move have no animation');
  assert.strictEqual(svg.match(/class="mv"/g).length, 1, 'one scrolling strip shows the current move');
  assert.doesNotMatch(svg, /animation-delay/);
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
  assert.match(svg, /@keyframes rk\{0%,[\d.]+%\{opacity:0\}[\d.]+%,100%\{opacity:1\}\}\.rs\{animation:rk [\d.]+s linear forwards\}/);
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
