'use strict';

const { parsePgn } = require('./pgn');

const UA = 'chess-replay-card (+https://github.com/surya6032/chess-replay-card)';
const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);

// Variants the replay engine can play through.
const LICHESS_VARIANTS = ['standard', 'crazyhouse'];

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
    date: g.createdAt ? new Date(g.createdAt) : null,
    moves: (g.moves || '').split(/\s+/).filter(Boolean),
  };
}

/** Latest standard or crazyhouse game for a Lichess user, or a specific game by id. */
async function fetchLichess(username, gameId) {
  if (gameId) {
    const res = await getJson(`https://lichess.org/game/export/${encodeURIComponent(gameId)}?opening=true&clocks=false&evals=false`, { Accept: 'application/json' });
    const game = normalizeLichess(await res.json());
    if (!LICHESS_VARIANTS.includes(game.variant)) {
      throw new Error(`Lichess game "${gameId}" is a ${game.variant} game. Only standard and crazyhouse games are supported.`);
    }
    return game;
  }
  const url = `https://lichess.org/api/games/user/${encodeURIComponent(username)}?max=10&opening=true&clocks=false&evals=false&moves=true`;
  const res = await getJson(url, { Accept: 'application/x-ndjson' });
  const games = (await res.text()).split('\n').filter(Boolean).map((line) => JSON.parse(line));
  const game = games.find((g) => LICHESS_VARIANTS.includes(g.variant) && g.moves && !g.initialFen);
  if (!game) throw new Error(`No recent standard or crazyhouse games found for Lichess user "${username}".`);
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

async function fetchGame({ platform, username, gameId }) {
  if (!username && !gameId) throw new Error('A username is required.');
  if (platform === 'chesscom' || platform === 'chess.com') return fetchChessCom(username);
  return fetchLichess(username, gameId);
}

module.exports = { fetchGame, normalizeLichess, openingFromEcoUrl };
