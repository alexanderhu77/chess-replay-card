'use strict';

/** Splits a PGN into its header tags and a clean list of SAN moves. */
function parsePgn(pgn) {
  const headers = {};
  const headerRe = /^\s*\[(\w+)\s+"((?:[^"\\]|\\.)*)"\]\s*$/gm;
  let m;
  while ((m = headerRe.exec(pgn))) headers[m[1]] = m[2];

  let body = pgn.replace(/^\s*\[.*\]\s*$/gm, ' ');
  body = body.replace(/\{[^}]*\}/g, ' ');       // comments and clock annotations
  body = body.replace(/;[^\n]*/g, ' ');          // line comments
  while (/\([^()]*\)/.test(body)) body = body.replace(/\([^()]*\)/g, ' '); // variations
  body = body.replace(/\$\d+/g, ' ');            // NAGs

  const moves = body
    .split(/\s+/)
    .map((tok) => tok.replace(/^\d+\.(\.\.)?/, ''))
    .filter((tok) => tok && !/^(1-0|0-1|1\/2-1\/2|\*)$/.test(tok) && !/^\d+\.+$/.test(tok));

  return { headers, moves };
}

module.exports = { parsePgn };
