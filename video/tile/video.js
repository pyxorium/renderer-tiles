// video.js: the video renderer, "Videos" (claude/muxl-concert-plan.md). A web tile that plays one video record
// (cafe.thunderbird.video.track, from pyxorium/video-tracks), its media stored as MUXL pieces, each a blob of the
// record. Raku opens it when someone opens a video's address; any other host that speaks the tiles spec's data
// protocol (tp-data) and answers its requests can use it too. Built from the squirrel tile's player (muxl-tile's
// tile\player.js, claude/muxl-publish-plan.md, claude/video-tile-lessons.md):
//
//   1. load the host's data.js, add a handler, then listen() (the host answers "ready" with the record);
//   2. no record within a few seconds, or no data.js at all: what Videos is;
//   3. the poster through the host's picture request; index.json and both init segments asked for at once as it
//      starts (as the squirrel did), so the first press of play needs only the pieces;
//   4. Stream (Media Source Extensions; ManagedMediaSource on iPhones): the second being watched and the next two,
//      asked for together, on play, after a jump and as it plays; each piece checked against the address the record
//      lists before it's appended, its second lit on the progress bar; the watchdog for Chrome's and Edge's stall;
//   5. Listen only: the same with only the audio pieces (about a tenth of the bytes), the poster in the picture's place;
//   6. the look (five CSS looks, the gear's menu) remembered in the tile's own storage when the browser keeps it;
//   7. Credits: the record's credits and its links, each link opened by the host after it asks the viewer.
// The fetched bytes aren't kept once appended (the browser holds what it buffers): a second the browser let go of is
// asked for again (the host may answer from its own store).
import {
  readVideo, checkIndex, pieceAt, wanted, tracksFor, readPieceAnswer, readPicture, firstLook, sizeLine, formatTime,
  LOOKS, AHEAD, PIECE_ERRORS, VIDEO, RENDERERS_POST,
} from './view.js';
import { cidFromDigest, sha256 } from './cid.js';

const root = document.getElementById('v');
const NO_HOST_MS = 3000;
const PIECE_WAIT_MS = 30000;      // no answer for a piece this long: say so (and try it again when it's next needed)
const PICTURE_WAIT_MS = 10000;
const IDLE_MS = 2500;             // the controls fade after this long without the mouse moving, while playing
const STALL_MS = 500;
const RETRY_MS = 1500;           // a piece the host couldn't fetch is asked for again after this, while it's still needed             // the watchdog: standing still this long with data ahead gets a nudge
const SMALL_PX = 560, TINY_PX = 400;
const LOOK_KEY = 'videos.look';
const MS = globalThis.ManagedMediaSource || globalThis.MediaSource || null;
const IS_MANAGED = Boolean(globalThis.ManagedMediaSource) && MS === globalThis.ManagedMediaSource;

let sendData = null;
let heard = false;
let view = null;          // readVideo's answer for the record shown
let times = null;         // checkIndex's answer once index.json is in
let session = null;       // the current mode's state; replaced on every mode change or new record
let mode = 'watch';
let look = firstLook(remembered(LOOK_KEY));
let dragging = false;
let posterUrl = null, posterAsked = null;
let checked = [];         // per second: a Set of the track indexes whose piece came in and matched its address
const waiting = new Map();   // cid → { resolve, reject, timer }: pieces asked of the host
const early = new Map();     // cid → promise: index.json and the inits, asked for as soon as the record came
export const stats = { asked: [], nudges: 0 };   // for the checks: every piece asked for, in order

function remembered(key) { try { return globalThis.localStorage?.getItem(key) || null; } catch { return null; } }
function remember(key, v) { try { globalThis.localStorage?.setItem(key, v); } catch { /* this visit only */ } }
function el(tag, attrs = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) if (v !== null && v !== undefined && v !== false) e.setAttribute(k, v);
  for (const k of kids) if (k !== null && k !== undefined && k !== '') e.append(k);
  return e;
}
function ask(payload) { try { if (sendData) { sendData(payload); return true; } } catch { /* fall through */ } return false; }

// ---- asking the host for files ----

/** One of the record's files, from the host, checked against its address. Resolves to its bytes (Uint8Array). */
function fetchFile(blob) {
  if (early.has(blob.cid)) { const p = early.get(blob.cid); early.delete(blob.cid); return p; }
  return askFile(blob);
}
function askFile(blob) {
  return new Promise((resolve, reject) => {
    const had = waiting.get(blob.cid);
    if (had) { had.also.push({ resolve, reject }); return; }
    const entry = { also: [{ resolve, reject }], timer: null };
    waiting.set(blob.cid, entry);
    stats.asked.push(blob.cid);
    entry.timer = setTimeout(() => settle(blob.cid, null, 'no-answer'), PIECE_WAIT_MS);
    if (!ask({ piece: blob.cid, from: view.uri })) settle(blob.cid, null, 'no-answer');
  }).then(async (bytes) => {
    const u8 = new Uint8Array(bytes);
    let cid = null;
    try { cid = cidFromDigest(await sha256(u8)); } catch { cid = null; }
    if (cid !== null && (cid !== blob.cid || u8.length !== blob.size)) throw Object.assign(new Error(PIECE_ERRORS.mismatch), { word: 'mismatch' });
    return u8;
  });
}
function settle(cid, bytes, error) {
  const entry = waiting.get(cid);
  if (!entry) return;
  waiting.delete(cid);
  clearTimeout(entry.timer);
  for (const w of entry.also) {
    if (error) w.reject(Object.assign(new Error(PIECE_ERRORS[error] || PIECE_ERRORS['not-found']), { word: error }));
    else w.resolve(bytes);
  }
}
function onPiece(payload) {
  const a = readPieceAnswer(payload, view && view.uri);
  if (!a) return;
  if (a.kind === 'error') settle(a.cid, null, a.error);
  else settle(a.cid, a.bytes, null);
}

// ---- the page ----
let els = null;
function drawVideo() {
  const video = el('video', { id: 'video', playsinline: '', preload: 'auto', 'aria-label': view.oneLine });
  video.disableRemotePlayback = true;
  const poster = el('img', { class: 'poster', alt: '' });
  const veil = el('div', { class: 'veil' });
  const titlebox = el('div', { class: 'titlebox' }, el('b', {}, view.title), view.line ? el('span', {}, view.line) : null);
  const big = el('button', { type: 'button', class: 'big', 'aria-label': 'Play' }, '▶');
  const cells = el('div', { class: 'cells', 'aria-hidden': 'true' });
  const seek = el('input', { type: 'range', class: 'seek', min: '0', max: '1000', step: '1', value: '0', 'aria-label': 'Position' });
  const seconds = el('div', { class: 'seconds' }, cells, el('div', { class: 'played' }), el('div', { class: 'knob' }), seek);
  const play = el('button', { type: 'button', class: 'ctl icon', 'aria-label': 'Play' }, '▶');
  const time = el('span', { class: 'time' }, `0:00 / ${formatTime(view.duration)}`);
  const listen = el('button', { type: 'button', class: 'ctl', 'aria-pressed': 'false', title: 'Listen only: just the sound, about a tenth of the data' },
    el('span', { class: 'long' }, '🎧 Listen only'), el('span', { class: 'short' }, '🎧'));
  const mute = el('button', { type: 'button', class: 'ctl icon volume', 'aria-label': 'Mute' }, '🔊');
  const creditsBtn = el('button', { type: 'button', class: 'ctl', 'aria-expanded': 'false' }, el('span', { class: 'long' }, 'Credits'), el('span', { class: 'short' }, 'ⓘ'));
  const gear = el('button', { type: 'button', class: 'ctl icon', 'aria-haspopup': 'menu', 'aria-expanded': 'false', 'aria-label': 'Look' }, '⚙');
  const note = el('p', { class: 'note' }, sizeLine(view));
  const bar = el('div', { class: 'bar' }, seconds, el('div', { class: 'row' }, play, time, el('span', { class: 'spacer' }), listen, mute, creditsBtn, gear), note);
  const lookButtons = LOOKS.map((l) => el('button', { type: 'button', role: 'menuitemradio', 'data-look': l.id, 'aria-checked': String(l.id === look) },
    el('span', { class: `sw look-${l.id}` }), l.name, el('span', { class: 'tick' }, '✓')));
  const lookmenu = el('div', { class: 'lookmenu', role: 'menu', 'aria-label': 'Look', hidden: '' }, el('h2', {}, 'Look'), ...lookButtons);
  const sheet = el('section', { class: 'sheet', 'aria-label': 'Credits', hidden: '' });
  const stage = el('div', { class: 'stage' }, video, poster, veil, titlebox, big, bar, lookmenu, sheet);
  root.dataset.state = 'video';
  root.className = 'v';
  root.replaceChildren(stage);
  els = { video, poster, big, cells, seek, play, time, listen, mute, creditsBtn, gear, note, bar, lookmenu, lookButtons, sheet };
  document.title = view.oneLine;
  setLook(look);
  drawCredits();
  wire();
  sized();
}

function drawCells() {
  els.cells.replaceChildren();
  const n = view.muxl.gops;
  for (let g = 0; g < n; g++) els.cells.append(el('div', { class: 'cell' }));
  for (let g = 0; g < n; g++) paintCell(g);
}
function paintCell(g, loading = false) {
  const c = els && els.cells.children[g];
  if (!c) return;
  const have = checked[g] || new Set();
  const all = view.muxl.tracks.every((_, i) => have.has(i));
  const aud = view.muxl.tracks.every((t, i) => t.kind !== 'audio' || have.has(i));
  c.className = `cell${c.dataset.bad ? ' bad' : all ? ' ok' : aud && have.size ? ' aud' : loading ? ' loading' : ''}`;
}

function drawCredits() {
  const close = el('button', { type: 'button', class: 'ctl' }, 'Close');
  close.addEventListener('click', () => showCredits(false));
  const dl = el('dl');
  for (const [k, v] of view.credits) dl.append(el('dt', {}, k), el('dd', {}, v));
  const kids = [el('div', { class: 'head' }, el('h2', {}, view.title), close), view.line ? el('p', { class: 'sub' }, view.line) : null, dl];
  if (view.links.length) {
    const links = el('div', { class: 'links' });
    for (const l of view.links) {
      const b = el('button', { type: 'button', title: l.href }, `${l.label} ↗ `, el('small', {}, l.host));
      b.addEventListener('click', () => { if (ask({ link: l.href, from: view.uri })) say(`Asked to open ${l.host}.`); });
      links.append(b);
    }
    kids.push(links, el('p', { class: 'fine' }, 'The page showing this tile asks before opening a link.'));
  }
  if (view.by) kids.push(el('p', { class: 'fine' }, `Shared by ${view.by}`));
  kids.push(el('p', { class: 'fine' }, `Stored as MUXL: ${view.muxl.gops} one-second pieces per track, each checked against its address as it arrives.`));
  els.sheet.replaceChildren(...kids);
}
function showCredits(open) {
  els.sheet.hidden = !open;
  root.classList.toggle('credits-open', open);
  els.creditsBtn.setAttribute('aria-expanded', String(open));
  if (open) { closeLooks(); els.sheet.querySelector('button')?.focus({ preventScroll: true }); wake(); }
  else els.creditsBtn.focus({ preventScroll: true });
}

function say(text, problem = false) {
  if (!els) return;
  els.note.textContent = text;
  els.note.classList.toggle('problem', problem);
}

// ---- states without a video ----
function show(state, ...nodes) { root.dataset.state = state; root.className = 'v'; root.replaceChildren(...nodes); els = null; }
function drawWaiting() { show('waiting', el('p', { class: 'wait' }, 'Waiting for a video…')); }
function drawNoHost() {
  show('nohost',
    el('h1', {}, 'Videos'),
    el('p', {}, el('b', {}, "This is a renderer tile: it plays videos that live in people's own accounts."),
      " It holds no video itself. Open a video's address in Raku, and Raku hands it the video's record; Videos then asks Raku for each second as it's needed, checks every piece against its address, and plays it, or just its sound."),
    el('p', { class: 'small' }, 'It plays ', el('code', {}, VIDEO), ' records stored as MUXL (DASL\'s video pieces). More about renderer tiles: ',
      el('a', { href: RENDERERS_POST, target: '_blank', rel: 'noopener noreferrer' }, 'Renderer tiles on thunderbird.cafe ↗'), '.'));
  document.title = 'Videos';
}
function drawNotVideo(v) {
  show('notvideo', el('h1', {}, "This isn't a video."),
    el('p', {}, v.collection ? `This tile plays videos (${VIDEO} records). It was given a record of another kind (${v.collection}).` : `This tile plays videos (${VIDEO} records). What it was given isn't one.`));
  document.title = 'Videos';
}
function drawUnknownFormat() {
  show('notvideo', el('h1', {}, view.title),
    el('p', {}, view.format && view.format !== 'muxl'
      ? `This video is stored as "${view.format}", which this tile doesn't play yet.`
      : "This video's record doesn't list its pieces in a way this tile can read."));
}

// ---- playing: Media Source Extensions ----

function supported(m) {
  if (!MS) return false;
  return tracksFor(m, view.muxl).every((i) => MS.isTypeSupported(times.tracks[i].mime));
}

function startSession(next, { at = 0, playing = false } = {}) {
  const old = session;
  if (old && old.url) URL.revokeObjectURL(old.url);
  const video = els.video;
  video.pause();
  video.querySelectorAll('source').forEach((s) => s.remove());
  video.removeAttribute('src');
  video.load();
  mode = next;
  root.classList.toggle('listen', next === 'listen');
  els.listen.setAttribute('aria-pressed', String(next === 'listen'));
  const s = { mode: next, tracks: tracksFor(next, view.muxl), appended: new Set(), pending: new Map(), failed: false };
  session = s;
  if (!supported(next)) {
    s.failed = true;
    say(next === 'listen' ? "This browser can't play these pieces one by one (no Media Source Extensions for this sound)." : "This browser can't play these pieces one by one (no Media Source Extensions for this video).", true);
    return;
  }
  const ms = new MS();
  s.ms = ms;
  s.url = URL.createObjectURL(ms);
  if (IS_MANAGED) {
    const source = el('source', { src: s.url, type: 'video/mp4' });
    video.append(source);
    video.load();
  } else {
    video.src = s.url;
  }
  s.ready = new Promise((resolve) => {
    ms.addEventListener('sourceopen', async () => {
      if (s !== session) return resolve(false);
      try {
        ms.duration = times.duration;
        s.buffers = s.tracks.map((i) => ({ i, kind: view.muxl.tracks[i].kind, sb: ms.addSourceBuffer(times.tracks[i].mime), queue: Promise.resolve() }));
        const inits = await Promise.all(s.tracks.map((i) => fetchFile(view.muxl.tracks[i].init)));
        if (s !== session) return resolve(false);
        await Promise.all(s.buffers.map((b, k) => append(s, b, inits[k])));
        if (at > 0) video.currentTime = Math.min(at, times.duration - 0.05);
        resolve(true);
        if (root.classList.contains('started')) { tick(); if (playing) video.play().catch(() => {}); }
      } catch (e) {
        failed(s, e);
        resolve(false);
      }
    }, { once: true });
  });
}

function append(s, b, data) {
  b.queue = b.queue.then(() => new Promise((resolve, reject) => {
    if (s !== session || s.ms.readyState === 'closed') return resolve();
    const done = () => { b.sb.removeEventListener('error', fail); resolve(); };
    const fail = () => { b.sb.removeEventListener('updateend', done); reject(Object.assign(new Error(PIECE_ERRORS['cant-play']), { word: 'cant-play' })); };
    b.sb.addEventListener('updateend', done, { once: true });
    b.sb.addEventListener('error', fail, { once: true });
    try { b.sb.appendBuffer(data); } catch (e) { b.sb.removeEventListener('updateend', done); b.sb.removeEventListener('error', fail); reject(e); }
  }));
  return b.queue;
}

/** Is second g in every buffer? (Probed at the middle of the piece: the video track starts a little late, B-frames.) */
function buffered(s, g) {
  return s.buffers.every((b) => {
    const seg = times.tracks[b.i].segments[g];
    const t = seg.start + seg.duration / 2;
    const r = b.sb.buffered;
    for (let k = 0; k < r.length; k++) if (r.start(k) <= t && t < r.end(k)) return true;
    return false;
  });
}

async function ensure(s, g) {
  if (g < 0 || g >= view.muxl.gops || s !== session || s.failed) return;
  if (!(await s.ready) || s !== session) return;
  if (s.appended.has(g) && buffered(s, g)) return;
  if (s.pending.has(g)) return s.pending.get(g);
  const job = (async () => {
    paintCell(g, true);
    let bufs;
    try {
      bufs = await Promise.all(s.tracks.map(async (i) => {
        const bytes = await fetchFile(view.muxl.tracks[i].segments[g]);
        (checked[g] ||= new Set()).add(i);
        paintCell(g, true);
        return bytes;
      }));
    } catch (e) {
      if (s !== session) return;
      if (e.word === 'mismatch') { const c = els.cells.children[g]; if (c) c.dataset.bad = '1'; failed(s, e); }
      else {
        say(`${e.message} (second ${g + 1}; it's asked for again when it's next needed)`, true);
        // While the video waits on it, nothing else would ask again: try once more in a moment.
        setTimeout(() => { if (s === session) tick(); }, RETRY_MS);
      }
      paintCell(g);
      return;
    }
    if (s !== session) return;
    try {
      await Promise.all(s.buffers.map((b, k) => append(s, b, bufs[k])));
      s.appended.add(g);
      maybeEnd(s);
    } catch (e) {
      failed(s, e);
    }
    paintCell(g);
  })().finally(() => s.pending.delete(g));
  s.pending.set(g, job);
  return job;
}

// Once the last piece is in, say so, or the video never reaches "ended".
function maybeEnd(s) {
  if (!s.appended.has(view.muxl.gops - 1) || s.ms.readyState !== 'open' || s.buffers.some((b) => b.sb.updating)) return;
  try { s.ms.endOfStream(); } catch { /* a later append reopens it */ }
}
function failed(s, e) {
  if (s !== session || s.failed) return;
  s.failed = true;
  say(`Playing stopped: ${e.message}`, true);
}

/** Keep the second being watched and the next few in hand, asked for together (claude/video-tile-lessons.md). */
function tick() {
  const s = session;
  if (!s || s.failed || !root.classList.contains('started')) return;
  const g = pieceAt(times.starts, els.video.currentTime);
  for (const k of wanted(g, view.muxl.gops, AHEAD[s.mode])) ensure(s, k);
}

// The watchdog: Chrome and Edge sometimes don't start again after waiting for data, even with the next piece in; a
// seek to the spot the video is on gets them going (found with the squirrel, Nov 26).
let stallAt = -1, stallSince = 0;
function bufferedAhead(t, by) {
  const r = els.video.buffered;
  for (let k = 0; k < r.length; k++) if (r.start(k) <= t + 0.01 && r.end(k) >= Math.min(t + by, els.video.duration - 0.05)) return true;
  return false;
}
setInterval(() => {
  if (!els || !session) return;
  const v = els.video, t = v.currentTime;
  if (v.paused || v.ended || v.seeking || t !== stallAt) { stallAt = t; stallSince = performance.now(); return; }
  if (performance.now() - stallSince >= STALL_MS && bufferedAhead(t, 0.3)) { stats.nudges += 1; stallSince = performance.now(); v.currentTime = t; }
}, 250);

// ---- controls ----
function begin() {
  if (!root.classList.contains('started')) { root.classList.add('started'); say(''); }
  tick();
}
function togglePlay() {
  if (!times || !session) return;
  const v = els.video;
  begin();
  if (v.paused) v.play().catch(() => {});
  else v.pause();
}
function jump(t) {
  if (!times) return;
  const v = els.video;
  v.currentTime = Math.max(0, Math.min(t, times.duration - 0.05));
  begin();
  updateTime(t);
}
function updateTime(t = els.video.currentTime) {
  if (!times) return;
  const d = times.duration;
  const shown = dragging ? (Number(els.seek.value) / 1000) * d : Math.min(t, d);
  els.time.textContent = `${formatTime(shown)} / ${formatTime(view.duration || d)}`;
  if (!dragging) els.seek.value = String(Math.round((shown / d) * 1000));
  els.seek.setAttribute('aria-valuetext', formatTime(shown));
  root.style.setProperty('--p', `${((shown / d) * 100).toFixed(2)}%`);
}
function setMode(next) {
  if (next === mode || !times) return;
  const v = els.video;
  const at = v.currentTime, playing = !v.paused;
  startSession(next, { at, playing });
  if (next === 'listen') say('Listen only: just the sound pieces are fetched (the picture stays still).');
  else say('');
}

function setLook(next) {
  if (!LOOKS.some((l) => l.id === next)) return;
  for (const l of LOOKS) root.classList.toggle(`look-${l.id}`, l.id === next && l.id !== 'original');
  look = next;
  remember(LOOK_KEY, next);
  if (els) els.lookButtons.forEach((b) => b.setAttribute('aria-checked', String(b.dataset.look === next)));
}
function openLooks() {
  els.lookmenu.hidden = false;
  els.gear.setAttribute('aria-expanded', 'true');
  wake();
  (els.lookButtons.find((b) => b.dataset.look === look) || els.lookButtons[0]).focus({ preventScroll: true });
}
function closeLooks({ focusGear = false } = {}) {
  if (!els || els.lookmenu.hidden) return;
  els.lookmenu.hidden = true;
  els.gear.setAttribute('aria-expanded', 'false');
  if (focusGear) els.gear.focus({ preventScroll: true });
  wake();
}

// The controls fade while playing (after IDLE_MS without the mouse moving); they come back on mouse movement, a tap,
// pause, the end, while dragging, with keyboard focus, or while a menu or the credits are open.
let idleTimer = null, swallowClick = false;
const mayHide = () => els && !els.video.paused && !els.video.ended && !dragging && els.lookmenu.hidden && els.sheet.hidden && !els.bar.querySelector(':focus-visible');
function wake() {
  root.classList.remove('idle');
  clearTimeout(idleTimer);
  if (mayHide()) idleTimer = setTimeout(rest, IDLE_MS);
}
function rest() { clearTimeout(idleTimer); if (mayHide()) root.classList.add('idle'); }

function wire() {
  const { video, big, seek, play, listen, mute, creditsBtn, gear, lookmenu, lookButtons, bar } = els;
  big.addEventListener('click', togglePlay);
  play.addEventListener('click', togglePlay);
  video.addEventListener('click', togglePlay);
  const playState = () => {
    const on = !video.paused && !video.ended;
    play.textContent = on ? '❚❚' : '▶';
    play.setAttribute('aria-label', on ? 'Pause' : 'Play');
    wake();
  };
  for (const ev of ['play', 'pause', 'ended']) video.addEventListener(ev, playState);
  for (const ev of ['timeupdate', 'seeking', 'waiting', 'play']) video.addEventListener(ev, () => { updateTime(); tick(); });
  seek.addEventListener('input', () => {
    dragging = true;
    wake();
    const t = (Number(seek.value) / 1000) * times.duration;
    els.video.currentTime = Math.min(t, times.duration - 0.05);
    begin();
    updateTime(t);
  });
  seek.addEventListener('change', () => { dragging = false; wake(); });
  listen.addEventListener('click', () => setMode(mode === 'listen' ? 'watch' : 'listen'));
  mute.addEventListener('click', () => { video.muted = !video.muted; });
  video.addEventListener('volumechange', () => { mute.textContent = video.muted ? '🔇' : '🔊'; mute.setAttribute('aria-label', video.muted ? 'Unmute' : 'Mute'); });
  creditsBtn.addEventListener('click', () => showCredits(els.sheet.hidden));
  gear.addEventListener('click', () => (lookmenu.hidden ? openLooks() : closeLooks()));
  for (const b of lookButtons) b.addEventListener('click', () => { setLook(b.dataset.look); closeLooks({ focusGear: true }); });
  lookmenu.addEventListener('keydown', (e) => {
    const i = lookButtons.indexOf(document.activeElement);
    if (e.key === 'ArrowDown') { e.preventDefault(); lookButtons[(i + 1) % lookButtons.length].focus(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); lookButtons[(i - 1 + lookButtons.length) % lookButtons.length].focus(); }
  });
  // With the look menu open, a click elsewhere in the tile only closes it.
  root.addEventListener('click', (e) => {
    if (!els || els.lookmenu.hidden || e.target.closest('.lookmenu') || e.target === els.gear) return;
    e.stopPropagation(); e.preventDefault(); closeLooks();
  }, true);
  document.addEventListener('pointermove', (e) => { if (e.pointerType === 'mouse') wake(); });
  root.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse' && mayHide()) { clearTimeout(idleTimer); idleTimer = setTimeout(rest, 600); } });
  // A tap on the faded controls only brings them back.
  root.addEventListener('pointerdown', (e) => { swallowClick = e.pointerType !== 'mouse' && root.classList.contains('idle'); if (e.pointerType !== 'mouse') wake(); }, true);
  root.addEventListener('click', (e) => { if (!swallowClick) return; swallowClick = false; e.stopPropagation(); e.preventDefault(); }, true);
  bar.addEventListener('focusin', wake);
  bar.addEventListener('keydown', wake);
}
document.addEventListener('keydown', (e) => {
  if (!els) return;
  if (e.key === 'Escape') { if (!els.lookmenu.hidden) closeLooks({ focusGear: true }); else if (!els.sheet.hidden) showCredits(false); return; }
  if ((e.key === ' ' || e.key === 'k') && !e.target.closest('button, input')) { e.preventDefault(); togglePlay(); }
  if (e.key === 'ArrowRight' && !e.target.closest('input')) jump(els.video.currentTime + 5);
  if (e.key === 'ArrowLeft' && !e.target.closest('input')) jump(els.video.currentTime - 5);
});

// The small layout by the frame's own size: a tile post's slot in Raku (about 438×246), a phone.
function sized() {
  const w = globalThis.innerWidth || 1000, h = globalThis.innerHeight || 1000;
  root.classList.toggle('is-small', w < SMALL_PX || h < 360);
  root.classList.toggle('is-tiny', w < TINY_PX);
}
globalThis.addEventListener?.('resize', sized);

// ---- the record ----
function forget() {
  for (const cid of [...waiting.keys()]) settle(cid, null, 'no-answer');
  early.clear();
  if (session && session.url) URL.revokeObjectURL(session.url);
  session = null;
  times = null;
  checked = [];
  if (posterUrl) URL.revokeObjectURL(posterUrl);
  posterUrl = posterAsked = null;
  root.classList.remove('started', 'listen', 'idle', 'credits-open');
}

async function onRecord(payload) {
  heard = true;
  forget();
  view = readVideo(payload);
  if (view.kind !== 'video') { drawNotVideo(view); return; }
  if (!view.muxl) { drawUnknownFormat(); return; }
  drawVideo();
  const mine = view;
  // The poster, then index.json and both inits, all asked for at once.
  if (view.poster) {
    posterAsked = { cid: view.poster.cid, from: view.uri };
    if (ask({ picture: posterAsked.cid, from: posterAsked.from })) setTimeout(() => { if (posterAsked && posterAsked.cid === mine.poster.cid) posterAsked = null; }, PICTURE_WAIT_MS);
  }
  const indexP = askFile(view.muxl.index);
  for (const t of view.muxl.tracks) early.set(t.init.cid, askFile(t.init));
  for (const p of early.values()) p.catch(() => {});
  try {
    const index = JSON.parse(new TextDecoder().decode(await indexP));
    if (view !== mine) return;
    times = checkIndex(index, view.muxl);
  } catch (e) {
    if (view !== mine) return;
    say(`This video can't play here: ${e.message}`, true);
    els.big.disabled = true;
    return;
  }
  checked = Array.from({ length: view.muxl.gops }, () => new Set());
  drawCells();
  updateTime(0);
  const listenOk = supported('listen');
  if (!supported('watch')) {
    if (listenOk) { startSession('listen'); say("This browser can't play the picture's pieces here, so it plays the sound only.", true); els.listen.disabled = true; return; }
  }
  startSession('watch');
  if (!listenOk) els.listen.disabled = true;
}
function onPicture(payload) {
  const r = readPicture(payload, posterAsked);
  if (!r) return;
  posterAsked = null;
  if (!r.ok || !els) return;
  posterUrl = URL.createObjectURL(new Blob([r.bytes], { type: r.type }));
  els.poster.src = posterUrl;
  els.video.poster = posterUrl;
  for (const sw of els.lookmenu.querySelectorAll('.sw')) sw.style.backgroundImage = `url("${posterUrl}")`;
}

function onPayload(payload) {
  if (payload && typeof payload === 'object') {
    if (typeof payload.gotPiece === 'string') { onPiece(payload); return; }
    if (typeof payload.gotPicture === 'string') { onPicture(payload); return; }
    if (typeof payload.got === 'string') return;
  }
  onRecord(payload);
}

drawWaiting();
(async () => {
  let api;
  try { api = await import('/.well-known/web-tiles/data.js'); } catch { drawNoHost(); return; }
  sendData = api.sendData;
  api.addDataHandler(onPayload);
  api.listen();
  setTimeout(() => { if (!heard) drawNoHost(); }, NO_HOST_MS);
})();
globalThis.__videos = { stats, get mode() { return mode; }, get checked() { return checked.map((s) => [...s]); } };
