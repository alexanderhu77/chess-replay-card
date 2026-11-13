'use strict';

const { parsePgn } = require('./pgn');

// Paul Morphy vs. Duke Karl & Count Isouard, Paris 1858: "the Opera Game".
const OPERA_GAME = `[Event "Paris"]
[White "Paul Morphy"]
[Black "Duke Karl / Count Isouard"]
[Result "1-0"]

1. e4 e5 2. Nf3 d6 3. d4 Bg4 4. dxe5 Bxf3 5. Qxf3 dxe5 6. Bc4 Nf6 7. Qb3 Qe7
8. Nc3 c6 9. Bg5 b5 10. Nxb5 cxb5 11. Bxb5+ Nbd7 12. O-O-O Rd8 13. Rxd7 Rxd7
14. Rd1 Qe6 15. Bxd7+ Nxd7 16. Qb8+ Nxb8 17. Rd8# 1-0`;

function demoGame() {
  const { moves } = parsePgn(OPERA_GAME);
  return {
    source: 'Paris, 1858',
    url: null,
    white: { name: 'Paul Morphy', rating: null },
    black: { name: 'Duke Karl / Count Isouard', rating: null },
    result: '1-0',
    ending: 'White won by checkmate',
    termination: 'mate',
    opening: 'Philidor Defense',
    timeClass: 'Classical',
    clock: null,
    date: new Date(Date.UTC(1858, 10, 2)),
    moves,
  };
}

module.exports = { demoGame, OPERA_GAME };
