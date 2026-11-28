// Publishes one renderer tile from thunderbird.cafe. Moved here from C:\thunderbird-cafe\maze-tiles on Nov 20 2026
// (claude/mixtape-3c-track-renderer-notes.md, R3c-5), keeping only the renderers' part of that publish script. Run from
// C:\thunderbird-cafe\renderer-tiles (Node 22, no packages needed), always naming which renderer:
//
//   node scripts/publish.mjs --track --dry-run   show what would be published; ask nothing, write nothing
//   node scripts/publish.mjs --track             publish Tracks if it isn't published yet
//   node scripts/publish.mjs --track --again     publish it again, as a new record (a new address), after a change
//   --place for Places, --signpost for Signposts and --video for Videos the same way
//
// Each publishes one tile, nothing else (the place and signpost records and their lexicons are published from
// maze-tiles). It shows what will be published, asks for a thunderbird.cafe app password (hidden as you type) and once
// more before writing. The tile is always created as a new record (never overwriting); the record and every file are
// read back and checked. What was published is written to published.json (commit it), and the tile's address and record
// CID are printed for RENDERERS in C:\thunderbird-cafe\raku\src\config.js: publish and pin before Raku is pushed.
import readline from 'node:readline';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ROOT, KINDS, THUNDERBIRD_DID, publishFiles, cspOf } from './tiles.mjs';
import { rawCid } from './lib/cid.js';
import { publishTile } from './lib/tile-record.js';

export const ACCOUNT = THUNDERBIRD_DID;     // thunderbird.cafe: every renderer's account
const didOfUri = (uri) => (/^at:\/\/([^/]+)\//.exec(uri || '') || [])[1] || null;
export const PUBLISHED_FILE = join(ROOT, 'published.json');
// The kinds of record the renderers show (their lexicons live in maze-tiles' lexicons\).
export const PLACE = 'cafe.thunderbird.way.place';
export const SIGNPOST = 'cafe.thunderbird.way.signpost';

async function getJson(fetchImpl, url, init) {
  const res = await fetchImpl(url, init);
  const text = await res.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = null; }
  if (!res.ok) {
    const err = new Error((body && (body.message || body.error)) || `Request failed (${res.status})`);
    err.status = res.status; err.error = body && body.error;
    throw err;
  }
  return body;
}

export async function tileToPublish(id, tiles) {
  const files = publishFiles(id, tiles);
  for (const f of files) f.cid = await rawCid(f.bytes);
  const page = new TextDecoder().decode(files.find((f) => f.path === '/').bytes);
  const t = tiles[id];
  return { id, name: t.name, description: t.description, sizing: t.sizing, generator: t.generator, csp: cspOf(page), files,
    ...(t.icon ? { icon: t.icon } : {}), ...(t.screenshot ? { screenshot: t.screenshot } : {}) };
}

// Headings published.json keeps (here, and in maze-tiles' file the renderers' entries came from): never a tile's id.
export const RESERVED_KEYS = ['places', 'signposts', 'lexicons', 'accounts', 'earlier'];

export async function runPublish({ fetchImpl = fetch, ask, askHidden, log = console.log, dryRun = false, again = false, tiles,
  readPublished = () => (existsSync(PUBLISHED_FILE) ? JSON.parse(readFileSync(PUBLISHED_FILE, 'utf8')) : {}),
  writePublished = (o) => writeFileSync(PUBLISHED_FILE, JSON.stringify(o, null, 2) + '\n'),
  now = () => new Date().toISOString() }) {
  if (!tiles) throw new Error('Say which renderer to publish: --place, --signpost, --track or --video.');
  // A tile's id is also its heading in published.json, so it may never be one of the file's own headings (Nov 6: a
  // tile named "places" overwrote the place records' bookkeeping).
  const taken = Object.keys(tiles).filter((id) => RESERVED_KEYS.includes(id));
  if (taken.length) throw new Error(`A tile can't be called ${taken.map((k) => `"${k}"`).join(', ')}: published.json uses that name for its own bookkeeping. Rename it in scripts/tiles.mjs.`);
  const did = ACCOUNT;
  const doc = await getJson(fetchImpl, `https://plc.directory/${did}`);
  const svc = (doc.service || []).find((s) => s.type === 'AtprotoPersonalDataServer' || String(s.id).endsWith('#atproto_pds'));
  if (!svc) throw new Error('Could not find the account\'s server.');
  const pds = String(svc.serviceEndpoint).replace(/\/+$/, '');
  const aka = (doc.alsoKnownAs || []).find((a) => a.startsWith('at://'));
  const handle = aka ? aka.slice(5) : did;

  const published = readPublished() || {};
  const todo = [];
  const here = (id) => published[id] && didOfUri(published[id].uri) === did;      // published, and from this account
  for (const id of Object.keys(tiles)) if (again || !here(id)) todo.push(await tileToPublish(id, tiles));

  log(`\nAccount: @${handle} (${did}), server ${pds}`);
  if (!todo.length) { log('\nAlready published (see published.json). Use --again to publish it as a new record after a change.'); return { changed: false, published }; }
  log('\nThis will publish:');
  for (const t of todo) {
    const kb = t.files.reduce((n, f) => n + f.bytes.length, 0) / 1024;
    log(`  - a new tile "${t.name}": ${t.files.length} files, ${kb.toFixed(1)} KB (${t.files.map((f) => f.path).join(' ')})`);
  }
  log('It is public. Nothing else in the account is touched.');
  if (dryRun) { log('\nDry run: nothing was written.'); return { changed: false, plan: todo }; }

  const password = await askHidden(`\nApp password for @${handle} (hidden): `);
  if (!password) throw new Error('No app password given; nothing was published.');
  const session = await getJson(fetchImpl, `${pds}/xrpc/com.atproto.server.createSession`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier: did, password }),
  });
  if (session.did !== did) throw new Error('That app password belongs to a different account; nothing was published.');
  const auth = { Authorization: `Bearer ${session.accessJwt}` };
  const ok = (await ask('Publish now? [y/N] ')).trim().toLowerCase();
  if (ok !== 'y' && ok !== 'yes') { log('Stopped; nothing was published.'); return { changed: false }; }

  const xrpc = async (nsid, { method, params, body, contentType }) => {
    const url = new URL(`${pds}/xrpc/${nsid}`);
    for (const [k, v] of Object.entries(params || {})) url.searchParams.set(k, v);
    const bytes = body instanceof Uint8Array;
    return getJson(fetchImpl, url.toString(), {
      method, headers: { ...auth, ...(body !== undefined ? { 'Content-Type': bytes ? contentType : 'application/json' } : {}) },
      body: body === undefined ? undefined : bytes ? body : JSON.stringify(body),
    });
  };
  const fetchBlob = async (cid) => {
    const res = await fetchImpl(`${pds}/xrpc/com.atproto.sync.getBlob?did=${encodeURIComponent(did)}&cid=${encodeURIComponent(cid)}`);
    if (!res.ok) throw new Error(`Reading back ${cid} failed (${res.status}).`);
    return new Uint8Array(await res.arrayBuffer());
  };

  // Which account published what: `accounts` (handle → did); each tile's own uri says too.
  const out = { ...published, accounts: { ...(published.accounts || {}), [handle]: did } };
  for (const t of todo) {
    log(`\nPublishing "${t.name}"…`);
    const r = await publishTile({ xrpc, fetchBlob, did, tile: t, now, log });
    out[t.id] = { uri: r.uri, cid: r.cid, manifestCid: r.manifestCid, publishedAt: r.record.createdAt };
    writePublished(out);
    log(`  done: ${r.uri}`);
    log(`  open it: https://raku.lexicographer.space/#t=${encodeURIComponent(r.uri)}&a=0`);
    log(`       or: https://lexicographer.space/@${handle}/${r.rkey}`);
    log(`  for Raku's src/config.js RENDERERS ('${[].concat(tiles[t.id].renderer).join("', '")}'): uri '${r.uri}', cid '${r.cid}'`);
  }
  log('\nPublished, and read back to check.');
  for (const t of todo) if (published[t.id]) log(`The earlier record (${published[t.id].uri}) is still there: delete it in PDSls once Raku's new pin works.`);
  log('Delete this app password (Bluesky: Settings > Privacy and security > App passwords).');
  return { changed: true, published: out };
}

function makeAsk() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  let muted = false;
  const write = rl._writeToOutput.bind(rl);
  rl._writeToOutput = (s) => { if (!muted || s.includes('\n')) write(muted ? '\n' : s); };
  const ask = (q) => new Promise((r) => rl.question(q, r));
  const askHidden = (q) => new Promise((r) => { process.stdout.write(q); muted = true; rl.question('', (a) => { muted = false; r(a.trim()); }); });
  return { ask, askHidden, close: () => rl.close() };
}

// Which renderer the command line names (exactly one).
export function kindOf(args) {
  const named = Object.keys(KINDS).filter((k) => args.includes(k));
  if (named.length !== 1) throw new Error('Say which renderer to publish, one at a time: --place, --signpost, --track or --video.');
  return KINDS[named[0]];
}

if (process.argv[1] && resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase()) {
  const args = process.argv.slice(2);
  let tiles;
  try { tiles = kindOf(args); } catch (err) { console.error(err.message); process.exit(1); }
  const io = makeAsk();
  runPublish({ ask: io.ask, askHidden: io.askHidden, dryRun: args.includes('--dry-run'), again: args.includes('--again'), tiles })
    .catch((err) => { console.error(`\n${err.message}`); process.exitCode = 1; })
    .finally(() => io.close());
}
