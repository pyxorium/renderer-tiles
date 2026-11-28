// view.js: what the video renderer ("Videos") shows for what its host sent, and the plain rules its player follows
// (claude/muxl-concert-plan.md). No DOM here, so it runs in Node for the tests (test/video.test.mjs); video.js draws it
// and plays it.
//
// The host (Raku, or any page that speaks the tiles spec's data protocol, tp-data) sends one payload:
//   { uri, cid, did, handle, collection, rkey, value }
// value is a cafe.thunderbird.video.track record exactly as stored (lexicon in pyxorium/video-tracks): title, artist,
// album, duration, width, height, format ("muxl"), muxl { index, header, flat { cid, size }, tracks [{ kind, codec,
// init, segments }] }, poster, imageBlob, credits [{ role, name }], links [{ label, url }], recording { date, venue,
// place, … }. Every media file is a blob of the record.
//
// A renderer has no network of its own, so it asks the host for each file it needs:
//   tile → host   { piece: "<blob cid>", from: "<record uri>" }      a media file the record lists (index.json, an init,
//   host → tile   { gotPiece: "<cid>", from, bytes }                  a piece): the host fetches it from the record's
//                 or { gotPiece, from, error }                         account, checks its address and hands the bytes over
//   tile → host   { picture: "<blob cid>", from }                    the poster (as Places' and Tracks' pictures)
//   host → tile   { gotPicture, from, type, bytes }  or  { gotPicture, from, error }
//   tile → host   { link: "https://…", from }                        one of the record's links: the host asks the viewer
//                                                                     before opening it (a tile can't open pages itself)
// The tile checks every file against its address again before using it (the seconds light up on the progress bar).

export const VIDEO = 'cafe.thunderbird.video.track';
export const KINDS = [VIDEO];
export const FORMATS = ['muxl'];
// The looks (CSS only: how the video is shown; the pieces stay the same bytes). The squirrel tile's five.
export const LOOKS = Object.freeze([
  { id: 'original', name: 'Original' },
  { id: 'bw', name: 'Black & white' },
  { id: 'sepia', name: 'Sepia' },
  { id: 'polaroid', name: 'Polaroid' },
  { id: 'noir', name: 'Noir' },
]);
// How many seconds after the one being watched are asked for, together with it (claude/video-tile-lessons.md: the
// piece being watched and the next two, asked for together, kept the squirrel smooth on the owner's connection).
// Listen only fetches only the small audio pieces, so it looks further ahead.
export const AHEAD = Object.freeze({ watch: 2, listen: 4 });
export const PIECE_MAX_BYTES = 1024 * 1024;       // the most the publish script sends per file (and Raku fetches)
export const PICTURE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];

const DID = /^did:(?:plc:[a-z2-7]{24}|web:[a-zA-Z0-9.:%-]{1,200})$/;
const HANDLE = /^(?=.{3,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{0,61}[a-z0-9]$/i;
const NSID = /^[a-zA-Z][a-zA-Z0-9-]{0,62}(?:\.[a-zA-Z0-9-]{1,63}){2,}$/;
const RKEY = /^[A-Za-z0-9._:~-]{1,512}$/;
const CID = /^b[a-z2-7]{20,120}$/;
const CODEC = /^[A-Za-z0-9.+-]{1,64}$/;
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

const str = (s, n) => {
  if (typeof s !== 'string') return '';
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};

/** An https address to link to, or null (never javascript:, data: or http:). */
export function safeLink(u) {
  if (typeof u !== 'string' || u.length > 2000) return null;
  try { const x = new URL(u.trim()); return x.protocol === 'https:' && x.hostname.includes('.') && !x.username && !x.password ? x.href : null; } catch { return null; }
}
/** The host name shown beside a link ("www.redrocksonline.com" → "redrocksonline.com"). */
export const hostOf = (href) => { try { return new URL(href).hostname.replace(/^www\./, ''); } catch { return ''; } };

/** A recording date written out: "2022-05-03" → "May 3, 2022"; "2022-05" → "May 2022"; "2022" → "2022". */
export function longDate(d) {
  const m = /^(\d{4})(?:-(\d{2}))?(?:-(\d{2}))?$/.exec(typeof d === 'string' ? d.trim() : '');
  if (!m) return '';
  const month = m[2] ? MONTHS[Number(m[2]) - 1] : null;
  if (m[2] && !month) return m[1];
  if (m[3]) return `${month} ${Number(m[3])}, ${m[1]}`;
  if (m[2]) return `${month} ${m[1]}`;
  return m[1];
}

/** A time: 80 → "1:20"; 3852 → "1:04:12" (whole seconds, rounded down). */
export function formatTime(s) {
  if (!Number.isFinite(s) || s < 0) s = 0;
  const t = Math.floor(s + 1e-6), h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), x = t % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(x).padStart(2, '0')}` : `${m}:${String(x).padStart(2, '0')}`;
}
/** A size: "35.6 MB", "2.8 MB", "440 KB". */
export function formatSize(n) {
  if (!Number.isFinite(n) || n <= 0) return '';
  if (n < 1048576) return `${Math.round(n / 1024)} KB`;
  const mb = n / 1048576;
  return mb >= 100 ? `${Math.round(mb)} MB` : `${mb.toFixed(1)} MB`;
}

const blobOf = (b, max = Infinity) => {
  const cid = b && typeof b === 'object' && b.ref && typeof b.ref.$link === 'string' ? b.ref.$link : null;
  if (!cid || !CID.test(cid)) return null;
  const size = Number(b.size);
  if (!(Number.isFinite(size) && size > 0) || size > max) return null;
  return { cid, size };
};

/** The record's MUXL section, checked, or null when it isn't one this player can use. */
export function readMuxl(m) {
  if (!m || typeof m !== 'object') return null;
  const index = blobOf(m.index, 2_000_000), header = blobOf(m.header, 10_000_000);
  const flat = m.flat && typeof m.flat === 'object' && typeof m.flat.cid === 'string' && CID.test(m.flat.cid) && Number(m.flat.size) > 0
    ? { cid: m.flat.cid, size: Number(m.flat.size) } : null;
  if (!index || !header || !flat || !Array.isArray(m.tracks) || !m.tracks.length || m.tracks.length > 8) return null;
  const tracks = [];
  for (const t of m.tracks) {
    if (!t || (t.kind !== 'video' && t.kind !== 'audio') || typeof t.codec !== 'string' || !CODEC.test(t.codec)) return null;
    const init = blobOf(t.init, PIECE_MAX_BYTES);
    if (!init || !Array.isArray(t.segments) || !t.segments.length || t.segments.length > 10000) return null;
    const segments = t.segments.map((s) => blobOf(s, PIECE_MAX_BYTES));
    if (segments.some((s) => !s)) return null;
    tracks.push({ kind: t.kind, codec: t.codec, init, segments });
  }
  const n = tracks[0].segments.length;
  if (tracks.some((t) => t.segments.length !== n)) return null;
  if (!tracks.some((t) => t.kind === 'audio')) return null;
  return { index, header, flat, tracks, gops: n };
}

/**
 * What to show for a payload:
 *   { kind: 'video', uri, did, rkey, by, title, artist, where, line, oneLine, duration, width, height, credits: [[role, name]…],
 *     links: [{ label, href, host }…], poster: { cid } | null, format, muxl | null, bytes, audioBytes }
 *   { kind: 'notvideo', collection }   collection: the record's kind, or null when it can't be read
 * muxl is null for a format this player doesn't know (or a MUXL section it can't use): format says which.
 */
export function readVideo(payload) {
  const p = payload && typeof payload === 'object' ? payload : {};
  if (!KINDS.includes(p.collection) || !p.value || typeof p.value !== 'object') {
    return { kind: 'notvideo', collection: typeof p.collection === 'string' && NSID.test(p.collection) ? p.collection : null };
  }
  const v = p.value;
  const did = typeof p.did === 'string' && DID.test(p.did) ? p.did : null;
  const rkey = typeof p.rkey === 'string' && RKEY.test(p.rkey) ? p.rkey : '';
  const by = typeof p.handle === 'string' && HANDLE.test(p.handle) ? `@${p.handle}` : did;
  const title = str(v.title, 300) || rkey || 'Untitled';
  const artist = str(v.artist, 200);
  const rec = v.recording && typeof v.recording === 'object' ? v.recording : {};
  const venue = str(rec.venue, 200), place = str(rec.place, 200), when = longDate(rec.date);
  const duration = Number.isFinite(Number(v.duration)) && Number(v.duration) > 0 ? Number(v.duration) : 0;
  const where = [venue && place ? `${venue}, ${place}` : venue || place, when].filter(Boolean).join(' · ');
  // The card's second line (as the song posts): Waxahatchee · Red Rocks Amphitheatre, Morrison, CO · May 3, 2022 · 1:20
  const line = [artist, venue && place ? `${venue}, ${place}` : venue || place, when, duration ? formatTime(duration) : ''].filter(Boolean).join(' · ');
  // Where one line is needed: "Waxahatchee – Fruits of My Labor (live at Red Rocks Amphitheatre, May 3, 2022)"
  const live = [venue, when].filter(Boolean).join(', ');
  const oneLine = `${artist ? `${artist} – ` : ''}${title}${live ? ` (live at ${live})` : ''}`;

  const credits = [];
  const row = (k, x) => { if (k && x) credits.push([k, x]); };
  row('Band', artist);
  if (Array.isArray(v.credits)) for (const c of v.credits.slice(0, 12)) if (c && typeof c === 'object') row(str(c.role, 64), str(c.name, 256));
  row('Where', venue && place ? `${venue}, ${place}` : venue || place);
  row('When', when);
  row('Recorded on', str(rec.source, 300));
  row('Tour', str(v.album, 256));
  const links = [];
  if (Array.isArray(v.links)) for (const l of v.links.slice(0, 4)) {
    const href = l && safeLink(l.url), label = l && str(l.label, 64);
    if (href && label) links.push({ label, href, host: hostOf(href) });
  }
  const format = typeof v.format === 'string' ? str(v.format, 32) : '';
  const muxl = format === 'muxl' ? readMuxl(v.muxl) : null;
  const poster = blobOf(v.poster, PIECE_MAX_BYTES);
  const sum = (xs) => xs.reduce((n, x) => n + x.size, 0);
  const bytes = muxl ? muxl.tracks.reduce((n, t) => n + t.init.size + sum(t.segments), 0) : 0;
  const audio = muxl ? muxl.tracks.filter((t) => t.kind === 'audio') : [];
  const audioBytes = audio.reduce((n, t) => n + t.init.size + sum(t.segments), 0);
  const w = Number.isInteger(v.width) && v.width > 0 && v.width <= 8192 ? v.width : 0;
  const h = Number.isInteger(v.height) && v.height > 0 && v.height <= 8192 ? v.height : 0;
  return {
    kind: 'video', uri: typeof p.uri === 'string' ? p.uri : '', did, rkey, by, title, artist, where, line, oneLine, duration,
    width: w, height: h, credits, links, poster: poster ? { cid: poster.cid } : null, format, muxl, bytes, audioBytes,
  };
}

/**
 * index.json (fetched as the record's muxl.index blob), checked against the record: the same pieces in the same order
 * (the record is what the host checks addresses against). Returns { duration, starts: [s…], ends: [s…], tracks: [{ kind,
 * mime }] } (the times come from the video track, else the first), or throws with a plain reason.
 */
export function checkIndex(index, muxl) {
  if (!index || typeof index !== 'object' || index.muxl !== 1 || !Array.isArray(index.tracks)) throw new Error("index.json isn't MUXL's");
  if (index.gops !== muxl.gops || index.tracks.length !== muxl.tracks.length) throw new Error("index.json doesn't list the record's pieces");
  const tracks = [];
  for (let i = 0; i < muxl.tracks.length; i++) {
    const a = index.tracks[i], b = muxl.tracks[i];
    if (!a || a.kind !== b.kind || !a.init || a.init.cid !== b.init.cid || !Array.isArray(a.segments) || a.segments.length !== b.segments.length) throw new Error("index.json doesn't list the record's pieces");
    for (let g = 0; g < b.segments.length; g++) {
      const s = a.segments[g];
      if (!s || s.cid !== b.segments[g].cid || !Number.isFinite(s.start) || !(s.duration > 0)) throw new Error(`index.json's piece ${g + 1} isn't the record's`);
    }
    const mime = typeof a.mime === 'string' && /^(video|audio)\/mp4; codecs="[A-Za-z0-9.+-]+"$/.test(a.mime) ? a.mime : `${b.kind}/mp4; codecs="${b.codec}"`;
    tracks.push({ kind: b.kind, mime, segments: a.segments.map((s) => ({ start: s.start, duration: s.duration })) });
  }
  const clock = tracks.find((t) => t.kind === 'video') || tracks[0];
  const starts = clock.segments.map((s) => s.start);
  const ends = clock.segments.map((s) => s.start + s.duration);
  const duration = Math.max(...tracks.map((t) => t.segments.at(-1).start + t.segments.at(-1).duration));
  return { duration, starts, ends, tracks };
}

/** Which second a time falls in (the last piece starting at or before it). */
export function pieceAt(starts, t) {
  let g = 0;
  for (let i = 0; i < starts.length; i++) if (starts[i] <= t + 1e-3) g = i;
  return g;
}

/** The seconds to have in hand at second g: g and the next `ahead`, within the video. */
export function wanted(g, n, ahead) {
  const out = [];
  for (let i = g; i <= Math.min(n - 1, g + ahead); i++) out.push(i);
  return out;
}

/** The track indexes a mode plays: watch, every track; listen, the audio only. */
export function tracksFor(mode, muxl) {
  return muxl.tracks.map((t, i) => (mode === 'listen' && t.kind !== 'audio' ? -1 : i)).filter((i) => i >= 0);
}

/** Why a file couldn't be had, from the host's error word. */
export const PIECE_ERRORS = Object.freeze({
  'not-allowed': "Raku won't fetch this video's files for this tile.",
  'too-many': 'This tab has fetched as many files as it may. Reload it to watch again.',
  'too-big': 'A piece of this video is larger than Raku fetches.',
  changed: "A file on the server doesn't match the video's record.",
  'not-found': "Raku couldn't fetch the video from its account's server.",
  'no-answer': 'No answer from the page showing this tile.',
  mismatch: "A piece didn't match its address, so it isn't played.",
  'cant-play': "This browser can't play this video's pieces.",
});

/** An answer to a piece request: { cid, kind: 'bytes', bytes } or { cid, kind: 'error', error }, or null when it isn't one for `from`. */
export function readPieceAnswer(payload, from) {
  if (!payload || typeof payload !== 'object' || typeof payload.gotPiece !== 'string' || payload.from !== from) return null;
  const cid = payload.gotPiece;
  if (typeof payload.error === 'string') return { cid, kind: 'error', error: PIECE_ERRORS[payload.error] ? payload.error : 'not-found' };
  const b = payload.bytes;
  const ok = b && (b instanceof ArrayBuffer || (typeof b === 'object' && typeof b.byteLength === 'number'));
  if (!ok || b.byteLength > PIECE_MAX_BYTES * 10) return { cid, kind: 'error', error: 'not-found' };
  return { cid, kind: 'bytes', bytes: b };
}

/** An answer to the poster's picture request: { ok, type, bytes } or { ok: false }, or null when it isn't ours. */
export function readPicture(payload, asked) {
  if (!payload || typeof payload !== 'object' || !asked || payload.gotPicture !== asked.cid || payload.from !== asked.from) return null;
  if (typeof payload.error === 'string' || !PICTURE_TYPES.includes(payload.type) || !payload.bytes) return { ok: false };
  return { ok: true, type: payload.type, bytes: payload.bytes };
}

/** The first look: the one chosen before, else Original. */
export const firstLook = (remembered) => (LOOKS.some((l) => l.id === remembered) ? remembered : 'original');

/** The size line under the bar before play: "35.6 MB to watch · 2.9 MB to listen · fetched a second at a time". */
export function sizeLine(view) {
  if (!view.muxl) return '';
  return `${formatSize(view.bytes)} to watch · ${formatSize(view.audioBytes)} to listen · fetched a second at a time`;
}

// ---- opened alone: no host, or a host that sends no record ----
export function rakuLink(uri) { return `https://raku.lexicographer.space/#t=${encodeURIComponent(uri)}&a=0`; }
export const TRY_VIDEOS = Object.freeze([]);      // filled in once the concert's record is published
export const RENDERERS_POST = 'https://thunderbird.cafe/blog/renderer-tiles';
