'use strict';

const { parsePgn } = require('./pgn');

const UA = 'chess-replay-card (+https://github.com/surya6032/chess-replay-card)';
const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);

// Variants the replay engine can play through.
const LICHESS_VARIANTS = ['standard', 'crazyhouse'];
// Lichess "perfType" filters that select only games of one variant.
const LICHESS_PERF_TYPES = {
  standard: 'ultraBullet,bullet,blitz,rapid,classical,correspondence',
  crazyhouse: 'crazyhouse',
};

/** Reads the "variant" option: '' or 'any' means every supported variant. */
function wantedVariants(variant) {
  const v = String(variant || '').trim().toLowerCase();
  if (!v || v === 'any' || v === 'all') return LICHESS_VARIANTS;
  if (!LICHESS_VARIANTS.includes(v)) throw new Error(`Unknown variant "${variant}". Use standard, crazyhouse or any.`);
  return [v];
}

async function getJson(url, headers = {}) {
  const res = await fetch(url, { headers: { 'User-Agent': UA, ...headers } });
  if (res.status === 404) throw new Error(`Not found: ${url}`);
  if (!res.ok) throw new Error(`Request to ${url} failed with ${res.status}`);
  return res;
}

const LICHESS_REASONS = {
  mate: 'checkmate',
  resign: 'resignation',
  outoftime: 'time',
  timeout: 'time',
  stalemate: 'stalemate',
  draw: 'agreement',
  insufficientMaterialClaim: 'insufficient material',
  variantEnd: 'variant rules',
};

function normalizeLichess(g, url) {
  const player = (side) => {
    const p = g.players[side] || {};
    const name = p.user ? p.user.name : p.aiLevel ? `Stockfish level ${p.aiLevel}` : 'Anonymous';
    return { name, rating: p.rating || null };
  };
  const result = g.winner === 'white' ? '1-0' : g.winner === 'black' ? '0-1' : '1/2-1/2';
  const reason = LICHESS_REASONS[g.status] || g.status;
  const ending = g.winner ? `${cap(g.winner)} won by ${reason}` : g.status === 'stalemate' ? 'Draw by stalemate' : 'Draw';
  const clock = g.clock ? `${g.clock.initial / 60}+${g.clock.increment}` : null;
  return {
    variant: g.variant || 'standard',
    source: 'lichess.org',
    url: url || `https://lichess.org/${g.id}`,
    white: player('white'),
    black: player('black'),
    result,
    ending,
    termination: g.status,
    opening: g.opening ? g.opening.name : null,
    timeClass: cap(g.speed),
    clock,
    clocks: Array.isArray(g.clocks) && g.clock ? { start: g.clock.initial * 100, increment: g.clock.increment * 100, afterMove: g.clocks } : null,
    date: g.createdAt ? new Date(g.createdAt) : null,
    moves: (g.moves || '').split(/\s+/).filter(Boolean),
  };
}

/**
 * Reads newline-delimited JSON games as they arrive and returns the first one accepted,
 * or null. Lichess sends a list of games slowly, a few dozen a second, and the newest is
 * almost always the one wanted, so the rest of the download is abandoned once it is found.
 */
async function firstGame(res, accept) {
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let pending = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      pending += done ? decoder.decode() : decoder.decode(value, { stream: true });
      const lines = pending.split('\n');
      pending = done ? '' : lines.pop();   // keep a half-received line for the next chunk
      for (const line of lines) {
        if (!line.trim()) continue;
        const game = JSON.parse(line);
        if (accept(game)) return game;
      }
      if (done) return null;
    }
  } finally {
    reader.cancel().catch(() => {});
  }
}

/** Latest standard or crazyhouse game for a Lichess user, or a specific game by id. */
async function fetchLichess(username, gameId, variant) {
  const wanted = wantedVariants(variant);
  if (gameId) {
    const res = await getJson(`https://lichess.org/game/export/${encodeURIComponent(gameId)}?opening=true&clocks=true&evals=false`, { Accept: 'application/json' });
    const game = normalizeLichess(await res.json());
    if (!LICHESS_VARIANTS.includes(game.variant)) {
      throw new Error(`Lichess game "${gameId}" is a ${game.variant} game. Only standard and crazyhouse games are supported.`);
    }
    return game;
  }
  const perf = wanted.length === 1 ? `&perfType=${LICHESS_PERF_TYPES[wanted[0]]}` : '';
  const url = `https://lichess.org/api/games/user/${encodeURIComponent(username)}?max=10&opening=true&clocks=true&evals=false&moves=true${perf}`;
  const res = await getJson(url, { Accept: 'application/x-ndjson' });
  const game = await firstGame(res, (g) => wanted.includes(g.variant) && g.moves && !g.initialFen);
  if (!game) throw new Error(`No recent ${wanted.join(' or ')} games found for Lichess user "${username}".`);
  return normalizeLichess(game);
}

function openingFromEcoUrl(url) {
  if (!url) return null;
  const slug = url.split('/openings/')[1];
  if (!slug) return null;
  const words = [];
  for (const part of slug.split('-')) {
    if (/^\d/.test(part)) break;
    words.push(part);
  }
  return words.join(' ') || null;
}

/** Latest standard game for a Chess.com user. */
async function fetchChessCom(username) {
  const user = encodeURIComponent(username.toLowerCase());
  const archives = await (await getJson(`https://api.chess.com/pub/player/${user}/games/archives`)).json();
  const months = (archives.archives || []).slice().reverse();
  for (const monthUrl of months.slice(0, 3)) {
    const { games = [] } = await (await getJson(monthUrl)).json();
    const game = games.slice().reverse().find((g) => g.rules === 'chess' && g.pgn && !/\[SetUp "1"\]/.test(g.pgn));
    if (!game) continue;
    const { headers, moves } = parsePgn(game.pgn);
    const result = headers.Result || '*';
    const [base, inc] = String(game.time_control || '').split('+');
    const clock = /^\d+$/.test(base) ? `${Number(base) / 60}+${inc || 0}` : null;
    const loser = game.white.result === 'win' ? game.black.result : game.white.result;
    return {
      source: 'chess.com',
      url: game.url,
      white: { name: game.white.username, rating: game.white.rating || null },
      black: { name: game.black.username, rating: game.black.rating || null },
      result,
      ending: headers.Termination || result,
      termination: loser === 'checkmated' ? 'mate' : loser,
      opening: openingFromEcoUrl(headers.ECOUrl),
      timeClass: cap(game.time_class),
      clock,
      date: game.end_time ? new Date(game.end_time * 1000) : null,
      moves,
    };
  }
  throw new Error(`No recent standard games found for Chess.com user "${username}".`);
}

/**
 * A link to the game's own page, opened from the same side of the board as the card:
 * the given player's side, or White's if they did not play in it. Lichess takes the side
 * from the address (/white or /black); other sites get the plain game link.
 */
function gameLink(game, perspective) {
  if (!game.url) return null;
  if (game.source !== 'lichess.org') return game.url;
  const me = String(perspective || '').toLowerCase();
  const asBlack = me !== '' && game.black.name.toLowerCase() === me;
  return `${game.url}/${asBlack ? 'black' : 'white'}`;
}

async function fetchGame({ platform, username, gameId, variant }) {
  if (!username && !gameId) throw new Error('A username is required.');
  if (platform === 'chesscom' || platform === 'chess.com') {
    if (!wantedVariants(variant).includes('standard')) throw new Error('Only standard games are supported on Chess.com.');
    return fetchChessCom(username);
  }
  return fetchLichess(username, gameId, variant);
}

module.exports = { fetchGame, firstGame, gameLink, wantedVariants, normalizeLichess, openingFromEcoUrl };
