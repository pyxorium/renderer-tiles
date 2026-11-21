// track.js: the track renderer, "Tracks" (claude/mixtape-3c-track-renderer-notes.md, R3c-1 to R3c-9). A web tile that
// plays one song record, ours (cafe.thunderbird.audio.track, from the Foundry's importer) or plyr.fm's (fm.plyr.track),
// with its credits, in the look the listener picks: Jukebox, Reel-to-reel, Oscilloscope (green or rainbow), Aurora
// (Tide, Bloom or Prism; R3c-12) or Plain.
// Raku opens it when someone opens a song's address; any other host that speaks the tiles spec's data protocol
// (tp-data, /.well-known/web-tiles/data.js) can use it too.
//
//   1. load the host's data.js, add a handler, then listen() (the host answers "ready" with the record);
//   2. no record within a few seconds, or no data.js at all: what Tracks is, with two songs to try in Raku (R3c-10:
//      opened alone, in a gallery…);
//   3. the song is fetched only when Play is pressed (R3c-4): sendData({ audio: <blob cid>, from: <record> }); the host
//      answers with progress, then the bytes; they play from a blob: address, so seeking always works. A tile has no
//      network of its own: a host that doesn't answer means the song can't play here;
//   4. a cover, when the record lists one, through the host's picture request (as Places' tile card);
//   5. the look, the scope's colour and Aurora's world are remembered in the tile's own storage when the browser keeps
//      it (R3c-1; all three written together on every change, so one never outlives the others).
import {
  readTrack, readAudioAnswer, readPicture, sizeLine, AUDIO_ERRORS, LOOKS, SCOPE_COLOURS, AURORA_WORLDS, AURORA_CREDIT,
  firstLook, firstColour, firstWorld, formatTime, rakuLink, TRY_SONGS, RENDERERS_POST, TRACK, PLYR,
} from './view.js';
import { createScene, createListener } from './looks.js';
import { createAurora, NB } from './aurora.js';

const root = document.getElementById('track');
const NO_HOST_MS = 3000;
const STALL_MS = 30000;          // no progress from the host for this long: give up and offer Try again
const PICTURE_WAIT_MS = 10000;
const LOOK_KEY = 'tracks.look', COLOUR_KEY = 'tracks.scopeColour', WORLD_KEY = 'tracks.world';
const lessMotion = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

let sendData = null;
let heard = false;
let view = null;
let look = firstLook(remembered(LOOK_KEY), lessMotion);
let colour = firstColour(remembered(COLOUR_KEY));
let world = firstWorld(remembered(WORLD_KEY));

// The player's state for the song shown.
let asked = null;        // the audio asked for: { cid, from, size }
let stall = null;        // the timer that gives up on a silent host
let songUrl = null;      // the song's blob: address once it came
let audio = null;        // its <audio>
let actx = null;         // the Web Audio context (made on the first press of Play)
const listener = createListener();
let coverAsked = null, coverUrl = null;

function remembered(key) { try { return globalThis.localStorage?.getItem(key) || null; } catch { return null; } }
function remember(key, v) { try { globalThis.localStorage?.setItem(key, v); } catch { /* this visit only */ } }
// Every choice written together, whichever changed.
function rememberAll() { remember(LOOK_KEY, look); remember(COLOUR_KEY, colour); remember(WORLD_KEY, world); }

function el(tag, attrs = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) if (v !== null && v !== undefined && v !== false) e.setAttribute(k, v);
  for (const k of kids) if (k !== null && k !== undefined && k !== '') e.append(k);
  return e;
}
function ask(payload) {
  try { if (sendData) sendData(payload); return true; } catch { return false; }
}

// ---- the page ----
const lookBar = el('div', { class: 'looks' });
const seg = el('span', { class: 'seg', role: 'group', 'aria-label': 'Look' });
const pick = el('select', { 'aria-label': 'Look' });
const colourSeg = el('span', { class: 'seg colours', role: 'group', 'aria-label': 'Colour' });
for (const l of LOOKS) {
  const b = el('button', { type: 'button', 'data-look': l.id }, l.name);
  b.addEventListener('click', () => setLook(l.id));
  seg.append(b);
  pick.append(el('option', { value: l.id }, l.name));
}
pick.addEventListener('change', () => setLook(pick.value));
for (const c of SCOPE_COLOURS) {
  const b = el('button', { type: 'button', 'data-colour': c.id }, c.name);
  b.addEventListener('click', () => { colour = c.id; rememberAll(); drawLookBar(); });
  colourSeg.append(b);
}
lookBar.append(el('span', { class: 'lbl' }, 'Look:'), seg, pick, colourSeg);
const sceneBox = el('div', { class: 'scene' });
const canvas = el('canvas', { 'aria-hidden': 'true' });
const glCanvas = el('canvas', { 'aria-hidden': 'true', class: 'gl' });
sceneBox.append(canvas, glCanvas);
const scene = createScene(canvas);
const aurora = createAurora(glCanvas, canvas);
// Under the picture while Aurora shows: its world (buttons on a computer, a menu on a phone) and its credit (R3c-12).
const worldBar = el('div', { class: 'under' });
const worldSeg = el('span', { class: 'seg', role: 'group', 'aria-label': 'World' });
const worldPick = el('select', { 'aria-label': 'World' });
for (const w of AURORA_WORLDS) {
  const b = el('button', { type: 'button', 'data-world': w.id }, w.name);
  b.addEventListener('click', () => setWorld(w.id));
  worldSeg.append(b);
  worldPick.append(el('option', { value: w.id }, w.name));
}
worldPick.addEventListener('change', () => setWorld(worldPick.value));
worldBar.append(el('span', { class: 'world' }, el('span', { class: 'lbl' }, 'World:'), worldSeg, worldPick),
  el('span', { class: 'credit' }, 'Inspired by ', el('a', { href: AURORA_CREDIT.href, target: '_blank', rel: 'noopener noreferrer' }, AURORA_CREDIT.text)));
const card = el('div', { class: 'card-title' });
const player = el('div', { class: 'player-box' });
const credits = el('section', { class: 'credits', 'aria-label': 'Credits' });

function drawLookBar() {
  for (const b of seg.children) b.setAttribute('aria-pressed', String(b.dataset.look === look));
  pick.value = look;
  colourSeg.hidden = look !== 'scope';
  for (const b of colourSeg.children) b.setAttribute('aria-pressed', String(b.dataset.colour === colour));
  root.dataset.look = look;
  sceneBox.hidden = look === 'plain';
  worldBar.hidden = look !== 'aurora';
  for (const b of worldSeg.children) b.setAttribute('aria-pressed', String(b.dataset.world === world));
  worldPick.value = world;
  // Aurora draws on its own WebGL canvas when it can, else on the looks' canvas (its 2D fallback).
  const onGL = look === 'aurora' && aurora.gl;
  glCanvas.hidden = !onGL;
  canvas.hidden = onGL;
  root.dataset.aurora = aurora.gl ? 'webgl' : '2d';
  if (look !== 'plain') requestAnimationFrame(sizeScene);
}
function setLook(id) {
  look = id;
  rememberAll();
  drawLookBar();
}
function setWorld(id) {
  world = id;
  rememberAll();
  drawLookBar();
}
// The picture's size; on a phone Aurora is drawn lighter (half resolution, and 30 frames a second in the loop).
function sizeScene() {
  scene.resize();
  const r = sceneBox.getBoundingClientRect(), dpr = Math.min(2, globalThis.devicePixelRatio || 1);
  aurora.resize(r.width, r.height, root.classList.contains('is-phone') ? 0.5 * dpr : dpr);
}

// ---- states without a song ----
function show(state, ...nodes) {
  root.dataset.state = state;
  root.replaceChildren(...nodes);
}
function drawWaiting() { show('waiting', el('p', { class: 'wait' }, 'Waiting for a song…')); }
// Opened alone (R3c-10): what Tracks is, a still picture of the jukebox, two songs to try in Raku.
function drawNoHost() {
  const pic = el('canvas', { class: 'alone-pic', 'aria-hidden': 'true' });
  const tries = el('ul', { class: 'tries' });
  for (const t of TRY_SONGS) {
    tries.append(el('li', {},
      el('div', {}, el('i', {}, t.title), `, ${t.line}`),
      el('div', { class: 'try-go' },
        el('a', { href: rakuLink(t.uri), target: '_blank', rel: 'noopener noreferrer' }, 'Open in Raku ↗'),
        el('code', { class: 'addr' }, t.uri),
        el('span', { class: 'about' }, t.about))));
  }
  show('nohost',
    pic,
    el('h1', {}, 'Tracks'),
    el('p', { class: 'lead' }, el('b', {}, "This is a renderer tile: it plays songs that live in people's own accounts."),
      " It holds no music itself. Open a song's address in Raku, and Raku hands it the song's record. Tracks then plays it, with its credits, in the look you choose: a jukebox, a reel-to-reel deck, an oscilloscope, an aurora of light, or plain."),
    el('h2', {}, 'Try one:'),
    tries,
    el('p', {}, "Or paste a song's address into Raku's address box."),
    el('p', { class: 'small' }, 'Currently, it plays two kinds of song record: ', el('code', {}, TRACK), " (from the Web Tile Foundry's importer) and ",
      el('code', {}, PLYR), ' (from plyr.fm). More about renderer tiles: ',
      el('a', { href: RENDERERS_POST, target: '_blank', rel: 'noopener noreferrer' }, 'Renderer tiles on thunderbird.cafe ↗'), '.'),
    el('p', { class: 'small' }, 'Aurora is inspired by ', el('a', { href: AURORA_CREDIT.href, target: '_blank', rel: 'noopener noreferrer' }, AURORA_CREDIT.text), '.'));
  drawStill(pic);
}
// The jukebox standing still, in a warm moment of music (as the card pictures).
const STILL = [0.55, 0.7, 0.85, 0.95, 1, 0.9, 0.8, 0.7, 0.85, 0.95, 0.8, 0.65, 0.55, 0.45];
function drawStill(pic) {
  const paint = () => {
    const r = pic.getBoundingClientRect();
    if (!r.width) return;
    const sc = createScene(pic);
    sc.resize(r.width, r.height);
    sc.draw('jukebox', 0, { playing: false, still: true, lessMotion: true, colour: 'green', time: 0, duration: 0,
      bands: (n) => Array.from({ length: n }, (_, i) => STILL[Math.floor((i / n) * STILL.length)]), level: () => 0 });
  };
  requestAnimationFrame(paint);
  if (typeof ResizeObserver === 'function') new ResizeObserver(paint).observe(pic);
}
function drawNotTrack(v) {
  show('nottrack',
    el('h1', {}, "This isn't a song."),
    el('p', {}, v.collection
      ? `This tile plays songs (${TRACK} and ${PLYR} records). It was given a record of another kind (${v.collection}).`
      : `This tile plays songs (${TRACK} and ${PLYR} records). What it was given isn't one.`));
}

// ---- the song ----
function drawTitle() {
  card.replaceChildren();
  if (view.cover && coverUrl) card.append(el('img', { class: 'cover', src: coverUrl, alt: '' }));
  card.append(el('h1', {}, view.title));
  if (view.artist) card.append(el('div', { class: 'band' }, view.artist));
  if (view.where) card.append(el('div', { class: 'where' }, view.where));
  if (view.which) card.append(el('div', { class: 'which' }, view.which));
}

let playBtn = null, seek = null, now = null, total = null, line = null;
function drawPlayer() {
  player.replaceChildren();
  playBtn = seek = now = total = line = null;
  if (view.linkOnly) {
    const box = el('div', { class: 'linkonly' }, el('p', {}, view.source === 'plyr'
      ? "This song's audio is kept on plyr.fm's own storage, not on this account's server, so it can't play here."
      : "This record lists no audio file, so there's nothing to play."));
    if (view.plyrLink) box.append(el('p', {}, el('a', { href: view.plyrLink, target: '_blank', rel: 'noopener noreferrer' }, 'Listen on plyr.fm ↗')));
    player.append(box);
    return;
  }
  const p = el('div', { class: 'player' });
  playBtn = el('button', { type: 'button', class: 'play', 'aria-label': 'Play' }, '▶');
  now = el('span', { class: 'now' }, '0:00');
  seek = el('input', { type: 'range', min: '0', max: String(Math.max(1, Math.round(view.duration))), step: '1', value: '0', 'aria-label': 'Position', disabled: '' });
  total = el('span', { class: 'total' }, view.duration ? formatTime(view.duration) : '');
  line = el('p', { class: 'status' }, sizeLine(view.audio));
  if (view.audio.size > 30 * 1024 * 1024) line.classList.add('warn');
  p.append(playBtn, el('div', { class: 'seek' }, now, seek, total), line);
  player.append(p);
  playBtn.addEventListener('click', onPlay);
  seek.addEventListener('input', () => { if (audio) { audio.currentTime = Number(seek.value); now.textContent = formatTime(audio.currentTime); } });
}

function drawCredits() {
  credits.replaceChildren(el('h2', {}, 'Credits'));
  if (view.credits.length) {
    const dl = el('dl');
    for (const [k, v] of view.credits) dl.append(el('dt', {}, k), el('dd', {}, v));
    credits.append(dl);
  }
  if (view.links.length) {
    const links = el('p', { class: 'links' });
    for (const l of view.links) links.append(el('a', { href: l.href, target: '_blank', rel: 'noopener noreferrer' }, l.text));
    credits.append(links);
  }
  if (view.notes) {
    const d = el('details', {}, el('summary', {}, 'Notes'), el('div', { class: 'notes' }, view.notes));
    credits.append(d);
  }
  if (view.tags.length) {
    const t = el('p', { class: 'tags' });
    for (const x of view.tags) t.append(el('span', {}, x));
    credits.append(t);
  }
  if (view.by) credits.append(el('p', { class: 'by' }, `Shared by ${view.by}`));
}

function drawTrack() {
  show('track', lookBar, sceneBox, worldBar, card, player, credits);
  drawLookBar();
  drawTitle();
  drawPlayer();
  drawCredits();
  document.title = view.title;
}

// ---- playing ----
function say(text, warn = false) {
  if (!line) return;
  line.textContent = text;
  line.classList.toggle('warn', warn);
}
function sayError(word) {
  if (!line) return;
  line.replaceChildren(AUDIO_ERRORS[word] || AUDIO_ERRORS['not-found']);
  line.classList.add('warn');
  if (word === 'not-found' || word === 'no-answer') {
    const again = el('button', { type: 'button', class: 'again' }, 'Try again');
    again.addEventListener('click', () => { asked = null; onPlay(); });
    line.append(' ', again);
  }
  if (playBtn) { playBtn.disabled = false; playBtn.textContent = '▶'; playBtn.setAttribute('aria-label', 'Play'); }
}

function startContext() {
  if (actx) { actx.resume?.(); return; }
  try { const AC = globalThis.AudioContext || globalThis.webkitAudioContext; actx = AC ? new AC() : null; } catch { actx = null; }
}

function onPlay() {
  if (audio) {
    if (audio.paused) { startContext(); audio.play().catch(() => sayError('cant-play')); } else audio.pause();
    return;
  }
  if (asked) return;                      // already fetching
  startContext();                         // made while the press still counts as the listener's
  asked = { cid: view.audio.cid, from: view.uri, size: view.audio.size };
  playBtn.disabled = true;
  say('Fetching…');
  if (!ask({ audio: asked.cid, from: asked.from })) { asked = null; sayError('no-answer'); return; }
  armStall();
}
function armStall() {
  clearTimeout(stall);
  const mine = asked;
  stall = setTimeout(() => { if (asked === mine && !songUrl) { asked = null; sayError('no-answer'); } }, STALL_MS);
}

function onAudio(payload) {
  const a = readAudioAnswer(payload, asked);
  if (!a) return;
  if (a.kind === 'progress') { say(a.pct === null ? 'Fetching…' : `Fetching… ${a.pct}%`); armStall(); return; }
  clearTimeout(stall);
  if (a.kind === 'error') { asked = null; sayError(a.error); return; }
  songUrl = URL.createObjectURL(new Blob([a.bytes], { type: a.type }));
  audio = new Audio();
  audio.preload = 'auto';
  audio.src = songUrl;
  if (actx) {
    try { const src = actx.createMediaElementSource(audio); src.connect(actx.destination); listener.attach(actx, src); } catch { /* plays without the lights */ }
  }
  audio.addEventListener('play', () => { playBtn.textContent = '❚❚'; playBtn.setAttribute('aria-label', 'Pause'); });
  audio.addEventListener('pause', () => { playBtn.textContent = '▶'; playBtn.setAttribute('aria-label', 'Play'); });
  audio.addEventListener('loadedmetadata', () => {
    if (Number.isFinite(audio.duration) && audio.duration > 0) { seek.max = String(Math.round(audio.duration)); total.textContent = formatTime(audio.duration); }
  });
  audio.addEventListener('timeupdate', () => { if (document.activeElement !== seek) seek.value = String(Math.floor(audio.currentTime)); now.textContent = formatTime(audio.currentTime); });
  audio.addEventListener('error', () => sayError('cant-play'));
  playBtn.disabled = false;
  seek.disabled = false;
  say('');
  // A browser may not start the sound by itself after a long download: then it waits for one more press.
  audio.play().catch(() => say('Ready: press ▶ to play.'));
}

// ---- the cover ----
function onPicture(payload) {
  const r = readPicture(payload, coverAsked);
  if (!r) return;
  coverAsked = null;
  if (!r.ok) return;
  coverUrl = URL.createObjectURL(new Blob([r.bytes], { type: r.type }));
  drawTitle();
}

// ---- the record ----
function forget() {
  clearTimeout(stall);
  if (audio) { audio.pause(); audio.removeAttribute('src'); audio.load?.(); }
  if (songUrl) URL.revokeObjectURL(songUrl);
  if (coverUrl) URL.revokeObjectURL(coverUrl);
  asked = songUrl = audio = coverAsked = coverUrl = null;
}

function onPayload(payload) {
  if (payload && typeof payload === 'object') {
    if (typeof payload.audioProgress === 'string' || typeof payload.gotAudio === 'string') { onAudio(payload); return; }
    if (typeof payload.gotPicture === 'string') { onPicture(payload); return; }
    if (typeof payload.got === 'string') return;
  }
  heard = true;
  forget();
  view = readTrack(payload);
  if (view.kind !== 'track') { drawNotTrack(view); document.title = 'Tracks'; return; }
  drawTrack();
  if (view.cover && view.uri) {
    const mine = coverAsked = { cid: view.cover.cid, from: view.uri };
    if (ask({ picture: mine.cid, from: mine.from })) setTimeout(() => { if (coverAsked === mine) coverAsked = null; }, PICTURE_WAIT_MS);
  }
}

// ---- the picture loop: only while a look is showing and the tile is visible ----
let last = performance.now(), auroraTime = 0, auroraLast = 0;
function frame(t) {
  const dt = Math.min(0.1, (t - last) / 1000);
  last = t;
  if (view && view.kind === 'track' && root.dataset.state === 'track') {
    const playing = !!audio && !audio.paused;
    // Aurora keeps the song's recent past whatever the look, so switching to it shows the last seconds.
    aurora.step(dt, listener.bands(NB, playing), playing, world);
    auroraTime += dt * (playing ? 1 : 0.2) * (lessMotion ? 0.3 : 1);
    if (look === 'aurora') {
      if (!root.classList.contains('is-phone') || t - auroraLast >= 33) { auroraLast = t; aurora.draw(world, auroraTime); }
    } else if (look !== 'plain') scene.draw(look, dt, {
      playing, lessMotion, colour,
      time: audio ? audio.currentTime : 0,
      duration: audio && Number.isFinite(audio.duration) ? audio.duration : view.duration,
      bands: (n) => listener.bands(n, playing),
      level: (c) => listener.level(c, playing),
    });
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// The phone look by the tile's own width (R3c-7): the Look switch becomes a small menu.
const narrow = () => root.classList.toggle('is-phone', root.getBoundingClientRect().width < 560);
if (typeof ResizeObserver === 'function') new ResizeObserver(() => { narrow(); if (look !== 'plain') sizeScene(); }).observe(root);
narrow();

drawWaiting();
(async () => {
  let api;
  try { api = await import('/.well-known/web-tiles/data.js'); } catch { drawNoHost(); return; }
  sendData = api.sendData;
  api.addDataHandler(onPayload);
  api.listen();
  setTimeout(() => { if (!heard) drawNoHost(); }, NO_HOST_MS);
})();
