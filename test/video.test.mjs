// The video renderer, "Videos" (video\tile\, claude/muxl-concert-plan.md): what it shows for what its host sends
// (view.js: the card's lines, the credits and links, the MUXL section read and checked, index.json checked against
// the record), the player's plain rules (which second a time is in, what to have in hand, which tracks Listen only
// plays), the answers to its piece and picture requests, its colours kept in step with the other renderers, its page
// (the data protocol from the host; only piece, picture and link requests sent; no network of its own), and
// publishing it with --video.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  readVideo, readMuxl, checkIndex, pieceAt, wanted, tracksFor, readPieceAnswer, readPicture, firstLook, sizeLine, safeLink,
  longDate, formatTime, formatSize, licenseName, VIDEO, LOOKS, AHEAD, PIECE_ERRORS, PIECE_MAX_BYTES,
} from '../video/tile/view.js';
import { runPublish, ACCOUNT, RESERVED_KEYS } from '../scripts/publish.mjs';
import { VIDEO_TILES, ROOT } from '../scripts/tiles.mjs';
import { createFakePds } from './fake-pds.mjs';

const P = 'did:plc:rqbqpaaluty5v47jwciowpik';
const N = 80;
// Stand-in addresses: base32, no 0, 1, 8 or 9 (as real CIDs).
const cid = (tag, i = 0) => `bafkrei${tag}${'a'.repeat(52 - tag.length - String(i).length)}${String(i).replace(/[0189]/g, (d) => 'wxyz'['0189'.indexOf(d)])}`;
const blob = (c, size, mimeType = 'application/octet-stream') => ({ $type: 'blob', ref: { $link: c }, mimeType, size });
const muxl = (over = {}) => ({
  index: blob(cid('index'), 58000, 'application/json'),
  header: blob(cid('header'), 95000, 'video/mp4'),
  flat: { cid: cid('flat'), size: 36332500 },
  tracks: [
    { kind: 'video', codec: 'avc1.64001f', init: blob(cid('vinit'), 691, 'video/mp4'), segments: Array.from({ length: N }, (_, g) => blob(cid('v', g), 400000 + g)) },
    { kind: 'audio', codec: 'mp4a.40.2', init: blob(cid('ainit'), 620, 'video/mp4'), segments: Array.from({ length: N }, (_, g) => blob(cid('a', g), 37000)) },
  ],
  ...over,
});
const concert = (value = {}, over = {}) => ({
  uri: `at://${P}/${VIDEO}/3n3cvideoaaa2`, cid: 'bafyreirecord', did: P, handle: 'pyxorium.com', collection: VIDEO, rkey: '3n3cvideoaaa2',
  value: { $type: VIDEO, title: 'Fruits of My Labor', artist: 'Waxahatchee', album: 'Saint Cloud tour', durationMs: 80000, width: 1280, height: 720, format: 'muxl', muxl: muxl(),
    poster: blob(cid('poster'), 67000, 'image/jpeg'), imageBlob: blob(cid('card'), 93000, 'image/jpeg'),
    credits: [{ role: 'Written by', name: 'Lucinda Williams' }, { role: 'Opening for', name: 'Jason Isbell and the 400 Unit' }],
    links: [{ label: 'Waxahatchee', url: 'https://www.waxahatchee.com/' }, { label: 'Red Rocks Amphitheatre', url: 'https://www.redrocksonline.com/' }],
    recording: { date: '2022-05-03', venue: 'Red Rocks Amphitheatre', place: 'Morrison, CO', source: 'A phone in the audience' },
    tags: ['event:concert', 'lang:en'], contentRights: { creditLine: 'Filmed by @pyxorium.com from the audience' },
    createdAt: '2026-11-28T20:00:00.000Z', ...value }, ...over,
});
// index.json as make-media.mjs writes it, for the record above.
const indexFor = (m) => ({ muxl: 1, gops: N, duration: 80, tracks: m.tracks.map((t) => ({
  kind: t.kind, codec: t.codec, mime: `${t.kind}/mp4; codecs="${t.codec}"`, init: { cid: t.init.ref.$link },
  segments: t.segments.map((s, g) => ({ cid: s.ref.$link, start: t.kind === 'video' ? g : g * 1.002667, duration: t.kind === 'video' ? 1 : 1.002667 })) })) });

test('the concert: the card\'s lines as the song posts, the one-line name, the credits (names only), two links', () => {
  const v = readVideo(concert());
  assert.equal(v.kind, 'video');
  assert.equal(v.title, 'Fruits of My Labor');
  assert.equal(v.line, 'Waxahatchee · Red Rocks Amphitheatre, Morrison, CO · May 3, 2022 · 1:20');
  assert.equal(v.oneLine, 'Waxahatchee – Fruits of My Labor (live at Red Rocks Amphitheatre, May 3, 2022)');
  assert.equal(v.by, '@pyxorium.com');
  assert.deepEqual(v.credits, [['By', 'Waxahatchee'], ['Written by', 'Lucinda Williams'], ['Opening for', 'Jason Isbell and the 400 Unit'],
    ['Where', 'Red Rocks Amphitheatre, Morrison, CO'], ['When', 'May 3, 2022'], ['Recorded on', 'A phone in the audience'], ['Part of', 'Saint Cloud tour'],
    ['Credit', 'Filmed by @pyxorium.com from the audience']]);
  assert.deepEqual(v.links, [{ label: 'Waxahatchee', href: 'https://www.waxahatchee.com/', host: 'waxahatchee.com' },
    { label: 'Red Rocks Amphitheatre', href: 'https://www.redrocksonline.com/', host: 'redrocksonline.com' }]);
  assert.deepEqual([v.width, v.height, v.duration], [1280, 720, 80]);
  assert.deepEqual(v.poster, { cid: cid('poster') });
  assert.equal(v.muxl.gops, N);
  assert.deepEqual(v.muxl.tracks.map((t) => [t.kind, t.codec, t.segments.length]), [['video', 'avc1.64001f', N], ['audio', 'mp4a.40.2', N]]);
  assert.equal(v.audioBytes, 620 + 37000 * N);
  assert.equal(v.bytes, 691 + 620 + 37000 * N + Array.from({ length: N }, (_, g) => 400000 + g).reduce((a, b) => a + b, 0));
  assert.equal(sizeLine(v), '33.3 MB to watch · 2.8 MB to listen · fetched a second at a time');
});

test('any event, not only music: "By" and "Part of"; the length from durationMs; rights from contentRights', () => {
  const talk = readVideo(concert({ title: 'Why tiles?', artist: 'A. Speaker', album: 'A conference, 2026', durationMs: 1_234_567, credits: [{ role: 'Host', name: 'B. Host' }],
    recording: { date: '2026-10-01', venue: 'A hall', place: 'Somewhere' }, contentRights: { license: 'place.stream.metadata.contentRights#cc-by_4__0', copyrightYear: 2026, copyrightNotice: '© A. Speaker' } }));
  assert.deepEqual(talk.credits.slice(0, 2), [['By', 'A. Speaker'], ['Host', 'B. Host']]);
  assert.ok(talk.credits.some(([k, x]) => k === 'Part of' && x === 'A conference, 2026'));
  assert.ok(talk.credits.some(([k, x]) => k === 'License' && x === 'CC BY 4.0'));
  assert.ok(talk.credits.some(([k, x]) => k === 'Copyright' && x === '© A. Speaker 2026'));
  assert.equal(talk.duration, 1234.567);
  assert.equal(talk.line, 'A. Speaker · A hall, Somewhere · October 1, 2026 · 20:34');
  assert.equal(readVideo(concert({ durationMs: undefined, duration: 80 })).duration, 0, 'the old seconds field is not read');
  assert.equal(licenseName('https://example.org/my-license'), 'https://example.org/my-license');
  assert.equal(licenseName('place.stream.metadata.contentRights#all-rights-reserved'), 'All rights reserved');
});

test('links: https only (no javascript:, http: or a user name), at most four; anything else read carefully', () => {
  const v = readVideo(concert({ links: [{ label: 'x', url: 'javascript:alert(1)' }, { label: 'y', url: 'http://plain.example/' }, { label: 'z', url: 'https://u:p@evil.example/' },
    { label: '', url: 'https://nolabel.example/' }, { label: 'ok', url: 'https://ok.example/a' }, { label: 'fifth', url: 'https://five.example/' }] }, { handle: 'not a handle' }));
  assert.deepEqual(v.links.map((l) => l.label), []);
  assert.equal(v.by, P, 'the DID when the handle is not one');
  assert.equal(safeLink('https://redrocksonline.com'), 'https://redrocksonline.com/');
  const w = readVideo(concert({ links: [{ label: 'ok', url: 'https://ok.example/a' }] }));
  assert.deepEqual(w.links.map((l) => l.href), ['https://ok.example/a']);
  assert.equal(longDate('2022-05'), 'May 2022');
  assert.equal(longDate('2022-13-40'), '2022');
  assert.equal(formatTime(80), '1:20');
  assert.equal(formatTime(3852), '1:04:12');
  assert.equal(formatSize(440 * 1024), '440 KB');
});

test('not a video, another format, a MUXL section it can\'t use', () => {
  assert.deepEqual(readVideo({ collection: 'cafe.thunderbird.audio.track', value: { title: 'A song' } }), { kind: 'notvideo', collection: 'cafe.thunderbird.audio.track' });
  assert.deepEqual(readVideo(null), { kind: 'notvideo', collection: null });
  const webm = readVideo(concert({ format: 'webm', muxl: undefined }));
  assert.equal(webm.kind, 'video');
  assert.equal(webm.format, 'webm');
  assert.equal(webm.muxl, null);
  const bad = (m) => readMuxl(muxl(m));
  assert.ok(readMuxl(muxl()));
  assert.equal(bad({ index: undefined }), null);
  assert.equal(bad({ tracks: [muxl().tracks[0]] }), null, 'no audio track');
  assert.equal(bad({ tracks: [muxl().tracks[0], { ...muxl().tracks[1], segments: muxl().tracks[1].segments.slice(1) }] }), null, 'tracks of different lengths');
  assert.equal(bad({ tracks: [{ ...muxl().tracks[0], segments: [blob(cid('big'), PIECE_MAX_BYTES + 1)] }, muxl().tracks[1]] }), null, 'a piece over 1 MB');
  assert.equal(bad({ tracks: [{ ...muxl().tracks[0], codec: 'avc1"><script>' }, muxl().tracks[1]] }), null, 'a codec string that is not one');
  assert.equal(bad({ tracks: [{ ...muxl().tracks[0], segments: [{ ref: { $link: 'not-a-cid' }, size: 5 }] }, muxl().tracks[1]] }), null);
});

test('index.json is checked against the record: the same pieces in the same order; the times from the video track', () => {
  const m = readMuxl(muxl());
  const t = checkIndex(indexFor(muxl()), m);
  assert.equal(t.starts.length, N);
  assert.deepEqual(t.starts.slice(0, 3), [0, 1, 2]);
  assert.equal(t.ends[N - 1], 80);
  assert.ok(Math.abs(t.duration - 80 * 1.002667) < 1e-6, 'the longer track decides the duration');
  assert.deepEqual(t.tracks.map((x) => x.mime), ['video/mp4; codecs="avc1.64001f"', 'audio/mp4; codecs="mp4a.40.2"']);
  const swapped = indexFor(muxl());
  [swapped.tracks[0].segments[3], swapped.tracks[0].segments[4]] = [swapped.tracks[0].segments[4], swapped.tracks[0].segments[3]];
  assert.throws(() => checkIndex(swapped, m), /piece 4 isn't the record's/);
  assert.throws(() => checkIndex({ ...indexFor(muxl()), gops: 79 }, m), /doesn't list the record's pieces/);
  assert.throws(() => checkIndex({ hello: 1 }, m), /isn't MUXL's/);
  const odd = indexFor(muxl());
  odd.tracks[0].mime = 'video/mp4; codecs="x"><img src=y>';
  assert.equal(checkIndex(odd, m).tracks[0].mime, 'video/mp4; codecs="avc1.64001f"', 'an odd mime string is replaced by one made from the record');
});

test('the player\'s rules: the second a time is in, what to have in hand (watched + 2; Listen only + 4), which tracks', () => {
  const starts = Array.from({ length: N }, (_, g) => g);
  assert.equal(pieceAt(starts, 0), 0);
  assert.equal(pieceAt(starts, 0.99), 0);
  assert.equal(pieceAt(starts, 1), 1);
  assert.equal(pieceAt(starts, 79.9), 79);
  assert.deepEqual(AHEAD, { watch: 2, listen: 4 });
  assert.deepEqual(wanted(0, N, AHEAD.watch), [0, 1, 2]);
  assert.deepEqual(wanted(78, N, AHEAD.watch), [78, 79]);
  assert.deepEqual(wanted(10, N, AHEAD.listen), [10, 11, 12, 13, 14]);
  const m = readMuxl(muxl());
  assert.deepEqual(tracksFor('watch', m), [0, 1]);
  assert.deepEqual(tracksFor('listen', m), [1]);
});

test('answers: a piece\'s bytes or a known error word, only for the record shown; the poster\'s picture', () => {
  const from = `at://${P}/${VIDEO}/3n3cvideoaaa2`;
  const bytes = new ArrayBuffer(8);
  assert.deepEqual(readPieceAnswer({ gotPiece: cid('v', 3), from, bytes }, from), { cid: cid('v', 3), kind: 'bytes', bytes });
  assert.deepEqual(readPieceAnswer({ gotPiece: cid('v', 3), from, error: 'too-many' }, from), { cid: cid('v', 3), kind: 'error', error: 'too-many' });
  assert.equal(readPieceAnswer({ gotPiece: cid('v', 3), from, error: 'whatever' }, from).error, 'not-found');
  assert.equal(readPieceAnswer({ gotPiece: cid('v', 3), from: 'at://someone/else', bytes }, from), null);
  assert.equal(readPieceAnswer({ gotPiece: cid('v', 3), from, bytes: 'nope' }, from).kind, 'error');
  for (const w of ['not-allowed', 'too-many', 'too-big', 'changed', 'not-found', 'no-answer', 'mismatch', 'cant-play']) assert.ok(PIECE_ERRORS[w], w);
  const asked = { cid: cid('poster'), from };
  assert.deepEqual(readPicture({ gotPicture: cid('poster'), from, type: 'image/jpeg', bytes }, asked), { ok: true, type: 'image/jpeg', bytes });
  assert.deepEqual(readPicture({ gotPicture: cid('poster'), from, error: 'too-big' }, asked), { ok: false });
  assert.equal(readPicture({ gotPicture: cid('card'), from, type: 'image/jpeg', bytes }, asked), null);
});

test('the looks: the squirrel tile\'s five, Original first; remembered', () => {
  assert.deepEqual(LOOKS.map((l) => l.id), ['original', 'bw', 'sepia', 'polaroid', 'noir']);
  assert.equal(firstLook('noir'), 'noir');
  assert.equal(firstLook('disco'), 'original');
  assert.equal(firstLook(null), 'original');
  const css = readFileSync(join(ROOT, 'video', 'tile', 'video.css'), 'utf8');
  for (const l of LOOKS.slice(1)) assert.ok(css.includes(`.v.look-${l.id} #video`), l.id);
});

test('its colours are the other renderers\': the :root line is the same', () => {
  const rootOf = (f) => (readFileSync(join(ROOT, f), 'utf8').match(/:root \{[^}]*--accent[^}]*\}/) || [''])[0];
  assert.ok(rootOf('place/tile/place.css'));
  assert.equal(rootOf('video/tile/video.css'), rootOf('place/tile/place.css'));
});

test('the page: off the network; the data protocol from the host; it only asks for pieces, the poster and links', () => {
  const html = readFileSync(join(ROOT, 'video', 'tile', 'index.html'), 'utf8');
  assert.match(html, /http-equiv="Content-Security-Policy" content="[^"]*connect-src 'self'/);
  assert.match(html, /media-src 'self' blob:/);
  assert.match(html, /script-src 'self'/);
  assert.deepEqual([...html.matchAll(/<link rel="modulepreload" href="\.\/([^"]+)"/g)].map((m) => m[1]), ['video.js', 'view.js', 'cid.js']);
  const js = readFileSync(join(ROOT, 'video', 'tile', 'video.js'), 'utf8');
  assert.match(js, /import\('\/\.well-known\/web-tiles\/data\.js'\)/);
  assert.ok(js.indexOf('addDataHandler(onPayload)') < js.indexOf('api.listen()'), 'the handler is added before listen()');
  assert.deepEqual([...new Set([...js.matchAll(/ask\(\{ (\w+):/g)].map((m) => m[1]))].sort(), ['link', 'picture', 'piece']);
  assert.ok(!/fetch\(|XMLHttpRequest|WebSocket|window\.open|target: '_blank'[^)]*\b(href: l)/.test(js.replace(/function fetchFile[^\n]*|fetchFile\(/g, '')), 'no network of its own');
  assert.ok(js.includes('cidFromDigest(await sha256(u8))'), 'every file checked against its address in the tile too');
  for (const f of ['video.js', 'view.js']) assert.ok(!/innerHTML/.test(readFileSync(join(ROOT, 'video', 'tile', f), 'utf8')), `${f}: drawn with DOM calls only`);
  for (const f of [...VIDEO_TILES['video-renderer'].files, ...VIDEO_TILES['video-renderer'].cards]) assert.ok(readFileSync(join(ROOT, 'video', 'tile', f)).length > 0, f);
});

test('--video: one tile from thunderbird.cafe, with its card pictures; it prints the pin for video records', async () => {
  assert.ok(!RESERVED_KEYS.includes('video-renderer'));
  const pds = createFakePds({ did: ACCOUNT, handle: 'thunderbird.cafe' });
  let published = { accounts: { 'thunderbird.cafe': ACCOUNT }, 'track-renderer': { uri: `at://${ACCOUNT}/ing.dasl.masl/3n2sma5syva2d`, cid: 'bafy-tr' } };
  const logs = [];
  const opts = {
    fetchImpl: pds.fetchImpl, log: (s) => logs.push(s), ask: async () => 'y', askHidden: async () => 'right-password',
    readPublished: () => published, writePublished: (o) => { published = o; },
    now: () => '2026-11-28T12:00:00.000Z', tiles: VIDEO_TILES,
  };
  const dry = await runPublish({ ...opts, dryRun: true });
  assert.deepEqual(dry.plan.map((t) => t.id), ['video-renderer']);
  const r = await runPublish(opts);
  assert.equal(r.changed, true);
  const t = published['video-renderer'];
  const value = pds.records.get(`ing.dasl.masl/${t.uri.split('/').pop()}`).value;
  assert.equal(value.tile.name, 'Videos');
  assert.deepEqual(value.tile.sizing, { width: 960, height: 540 });
  assert.deepEqual(Object.keys(value.tile.resources).sort(), ['/', '/banner.png', '/cid.js', '/icon.png', '/video.css', '/video.js', '/view.js']);
  assert.equal(published['track-renderer'].uri, `at://${ACCOUNT}/ing.dasl.masl/3n2sma5syva2d`, 'Tracks\' entry untouched');
  assert.ok(logs.some((l) => l.includes(`RENDERERS ('${VIDEO}'): uri '${t.uri}', cid '${t.cid}'`)), 'it prints the pin for Raku');
});
