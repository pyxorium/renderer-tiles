// A stand-in host for the video renderer ("Videos"), to try it on this computer without Raku: npm run dev-video, then
// http://127.0.0.1:5250/. It plays the concert's real MUXL media, read from C:\thunderbird-cafe\video-tracks\videos\
// waxahatchee-fruits\ (made there with npm run media; another folder with VIDEO_DIR), and makes the record from it in
// the shape video-tracks' publish-video.mjs writes. The page (host.html) holds the tile in a frame, answers its "ready"
// with the record and its { piece } and { picture } requests as Raku does (each file by its address), and logs what
// the tile asks. ?lat=ms (per file) and ?bw=bytes/s (shared between files sent at once) slow it down like a real
// connection (the owner's, about 300 ms and 1.25 MB/s: claude/video-tile-lessons.md).
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { readFileSync, existsSync } from 'node:fs';
import { join, normalize, extname, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const HERE = dirname(fileURLToPath(import.meta.url));
const TILE = join(HERE, '..', 'tile');
const PORT = Number(process.env.PORT) || 5250;
export const VIDEO_DIR = resolve(process.env.VIDEO_DIR || join(HERE, '..', '..', '..', 'video-tracks', 'videos', 'waxahatchee-fruits'));
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.json': 'application/json' };
const DATA_JS = `const UP = 'tiles-protocol-up-data-', DOWN = 'tiles-protocol-down-data-';
const handlers = [];
export function addDataHandler (h) { if (!handlers.includes(h)) handlers.push(h); }
export function removeDataHandler (h) { const i = handlers.indexOf(h); if (i >= 0) handlers.splice(i, 1); }
window.addEventListener('message', (ev) => { const { action, payload } = ev.data || {}; if (action === DOWN + 'payload') handlers.forEach((h) => h(payload)); });
export function listen () { window.parent.postMessage({ action: UP + 'ready' }, '*'); }
export function sendData (payload) { window.parent.postMessage({ action: UP + 'payload', payload }, '*'); }
`;

const B32 = 'abcdefghijklmnopqrstuvwxyz234567';
export function rawCid(bytes) {
  const d = createHash('sha256').update(bytes).digest();
  const all = Buffer.concat([Buffer.from([1, 0x55, 0x12, 0x20]), d]);
  let out = 'b', buf = 0, bits = 0;
  for (const x of all) { buf = (buf << 8) | x; bits += 8; while (bits >= 5) { bits -= 5; out += B32[(buf >> bits) & 31]; } buf &= (1 << bits) - 1; }
  if (bits) out += B32[(buf << (5 - bits)) & 31];
  return out;
}
const blob = (cid, size, mimeType) => ({ $type: 'blob', ref: { $link: cid }, mimeType, size });

/** The record and its files (by CID), from a video folder made by video-tracks' make-media.mjs. */
export function loadVideo(dir = VIDEO_DIR) {
  const files = new Map();
  const add = (rel, type) => { const b = readFileSync(join(dir, ...rel.split('/'))); const cid = rawCid(b); files.set(cid, b); return blob(cid, b.length, type); };
  const index = JSON.parse(readFileSync(join(dir, 'media', 'index.json'), 'utf8'));
  const v = existsSync(join(dir, 'video.json')) ? JSON.parse(readFileSync(join(dir, 'video.json'), 'utf8')).record : { title: 'A video' };
  const vt = index.tracks.find((t) => t.kind === 'video');
  const size = /^(\d+)x(\d+)/.exec(vt ? vt.detail : '');
  const value = {
    $type: 'cafe.thunderbird.video.track', ...v,
    duration: Math.round(index.duration), ...(size ? { width: Number(size[1]), height: Number(size[2]) } : {}),
    format: 'muxl',
    muxl: {
      index: add('media/index.json', 'application/json'),
      header: add(index.header.path, 'video/mp4'),
      flat: { cid: index.flat.cid, size: index.flat.bytes },
      tracks: index.tracks.map((t) => ({ kind: t.kind, codec: t.codec, init: add(t.init.path, 'video/mp4'), segments: t.segments.map((s) => add(s.path, 'application/octet-stream')) })),
    },
    poster: add('poster.jpg', 'image/jpeg'),
    imageBlob: add('card.jpg', 'image/jpeg'),
    createdAt: '2026-11-28T20:00:00.000Z',
  };
  return { value, files };
}

let video = null;
try { video = loadVideo(); } catch (e) { console.error(`No video media in ${VIDEO_DIR} (${e.message}). Run "npm run media" in C:\\thunderbird-cafe\\video-tracks, or set VIDEO_DIR.`); }

// Bandwidth shared between files sent at once (as the squirrel's loader replica): each active file gets its share,
// in 10 ms steps.
const active = new Set();
async function sendSlowly(res, bytes, bw) {
  const job = { left: bytes.length, at: 0 };
  active.add(job);
  try {
    while (job.left > 0) {
      const share = Math.max(1, Math.floor((bw / 100) / active.size));
      const n = Math.min(share, job.left);
      res.write(bytes.subarray(job.at, job.at + n));
      job.at += n; job.left -= n;
      if (job.left > 0) await new Promise((r) => setTimeout(r, 10));
    }
  } finally { active.delete(job); }
  res.end();
}

export const server = createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  const path = u.pathname;
  if (path === '/') { res.writeHead(200, { 'content-type': TYPES['.html'], 'cache-control': 'no-store' }); return res.end(await readFile(join(HERE, 'host.html'))); }
  if (path === '/.well-known/web-tiles/data.js') { res.writeHead(200, { 'content-type': TYPES['.js'] }); return res.end(DATA_JS); }
  if (path === '/record.json') {
    if (!video) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' }); return res.end(JSON.stringify(video.value));
  }
  if (path.startsWith('/files/')) {
    const b = video && video.files.get(path.slice(7));
    if (!b) { res.writeHead(404); return res.end(); }
    const lat = Number(u.searchParams.get('lat')) || 0, bw = Number(u.searchParams.get('bw')) || 0;
    if (lat) await new Promise((r) => setTimeout(r, lat));
    res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': b.length, 'cache-control': 'no-store' });
    if (bw) return sendSlowly(res, b, bw);
    return res.end(b);
  }
  if (path.startsWith('/tile/')) {
    const file = normalize(join(TILE, path.slice('/tile/'.length) || 'index.html'));
    if (!file.startsWith(TILE)) { res.writeHead(403); return res.end(); }
    try { const b = await readFile(file); res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' }); return res.end(b); }
    catch { /* fall through */ }
  }
  res.writeHead(404); res.end();
});
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  server.listen(PORT, '127.0.0.1', () => console.log(`Video renderer stand-in host: http://127.0.0.1:${PORT}/ (slow like the owner's connection: http://127.0.0.1:${PORT}/?lat=300&bw=1250000)`));
}
