// A browser check of the video renderer, "Videos" (video\tile\, claude/muxl-concert-plan.md), through its stand-in
// host (video\dev\serve.mjs: the tile in a frame, answering "ready" with the concert's record and every { piece } and
// { picture } request from the real MUXL media, as Raku does): the card's lines and the seconds, nothing but index.json,
// the inits and the poster before play; on play the second watched and the next two asked for together; every piece
// checked (a changed one refused and marked, a missing one asked for again later); frame by frame at the owner's speed
// (300 ms a file, 1.25 MB/s shared); a jump; Listen only (audio pieces only, the poster in the picture's place, the
// time kept) and back; the five looks, remembered; the credits and a link asked of the host; to the end; not a video,
// another format, opened alone; the post slot's small layout with the top right left clear; no errors.
// Run in the build chat: node test/browser/check_video.mjs [folder for screenshots]   (needs Playwright, and the media:
// VIDEO_DIR, default C:\thunderbird-cafe\video-tracks\videos\waxahatchee-fruits, made there with npm run media)
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const require = createRequire(import.meta.url);
const load = (name) => { for (const p of [name, path.join(ROOT, '..', 'web-tile-foundry', 'node_modules', name), `/opt/npm-tools/node_modules/${name}`]) { try { return require(p); } catch {} } throw new Error(`${name} not found`); };
const { chromium } = load('playwright');
const SHOTS = process.argv[2] || path.join(ROOT, 'shots');
mkdirSync(SHOTS, { recursive: true });
const PORT = 5297;
const HOST = `http://127.0.0.1:${PORT}/`;
const SLOW = 'lat=300&bw=1250000';     // the owner's connection (claude/video-tile-lessons.md)

const server = spawn(process.execPath, [path.join(ROOT, 'video', 'dev', 'serve.mjs')], { env: { ...process.env, PORT: String(PORT) }, stdio: ['ignore', 'pipe', 'inherit'] });
await new Promise((ok) => server.stdout.on('data', (d) => { if (String(d).includes('stand-in host')) ok(); }));

let pass = 0, fail = 0;
const check = (name, cond, detail = '') => { if (cond) { pass++; console.log(`PASS ${name}`); } else { fail++; console.log(`FAIL ${name}${detail ? `  [${detail}]` : ''}`); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
const errors = [];
async function open(ctx, query = '', w = 'wide') {
  const page = await ctx.newPage();
  page.on('console', (m) => { if (m.type() === 'error' && !/favicon/.test(m.text())) errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(`${HOST}?w=${w}${query ? `&${query}` : ''}`);
  const frame = async () => { for (let i = 0; i < 100; i++) { const f = page.frames().find((x) => /\/tile\/index\.html/.test(x.url())); if (f) return f; await sleep(50); } return null; };
  const f = await frame();
  // presented frames, in the tile (requestVideoFrameCallback), for the frame-by-frame check
  const until = async (fn, ms = 8000) => { const end = Date.now() + ms; while (Date.now() < end) { try { const v = await f.evaluate(fn); if (v) return v; } catch {} await page.waitForTimeout(60); } return null; };
  return { page, f, until };
}
const cells = (f) => f.evaluate(() => [...document.querySelectorAll('.cell')].map((c) => c.className.replace('cell', '').trim() || '.'));
const asked = (page) => page.evaluate(() => window.__asked.map((p) => Object.keys(p)[0] + (p.piece ? `:${p.piece}` : '')));
const click = (f, sel) => f.evaluate((s) => document.querySelector(s).click(), sel);
const ctl = (f, i) => f.evaluate((i) => document.querySelectorAll('.bar .ctl')[i].click(), i);   // 0 play, 1 listen, 2 mute, 3 credits, 4 gear

try {
  const ctx = await browser.newContext({ viewport: { width: 1300, height: 760 } });
  let { page, f, until } = await open(ctx);
  const record = await page.evaluate(() => fetch('/record.json').then((r) => r.json()));
  const vs = record.muxl.tracks.find((t) => t.kind === 'video').segments.map((s) => s.ref.$link);
  const as = record.muxl.tracks.find((t) => t.kind === 'audio').segments.map((s) => s.ref.$link);
  const second = (cid) => { const i = vs.indexOf(cid); return i >= 0 ? i : as.indexOf(cid); };

  // ---- the record, before play ----
  check('the record is shown', await until(() => document.getElementById('v').dataset.state === 'video'));
  check('the title and the card\'s line', (await f.evaluate(() => document.querySelector('.titlebox').innerText)).replace(/\s+/g, ' ') === 'Fruits of My Labor Waxahatchee · Red Rocks Amphitheatre, Morrison, CO · May 3, 2022 · 1:20');
  check('80 seconds on the progress bar, none lit yet', await until(() => document.querySelectorAll('.cell').length === 80) && (await cells(f)).every((c) => c === '.'));
  check('the poster, from the host\'s picture request', await until(() => document.querySelector('.poster').src.startsWith('blob:') && document.querySelector('.poster').naturalWidth === 960));
  await page.waitForTimeout(600);
  const before = await asked(page);
  const pieces = before.filter((a) => a.startsWith('piece:')).map((a) => a.slice(6));
  check('before play: only index.json and both inits asked for (no seconds)', pieces.length === 3 && pieces.includes(record.muxl.index.ref.$link) && record.muxl.tracks.every((t) => pieces.includes(t.init.ref.$link)), JSON.stringify(before));
  check('...asked for at once, with the poster', before.length === 4 && before.includes('picture'));
  const mbOf = (tracks) => (tracks.reduce((n, t) => n + t.init.size + t.segments.reduce((m, x) => m + x.size, 0), 0) / 1048576).toFixed(1);
  const sizeWords = `${mbOf(record.muxl.tracks)} MB to watch · ${mbOf(record.muxl.tracks.filter((t) => t.kind === 'audio'))} MB to listen · fetched a second at a time`;
  check(`the size line: what it would take to watch, and to listen ("${sizeWords}")`, (await f.evaluate(() => document.querySelector('.note').textContent)) === sizeWords);
  check('the time reads 0:00 / 1:20', (await f.evaluate(() => document.querySelector('.time').textContent)) === '0:00 / 1:20');
  await page.locator('#f').screenshot({ path: path.join(SHOTS, 'video-before.png') });

  // ---- play (fast host) ----
  await click(f, '.big');
  check('it plays', await until(() => document.getElementById('video').currentTime > 1.5));
  const tl = await page.evaluate(() => window.__timeline);
  const seg = tl.filter((x) => vs.includes(x.cid) || as.includes(x.cid));
  const firstSix = seg.slice(0, 6);
  check('on play: seconds 1 to 3 (picture and sound) asked for together', firstSix.length === 6 && firstSix.every((x) => second(x.cid) <= 2) && (firstSix.at(-1).asked - firstSix[0].asked) < 100, JSON.stringify(firstSix.map((x) => [second(x.cid), x.asked])));
  check('the seconds light up as their pieces are checked', await until(() => [...document.querySelectorAll('.cell')].slice(0, 2).every((c) => c.classList.contains('ok'))));
  check('...and only the ones fetched', (await cells(f)).slice(10).every((c) => c === '.'));
  check('the tile asks only for pieces of this record', (await page.evaluate(() => window.__asked.every((p) => p.from && p.from.startsWith('at://did:plc:rqbqpaaluty5v47jwciowpik/cafe.thunderbird.video.track/')))));
  check('the controls fade while it plays', await until(() => document.getElementById('v').classList.contains('idle'), 5000));
  await page.mouse.move(400, 300); await page.mouse.move(420, 320);
  check('...and come back with the mouse', await until(() => !document.getElementById('v').classList.contains('idle'), 2000));

  // ---- a jump ----
  await f.evaluate(() => { const s = document.querySelector('.seek'); s.value = '500'; s.dispatchEvent(new Event('input', { bubbles: true })); s.dispatchEvent(new Event('change', { bubbles: true })); });
  check('a jump to the middle plays from there', await until(() => { const v = document.getElementById('video'); return v.currentTime > 41 && !v.paused; }));
  const afterJump = (await page.evaluate(() => window.__timeline)).filter((x) => vs.includes(x.cid) || as.includes(x.cid)).map((x) => second(x.cid));
  check('...fetching the second jumped to and the two after it, not the ones skipped', [40, 41, 42].every((g) => afterJump.includes(g)) && !afterJump.includes(20), JSON.stringify(afterJump));
  check('the knob follows', parseFloat(await f.evaluate(() => document.getElementById('v').style.getPropertyValue('--p'))) > 50);

  // ---- Listen only ----
  const tBefore = await f.evaluate(() => document.getElementById('video').currentTime);
  const nBefore = (await page.evaluate(() => window.__timeline.length));
  await ctl(f, 1);
  check('Listen only: pressed, the poster in the picture\'s place, the note says so', await until(() => document.getElementById('v').classList.contains('listen') && getComputedStyle(document.querySelector('.poster')).display !== 'none' && document.querySelectorAll('.bar .ctl')[1].getAttribute('aria-pressed') === 'true'));
  check('...it keeps playing from where it was', await until(() => { const v = document.getElementById('video'); return !v.paused && v.currentTime > 0; }) && Math.abs((await f.evaluate(() => document.getElementById('video').currentTime)) - tBefore) < 3);
  await page.waitForTimeout(2500);
  const listenAsked = (await page.evaluate(() => window.__timeline)).slice(nBefore).map((x) => x.cid);
  const inits = record.muxl.tracks.map((t) => t.init.ref.$link);
  check('...and asks only for sound pieces (and the sound\'s init)', listenAsked.length > 0 && listenAsked.every((c) => as.includes(c) || c === inits[1]) && !listenAsked.some((c) => vs.includes(c)), JSON.stringify(listenAsked.map((c) => [vs.includes(c) ? 'v' : as.includes(c) ? 'a' : 'i', second(c)])));
  check('...four seconds ahead', listenAsked.filter((c) => as.includes(c)).length >= 5);
  check('...those seconds lit dimmer (sound only)', (await cells(f)).some((c) => c === 'aud'));
  await page.locator('#f').screenshot({ path: path.join(SHOTS, 'video-listen.png') });
  await ctl(f, 1);
  check('back to the picture: plays on, picture pieces asked again', await until(() => !document.getElementById('v').classList.contains('listen') && !document.getElementById('video').paused && document.getElementById('video').videoWidth === 1280));

  // ---- looks ----
  await ctl(f, 4);
  check('the gear opens the look menu with the five looks', await until(() => !document.querySelector('.lookmenu').hidden) && (await f.evaluate(() => document.querySelectorAll('.lookmenu button').length)) === 5);
  check('...the swatches show the poster', await f.evaluate(() => document.querySelector('.lookmenu .sw').style.backgroundImage.includes('blob:')));
  await f.evaluate(() => document.querySelector('.lookmenu [data-look="noir"]').click());
  check('Noir applied, the menu closed', await until(() => document.getElementById('v').classList.contains('look-noir') && document.querySelector('.lookmenu').hidden));
  check('...the filter is on the video', /grayscale/.test(await f.evaluate(() => getComputedStyle(document.getElementById('video')).filter)));
  await page.locator('#f').screenshot({ path: path.join(SHOTS, 'video-noir.png') });

  // ---- credits and a link ----
  await f.evaluate(() => document.getElementById('video').pause());
  await ctl(f, 3);
  check('Credits open over the video', await until(() => !document.querySelector('.sheet').hidden));
  const sheet = (await f.evaluate(() => document.querySelector('.sheet').innerText)).replace(/\s+/g, ' ');
  check('...the credits, names only, worded for any event (By, Part of) and the credit line', ['By Waxahatchee', 'Written by Lucinda Williams', 'Opening for Jason Isbell and the 400 Unit', 'When May 3, 2022', 'Part of Saint Cloud tour', 'Credit Filmed by @pyxorium.com from the audience', 'Shared by @pyxorium.com'].every((s) => sheet.includes(s)), sheet);
  check('...the two links, as buttons with their sites', (await f.evaluate(() => [...document.querySelectorAll('.sheet .links button')].map((b) => b.innerText.replace(/\s+/g, ' ')))).join('|') === 'Waxahatchee ↗ waxahatchee.com|Red Rocks Amphitheatre ↗ redrocksonline.com');
  await page.locator('#f').screenshot({ path: path.join(SHOTS, 'video-credits.png') });
  await f.evaluate(() => document.querySelectorAll('.sheet .links button')[1].click());
  check('a link is asked of the host (which asks the viewer first)', await page.evaluate(() => window.__links.join()) === 'https://www.redrocksonline.com/');
  check('...no link the tile opens itself', (await f.evaluate(() => document.querySelectorAll('.sheet a[href]').length)) === 0);
  await page.keyboard.press('Escape');
  check('Esc closes the credits', await until(() => document.querySelector('.sheet').hidden));

  // ---- to the end ----
  await f.evaluate(() => { const v = document.getElementById('video'); v.currentTime = 76.5; v.play(); });
  check('it plays to the end ("ended")', await until(() => document.getElementById('video').ended, 12000));
  check('...the last second lit', (await cells(f)).at(-1) === 'ok');

  // ---- the look remembered ----
  await page.close();
  ({ page, f, until } = await open(ctx));
  check('the look is remembered (the tile\'s own storage, here)', await until(() => document.getElementById('v').classList.contains('look-noir')));
  await f.evaluate(() => localStorage.removeItem('videos.look'));
  await page.close();

  // ---- frame by frame at the owner's speed, in a fresh context ----
  const slowCtx = await browser.newContext({ viewport: { width: 1300, height: 760 } });
  ({ page, f, until } = await open(slowCtx, SLOW));
  await until(() => document.querySelectorAll('.cell').length === 80, 15000);
  await page.waitForTimeout(1500);   // index.json and the inits in
  await f.evaluate(() => {
    window.__frames = [];
    const v = document.getElementById('video');
    const onFrame = (now, meta) => { window.__frames.push({ now, t: meta.mediaTime }); v.requestVideoFrameCallback(onFrame); };
    v.requestVideoFrameCallback(onFrame);
    window.__pressed = performance.now();
    document.querySelector('.big').click();
  });
  await until(() => document.getElementById('video').currentTime > 15, 30000);
  const fr = await f.evaluate(() => ({ frames: window.__frames, pressed: window.__pressed }));
  const firstFrame = fr.frames.find((x) => x.t > 0.1);
  const startMs = firstFrame ? Math.round(firstFrame.now - fr.pressed) : null;
  const gaps = [];
  for (let i = 1; i < fr.frames.length; i++) if (fr.frames[i].t > 1) gaps.push(fr.frames[i].now - fr.frames[i - 1].now);
  const big = gaps.filter((g) => g > 150), mid = gaps.filter((g) => g > 60);
  check(`at the owner's speed: moving within 3 s of pressing play (${startMs} ms; three seconds of 440 KB pieces)`, startMs !== null && startMs < 3000, String(startMs));
  check(`...after the first second, no presented-frame gap over 150 ms, at most two over 60 ms (${gaps.length} frames; ${big.length} over 150, ${mid.length} over 60)`, gaps.length > 300 && big.length === 0 && mid.length <= 2, JSON.stringify(mid.map((g) => Math.round(g))));
  check('...the watchdog didn\'t need to nudge it', (await f.evaluate(() => globalThis.__videos.stats.nudges)) === 0);
  await page.close();
  await slowCtx.close();

  // ---- a changed piece, a missing one ----
  ({ page, f, until } = await open(ctx, 's=concert&a=bad5'));
  await until(() => document.querySelectorAll('.cell').length === 80);
  await click(f, '.big');
  await until(() => document.getElementById('video').currentTime > 0.3);
  await f.evaluate(() => { const v = document.getElementById('video'); v.currentTime = 5.2; });
  check('a piece that doesn\'t match its address: its second marked, the note says so', await until(() => document.querySelectorAll('.cell')[5].classList.contains('bad') && /didn't match its address/.test(document.querySelector('.note').textContent)), JSON.stringify(await cells(f)));
  check('...and it isn\'t played', await until(() => { const v = document.getElementById('video'); const r = v.buffered; for (let i = 0; i < r.length; i++) if (r.start(i) <= 5.5 && 5.5 < r.end(i)) return false; return true; }));
  await page.close();
  ({ page, f, until } = await open(ctx, 's=concert&a=lost5'));
  await until(() => document.querySelectorAll('.cell').length === 80);
  await click(f, '.big');
  await until(() => document.getElementById('video').currentTime > 0.3);
  await f.evaluate(() => { document.getElementById('video').currentTime = 5.2; });
  check('a piece the host couldn\'t fetch: the note says it\'s asked for again', await until(() => /couldn't fetch the video[^]*asked for again/.test(document.querySelector('.note').textContent)));
  check('...its second not marked as wrong', !(await f.evaluate(() => document.querySelectorAll('.cell')[5].classList.contains('bad'))));
  await page.waitForTimeout(2500);
  const again = (await page.evaluate(() => window.__timeline)).filter((x) => x.cid === vs[5]).length;
  check('...and asked for again as the video stays on it', again >= 2, String(again));
  await page.close();

  // ---- other records, no host ----
  ({ page, f, until } = await open(ctx, 's=song'));
  check('not a video: says so', await until(() => document.getElementById('v').dataset.state === 'notvideo' && /isn't a video/.test(document.querySelector('h1').textContent)));
  await page.close();
  ({ page, f, until } = await open(ctx, 's=webm'));
  check('another format: says it doesn\'t play it yet', await until(() => /stored as "webm", which this tile doesn't play yet/.test(document.getElementById('v').innerText)));
  await page.close();
  ({ page, f, until } = await open(ctx, 's=none'));
  check('opened alone: what Videos is', await until(() => document.getElementById('v').dataset.state === 'nohost' && /renderer tile/.test(document.getElementById('v').innerText), 6000));
  await page.close();

  // ---- the post slot ----
  ({ page, f, until } = await open(ctx, '', 'slot'));
  await until(() => document.querySelectorAll('.cell').length === 80);
  check('a post slot (438 × 246): the small layout', await f.evaluate(() => document.getElementById('v').classList.contains('is-small')));
  const lay = await f.evaluate(() => {
    const W = innerWidth, H = innerHeight, r = (s) => document.querySelector(s).getBoundingClientRect();
    const ctls = [...document.querySelectorAll('.bar .ctl')].map((b) => b.getBoundingClientRect());
    return { W, H, title: r('.titlebox b'), bar: r('.bar'), ctls, big: r('.big') };
  });
  check('...the top right left clear for the host\'s buttons', lay.title.right <= lay.W - 84, JSON.stringify(lay.title));
  check('...every control inside the frame', lay.ctls.every((c) => c.left >= 0 && c.right <= lay.W + 0.5 && c.bottom <= lay.H + 0.5));
  check('...the play button in the middle', Math.abs((lay.big.left + lay.big.right) / 2 - lay.W / 2) < 2);
  await page.locator('#f').screenshot({ path: path.join(SHOTS, 'video-slot.png') });
  await click(f, '.big');
  check('...and it plays there', await until(() => document.getElementById('video').currentTime > 1));
  await page.close();

  check('no errors in the page or the tile', errors.length === 0, errors.join(' | '));
} finally {
  await browser.close();
  server.kill();
  console.log(`\n${pass} pass, ${fail} fail`);
  process.exitCode = fail ? 1 : 0;
}
