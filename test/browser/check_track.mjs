// A browser check of the track renderer, "Tracks" (track\tile\, claude/mixtape-3c-track-renderer-notes.md), through
// its stand-in host (track\dev\serve.mjs: the tile in a frame, answering "ready" with a sample song record over the
// tiles spec's data protocol, as Raku does, and the tile's audio request with progress and the bytes of a short synth
// loop): the title card and credits for each kind of song, nothing fetched before Play, the song fetched, played and
// sought, the five looks, the scope's colour and Aurora's three worlds (the picture moving with the music; Aurora with
// WebGL, and its 2D fallback in a browser without WebGL), the choices remembered, the host's refusals, no answer, the
// link-only plyr.fm song, a cover, not a song, opened alone (what Tracks is, two songs to try in Raku), phone width,
// the compact layout in a post's slot (PB5), the new Bloom (PB6), no errors.
// Raku's own check (C:\thunderbird-cafe\raku\test\browser\check_renderer.py) runs it through the real loader.
// Run in the build chat: node test/browser/check_track.mjs [folder for screenshots]   (needs Playwright)
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
const PORT = 5298;
const HOST = `http://127.0.0.1:${PORT}/`;

const server = spawn(process.execPath, [path.join(ROOT, 'track', 'dev', 'serve.mjs')], { env: { ...process.env, PORT: String(PORT) }, stdio: ['ignore', 'pipe', 'inherit'] });
await new Promise((ok) => server.stdout.on('data', (d) => { if (String(d).includes('stand-in host')) ok(); }));

let pass = 0, fail = 0;
const check = (name, cond, detail = '') => { if (cond) { pass++; console.log(`PASS ${name}`); } else { fail++; console.log(`FAIL ${name}${detail ? `  [${detail}]` : ''}`); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 6000) { const end = Date.now() + ms; while (Date.now() < end) { try { const v = await fn(); if (v) return v; } catch {} await sleep(80); } return null; }

const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
try {
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 1100 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(HOST);
  const tile = page.frameLocator('#f');
  const frame = () => page.frame({ url: /\/tile\/index\.html/ });
  const state = () => tile.locator('#track').getAttribute('data-state');
  const text = (sel) => tile.locator(sel).first().innerText();
  const asked = () => page.evaluate(() => window.__asked.map((p) => Object.keys(p)[0]));
  const pick = async (attr, v) => { await page.click(`[data-${attr}="${v}"]`); };
  const canvasInk = (sel = '.scene canvas') => frame().evaluate((sel) => { const c = document.querySelector(sel); const g = c.getContext('2d'); const d = g.getImageData(0, 0, c.width, c.height).data; let s = 0; for (let i = 0; i < d.length; i += 4 * 97) s += d[i] + d[i + 1] * 3 + d[i + 2] * 7; return s; }, sel);
  // Aurora's WebGL canvas, copied onto a 2D one to read it (it keeps its drawing: preserveDrawingBuffer)
  const glInk = () => frame().evaluate(() => { const c = document.querySelector('.scene canvas.gl'); const t = document.createElement('canvas'); t.width = c.width; t.height = c.height; const g = t.getContext('2d'); g.drawImage(c, 0, 0); const d = g.getImageData(0, 0, t.width, t.height).data; let s = 0; for (let i = 0; i < d.length; i += 4 * 97) s += d[i] + d[i + 1] * 3 + d[i + 2] * 7; return s; });
  const pressed = async (sel) => (await tile.locator(sel).getAttribute('aria-pressed')) === 'true';

  // An Archive song
  check('the song: drawn once the host answers "ready"', await until(async () => (await state()) === 'track'));
  check('...its title, band, where and when, set, track and length', (await text('.card-title h1')) === 'Lord Only Knows (Pt. 1)' && (await text('.card-title .band')) === 'Yonder Mountain String Band'
    && (await text('.card-title .where')) === 'The Fillmore Auditorium, Denver, CO · April 20, 2002' && (await text('.card-title .which')) === 'Set 1 · track 7 · 0:24', await text('.card-title .which'));
  const dts = await tile.locator('.credits dt').allInnerTexts();
  check('...the credits: band, where, when, set, taper, source', JSON.stringify(dts) === JSON.stringify(['Band', 'Where', 'When', 'Set', 'Taper', 'Source']), dts.join(','));
  check('...the Archive and policy links, opening in a new window', (await tile.locator('.credits .links a').count()) === 2 && (await tile.locator('.credits .links a').first().getAttribute('target')) === '_blank'
    && (await tile.locator('.credits .links a').first().getAttribute('rel')) === 'noopener noreferrer');
  check('...notes folded, tags, "Shared by @pyxorium.com"', !(await tile.locator('.credits .notes').isVisible()) && (await tile.locator('.credits .tags span').count()) === 3 && (await text('.credits .by')) === 'Shared by @pyxorium.com');
  check('...the Jukebox first, its look switch with five looks', (await tile.locator('#track').getAttribute('data-look')) === 'jukebox'
    && JSON.stringify(await tile.locator('.looks .seg:not(.colours) button').allInnerTexts()) === JSON.stringify(['Jukebox', 'Reel-to-reel', 'Oscilloscope', 'Aurora', 'Plain']));
  check('...Aurora\'s world and credit hidden on the Jukebox', !(await tile.locator('.under').isVisible()));
  check('...the scope\'s colour hidden on the Jukebox', !(await tile.locator('.looks .colours').isVisible()));
  check('...the Play line says the size, nothing fetched yet', (await text('.status')) === '0.3 MB · fetched when you press play' && !(await asked()).includes('audio'), await text('.status'));
  check('...the seek bar waits for the song', await tile.locator('.seek input').isDisabled());
  const still = await canvasInk(); await sleep(400);
  check('...the jukebox drawn and still before Play (nothing moves without music)', still > 0 && Math.abs((await canvasInk()) - still) < still * 0.002);
  await page.screenshot({ path: path.join(SHOTS, 'track-jukebox.png') });

  // Play
  await tile.locator('.play').click();
  check('Play: it asks the host for exactly the record\'s audio file', await until(async () => (await page.evaluate(() => window.__asked.find((p) => p.audio)))?.audio === 'bafkreisamplesongstandinaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'));
  check('...and says how far it has come', await until(async () => /^Fetching… \d+%$/.test(await text('.status')), 2000), await text('.status'));
  check('...then plays: the button says pause', await until(async () => (await tile.locator('.play').getAttribute('aria-label')) === 'Pause'));
  check('...from the bytes the host sent: the tile itself fetched nothing', await frame().evaluate(() => performance.getEntriesByType('resource').every((e) => !/sample\.mp3|getBlob/.test(e.name))));
  check('...the time moves', await until(async () => (await text('.seek .now')) !== '0:00', 4000));
  const a1 = await canvasInk(); await sleep(300); const a2 = await canvasInk();
  check('...the jukebox moves with the music', Math.abs(a2 - a1) > 0);
  await tile.locator('.seek input').evaluate((i) => { i.value = '15'; i.dispatchEvent(new Event('input', { bubbles: true })); });
  check('...seeking jumps ahead', await until(async () => { const t = await text('.seek .now'); const [m, s] = t.split(':').map(Number); return m * 60 + s >= 15; }, 3000), await text('.seek .now'));
  check('...asked once for the song, nothing else', JSON.stringify(await asked()) === '["audio"]', JSON.stringify(await asked()));

  // Looks
  for (const look of ['reel', 'scope', 'aurora', 'plain']) {
    await tile.locator(`.looks [data-look="${look}"]`).click();
    check(`the ${look} look: chosen, music carries on`, (await tile.locator('#track').getAttribute('data-look')) === look && (await tile.locator('.play').getAttribute('aria-label')) === 'Pause');
    if (look !== 'plain' && look !== 'aurora') { const b1 = await canvasInk(); await sleep(300); check(`...it moves with the music`, Math.abs((await canvasInk()) - b1) > 0); await page.screenshot({ path: path.join(SHOTS, `track-${look}.png`) }); }
    if (look === 'aurora') {
      check('...drawn with WebGL inside the tile, on its own canvas', (await tile.locator('#track').getAttribute('data-aurora')) === 'webgl' && await tile.locator('.scene canvas.gl').isVisible() && !(await tile.locator('.scene canvas:not(.gl)').isVisible()));
      check('...its world under the picture: Tide first', await tile.locator('.under .seg').isVisible() && JSON.stringify(await tile.locator('.under .seg button').allInnerTexts()) === JSON.stringify(['Tide', 'Bloom', 'Prism']) && await pressed('[data-world="tide"]'));
      check('...the credit: "Inspired by Spectra, Shimmer Math Labs ↗", in a new window', (await text('.under .credit')) === 'Inspired by Spectra, Shimmer Math Labs ↗'
        && (await tile.locator('.under .credit a').getAttribute('href')) === 'https://shimmermathlabs.com/spectra.html' && (await tile.locator('.under .credit a').getAttribute('target')) === '_blank');
      check('...Aurora\'s title card: night navy', await tile.locator('.card-title').evaluate((e) => getComputedStyle(e).backgroundColor === 'rgb(14, 22, 38)'));
      for (const w of ['tide', 'bloom', 'prism']) {
        if (w !== 'tide') await tile.locator(`.under [data-world="${w}"]`).click();
        await sleep(250);
        const g1 = await glInk(); await sleep(400); const g2 = await glInk();
        check(`...${w}: chosen, drawn (not blank) and moving with the music`, await pressed(`[data-world="${w}"]`) && g1 > 0 && Math.abs(g2 - g1) > 0, `${g1} ${g2}`);
        await page.screenshot({ path: path.join(SHOTS, `track-aurora-${w}.png`) });
      }
    }
    if (look === 'scope') {
      check('...the scope\'s colour shows: Green first', await tile.locator('.looks .colours').isVisible() && (await tile.locator('[data-colour="green"]').getAttribute('aria-pressed')) === 'true');
      await tile.locator('[data-colour="rainbow"]').click();
      check('...Rainbow chosen', (await tile.locator('[data-colour="rainbow"]').getAttribute('aria-pressed')) === 'true');
      await sleep(300); await page.screenshot({ path: path.join(SHOTS, 'track-scope-rainbow.png') });
    }
    if (look === 'plain') check('...Plain hides the picture', !(await tile.locator('.scene').isVisible()));
  }
  await tile.locator('.play').click();
  check('Pause pauses', await until(async () => (await tile.locator('.play').getAttribute('aria-label')) === 'Play'));
  await page.screenshot({ path: path.join(SHOTS, 'track-plain.png') });

  // The look remembered (the tile's own storage) on the next load
  await pick('s', 'plyr');
  check('a plyr.fm song: the look chosen before (Plain) comes back', await until(async () => (await state()) === 'track' && (await tile.locator('#track').getAttribute('data-look')) === 'plain'));
  check('...no concert credits; "Uploaded through plyr.fm"; its link', JSON.stringify(await tile.locator('.credits dt').allInnerTexts()) === JSON.stringify(['Band', 'Show', 'From']) && (await text('.credits .links a')) === 'Listen on plyr.fm ↗'
    && (await tile.locator('.credits .links a').getAttribute('href')) === 'https://plyr.fm/at/did:plc:rqbqpaaluty5v47jwciowpik/fm.plyr.track/3kaaaaaaaaab');
  check('...the show without the band twice', (await text('.card-title .where')) === 'Grey Eagle · 2011-02-17');
  await tile.locator('.looks [data-look="scope"]').click();
  await pick('s', 'archive');
  check('...and the scope\'s colour remembered too', await until(async () => (await tile.locator('#track').getAttribute('data-look')) === 'scope' && (await tile.locator('[data-colour="rainbow"]').getAttribute('aria-pressed')) === 'true'));
  check('...all three choices in the tile\'s storage', JSON.stringify(await frame().evaluate(() => ['tracks.look', 'tracks.scopeColour', 'tracks.world'].map((k) => localStorage.getItem(k)))) === '["scope","rainbow","prism"]');
  await tile.locator('.looks [data-look="aurora"]').click();
  await pick('s', 'plyr');
  check('...Aurora and its world (Prism, chosen before) come back on the next load', await until(async () => (await tile.locator('#track').getAttribute('data-look')) === 'aurora' && await pressed('[data-world="prism"]')));
  await tile.locator('.under [data-world="bloom"]').click();
  await pick('s', 'archive');
  check('...a world changed later comes back too (Bloom), the colour kept (Rainbow)', await until(async () => await pressed('[data-world="bloom"]'))
    && JSON.stringify(await frame().evaluate(() => ['tracks.look', 'tracks.scopeColour', 'tracks.world'].map((k) => localStorage.getItem(k)))) === '["aurora","rainbow","bloom"]');
  await tile.locator('.looks [data-look="jukebox"]').click();

  // The old plyr.fm song: link only
  await pick('s', 'plyrold');
  check('an old plyr.fm song: no Play, the reason and "Listen on plyr.fm"', await until(async () => (await state()) === 'track') && (await tile.locator('.play').count()) === 0
    && /plyr\.fm's own storage/.test(await text('.linkonly')) && (await text('.linkonly a')) === 'Listen on plyr.fm ↗');
  check('...nothing asked of the host', (await asked()).length === 0);

  // A non-concert song with a cover
  await pick('s', 'field');
  check('a song not from a concert: title, artist, length; no where; DID when there\'s no handle', await until(async () => (await text('.card-title h1')) === 'Rain on the porch roof') && (await tile.locator('.card-title .where').count()) === 0
    && (await text('.credits .by')) === 'Shared by did:plc:rqbqpaaluty5v47jwciowpik');
  check('...its cover asked for and shown from the bytes sent', await until(() => tile.locator('.card-title img.cover').evaluate((i) => i.src.startsWith('blob:') && i.complete && i.naturalWidth > 0)));

  // The long one: big, the Wi-Fi line; long title wraps
  await pick('s', 'long');
  check('a 47 MB song: "best on Wi-Fi" before fetching', await until(async () => (await text('.status')) === '47 MB · best on Wi-Fi'), await text('.status'));
  check('...a long title wraps, nothing spills sideways', await frame().evaluate(() => [...document.querySelectorAll('#track *')].every((e) => e.getBoundingClientRect().right <= innerWidth + 1)));
  await tile.locator('.credits summary').click();
  check('...Notes open, keeping their line breaks', await tile.locator('.credits .notes').isVisible() && (await text('.credits .notes')).split('\n').length > 10);

  // The host's refusals and silence
  for (const [mode, words] of [['not-found', "Raku couldn't fetch the song"], ['too-big', 'larger than Raku fetches'], ['not-allowed', "Raku won't fetch this song"]]) {
    await pick('a', mode); await pick('s', 'archive'); await until(async () => (await state()) === 'track');
    await tile.locator('.play').click();
    check(`the host answers ${mode}: it says why`, await until(async () => (await text('.status')).includes(words)), await text('.status'));
    if (mode === 'not-found') {
      check('...with Try again', await tile.locator('.status .again').isVisible());
      await pick('a', 'send');
      await tile.locator('.status .again').click();
      check('...which works once the host answers', await until(async () => (await tile.locator('.play').getAttribute('aria-label')) === 'Pause'));
    }
  }
  await pick('a', 'silent'); await pick('s', 'archive'); await until(async () => (await state()) === 'track');
  await tile.locator('.play').click();
  check('no answer: it keeps saying Fetching… (and gives up after 30 s with Try again)', (await text('.status')) === 'Fetching…' && await tile.locator('.play').isDisabled());
  await pick('a', 'send');

  // Not a song; nothing at all
  await pick('s', 'like');
  check('not a song: says so, and names the kind', await until(async () => (await state()) === 'nottrack') && (await text('#track p')).includes('app.bsky.feed.like'));
  await pick('s', 'none');
  check('no record at all: what Tracks is, after a few seconds', await until(async () => (await state()) === 'nohost', 6000) && (await text('#track h1')) === 'Tracks');

  // Phone
  await pick('s', 'archive'); await pick('w', 'phone');
  await until(async () => (await state()) === 'track');
  check('phone: the look switch is a small menu', await until(async () => (await tile.locator('.looks select[aria-label="Look"]').isVisible()) && !(await tile.locator('.looks .seg:not(.colours)').isVisible())));
  await tile.locator('.looks select[aria-label="Look"]').selectOption('aurora');
  check('...Aurora\'s world a small menu too', await until(async () => (await tile.locator('.under select').isVisible()) && !(await tile.locator('.under .seg').isVisible())));
  await tile.locator('.under select').selectOption('tide');
  check('...choosing a world from it', await pressed('[data-world="tide"]'));
  check('...drawn lighter: half resolution', await frame().evaluate(() => { const c = document.querySelector('.scene canvas.gl'); return Math.abs(c.width - c.getBoundingClientRect().width * 0.5 * Math.min(2, devicePixelRatio)) <= 1; }));
  await page.screenshot({ path: path.join(SHOTS, 'track-phone-aurora.png'), fullPage: true });
  await tile.locator('.looks select[aria-label="Look"]').selectOption('reel');
  check('...choosing from it changes the look', (await tile.locator('#track').getAttribute('data-look')) === 'reel');
  check('...the credits stack (label above value)', await tile.locator('.credits dl').evaluate((d) => getComputedStyle(d).gridTemplateColumns.split(' ').length === 1));
  check('...nothing spills sideways', await frame().evaluate(() => [...document.querySelectorAll('#track *')].every((e) => e.getBoundingClientRect().right <= innerWidth + 1)));
  await page.screenshot({ path: path.join(SHOTS, 'track-phone.png'), fullPage: true });
  await tile.locator('.looks select[aria-label="Look"]').selectOption('jukebox');
  await pick('w', 'wide');

  // The compact layout (PB5): in a tile post's slot (438×246, then 358×201 on a phone)
  for (const [w, label] of [['slot', 'a post slot'], ['slotphone', 'a phone post slot']]) {
    await pick('w', w);
    await pick('s', 'archive');
    check(`${label}: the compact layout`, await until(async () => (await state()) === 'track' && await tile.locator('#track').evaluate((e) => e.classList.contains('is-compact'))));
    const geo = await frame().evaluate(() => {
      const r = (s) => { const e = document.querySelector(s); return e && e.offsetParent !== null ? e.getBoundingClientRect() : null; };
      return { W: innerWidth, H: innerHeight, scene: r('.scene'), looks: r('.looks select'), strip: r('.player'), words: r('.strip-words'), card: r('.card-title'), credits: r('.credits'),
        right: Math.max(...[...document.querySelectorAll('.looks > *')].filter((e) => e.offsetParent !== null).map((e) => e.getBoundingClientRect().right)),
        scroll: document.scrollingElement.scrollHeight - innerHeight };
    });
    check('...the picture fills the frame', geo.scene && geo.scene.width >= geo.W - 1 && geo.scene.height >= geo.H - 1, JSON.stringify(geo.scene));
    check('...a strip along the bottom with ▶, the title and band', geo.strip && Math.abs(geo.strip.bottom - geo.H) < 1 && geo.words && (await text('.strip-words b')) === 'Lord Only Knows (Pt. 1)' && (await text('.strip-words span')) === 'Yonder Mountain String Band');
    check('...the look menu top left, the top right kept clear for the host\'s buttons (120 px)', geo.looks && geo.looks.top < 12 && geo.looks.left < 12 && geo.right <= geo.W - 120, `${geo.right} of ${geo.W}`);
    check('...no title card, no credits card, nothing to scroll', !geo.card && !geo.credits && geo.scroll <= 0, `${geo.scroll}`);
    await tile.locator('.play').click();
    check('...▶ in the strip plays the song', await until(async () => (await tile.locator('.play').getAttribute('aria-label')) === 'Pause'));
    await tile.locator('.looks select[aria-label="Look"]').selectOption('aurora');
    check('...Aurora from the menu, its World menu beside it (no World row)', await until(async () => (await tile.locator('#track').getAttribute('data-look')) === 'aurora')
      && await tile.locator('.looks select[aria-label="World"]').isVisible() && !(await tile.locator('.under').isVisible()));
    await tile.locator('.looks select[aria-label="World"]').selectOption('bloom');
    await sleep(600); const b1 = await glInk(); await sleep(500); const b2 = await glInk();
    check('...the new Bloom draws and moves in the slot', b1 > 0 && b1 !== b2, `${b1} ${b2}`);
    check('...drawn lighter (half resolution)', await frame().evaluate(() => { const c = document.querySelector('.scene canvas.gl'); return Math.abs(c.width - c.getBoundingClientRect().width * 0.5 * Math.min(2, devicePixelRatio)) <= 1; }));
    await page.screenshot({ path: path.join(SHOTS, `track-${w}-aurora.png`) });
    await tile.locator('.looks .cred-btn').click();
    check('...Credits open over the picture, with Close, the top row clear', await tile.locator('.credits').isVisible() && (await text('.credits .cred-close')) === 'Close'
      && await tile.locator('.credits .aurora-credit').isVisible() && await frame().evaluate(() => { const c = document.querySelector('.cred-close').getBoundingClientRect(); return c.right < innerWidth - 120 && c.top < 42; }));
    await page.screenshot({ path: path.join(SHOTS, `track-${w}-credits.png`) });
    await tile.locator('.credits .cred-close').click();
    check('...Close folds them away again', !(await tile.locator('.credits').isVisible()));
    await tile.locator('.looks select[aria-label="Look"]').selectOption('scope');
    check('...the scope\'s colour as a small menu', await tile.locator('.looks select[aria-label="Colour"]').isVisible() && !(await tile.locator('.looks .colours').isVisible()));
    await tile.locator('.looks select[aria-label="Look"]').selectOption('plain');
    check('...Plain: the title card over the cream, the strip still there', await until(async () => await tile.locator('.card-title').isVisible()) && await tile.locator('.play').isVisible());
    await tile.locator('.looks select[aria-label="Look"]').selectOption('jukebox');
    await sleep(400); await page.screenshot({ path: path.join(SHOTS, `track-${w}-jukebox.png`) });
    await tile.locator('.play').click();
  }
  await pick('w', 'wide');
  check('back to a full frame: the full page again', await until(async () => !(await tile.locator('#track').evaluate((e) => e.classList.contains('is-compact'))) && await tile.locator('.card-title').isVisible() && await tile.locator('.credits').isVisible()));

  // Reduced motion: Plain first (when nothing was chosen before)
  const rm = await browser.newContext({ viewport: { width: 1200, height: 1100 }, reducedMotion: 'reduce' });
  const p2 = await rm.newPage();
  await p2.goto(HOST);
  const t2 = p2.frameLocator('#f');
  check('a device asking for less motion: opens on Plain', await until(async () => (await t2.locator('#track').getAttribute('data-look')) === 'plain'));
  await rm.close();

  // Opened alone (no host at all): data.js missing (R3c-10)
  const alone = await ctx.newPage();
  alone.on('pageerror', (e) => errors.push(String(e)));
  await alone.route('**/.well-known/web-tiles/data.js', (r) => r.fulfill({ status: 404, body: '' }));
  await alone.goto(`${HOST}tile/index.html`);
  check('opened alone (no data.js): what Tracks is', await until(async () => (await alone.locator('#track').getAttribute('data-state')) === 'nohost') && (await alone.locator('h1').innerText()) === 'Tracks'
    && (await alone.locator('.lead').innerText()).startsWith("This is a renderer tile: it plays songs that live in people's own accounts.")
    && (await alone.locator('.lead').innerText()).includes('a jukebox, a reel-to-reel deck, an oscilloscope, an aurora of light, or plain.'));
  const links = await alone.locator('.tries a').evaluateAll((as) => as.map((a) => [a.textContent, a.href, a.target]));
  check('...two songs to try, each "Open in Raku ↗" in a new window', JSON.stringify(links) === JSON.stringify([
    ['Open in Raku ↗', 'https://raku.lexicographer.space/#t=at%3A%2F%2Fpyxorium.com%2Fcafe.thunderbird.audio.track%2F3n2cwy6kxit2f&a=0', '_blank'],
    ['Open in Raku ↗', 'https://raku.lexicographer.space/#t=at%3A%2F%2Fpyxorium.com%2Ffm.plyr.track%2F3mh6rgj3nef22&a=0', '_blank']]), JSON.stringify(links));
  check('...each address in a box to select and copy', JSON.stringify(await alone.locator('.tries .addr').allInnerTexts()) === JSON.stringify(['at://pyxorium.com/cafe.thunderbird.audio.track/3n2cwy6kxit2f', 'at://pyxorium.com/fm.plyr.track/3mh6rgj3nef22'])
    && (await alone.locator('.tries .addr').first().evaluate((e) => getComputedStyle(e).userSelect)) === 'all');
  check('...the two kinds, the Renderer tiles post, Aurora\'s credit', (await alone.locator('#track').innerText()).includes("Or paste a song's address into Raku's address box.")
    && (await alone.locator('a[href="https://thunderbird.cafe/blog/renderer-tiles"]').count()) === 1 && (await alone.locator('a[href="https://shimmermathlabs.com/spectra.html"]').count()) === 1);
  check('...the jukebox standing still above the words', await until(() => alone.evaluate(() => { const c = document.querySelector('.alone-pic'); const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 0; i < d.length; i += 4 * 53) n += d[i] > 150 ? 1 : 0; return c.width > 100 && n > 20; })));
  await alone.screenshot({ path: path.join(SHOTS, 'track-alone.png'), fullPage: true });
  await alone.setViewportSize({ width: 390, height: 900 });
  check('...at phone width nothing spills sideways', await until(() => alone.evaluate(() => [...document.querySelectorAll('#track *')].every((e) => e.getBoundingClientRect().right <= innerWidth + 1))));
  await alone.screenshot({ path: path.join(SHOTS, 'track-alone-phone.png'), fullPage: true });
  await alone.close();

  check('no errors on the page', errors.length === 0, errors.join(' | '));
} finally {
  await browser.close();
}

// A browser without WebGL: Aurora draws with its 2D fallback
const noGL = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required', '--disable-webgl', '--disable-3d-apis'] });
try {
  const page = await noGL.newPage({ viewport: { width: 1200, height: 1100 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(HOST);
  const tile = page.frameLocator('#f');
  const frame = () => page.frame({ url: /\/tile\/index\.html/ });
  await until(async () => (await tile.locator('#track').getAttribute('data-state')) === 'track');
  await tile.locator('.looks [data-look="aurora"]').click();
  check('no WebGL: Aurora uses its 2D fallback on the looks\' canvas', (await tile.locator('#track').getAttribute('data-aurora')) === '2d' && await tile.locator('.scene canvas:not(.gl)').isVisible() && !(await tile.locator('.scene canvas.gl').isVisible()));
  await tile.locator('.play').click();
  await until(async () => (await tile.locator('.play').getAttribute('aria-label')) === 'Pause');
  const ink = () => frame().evaluate(() => { const c = document.querySelector('.scene canvas:not(.gl)'); const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let s = 0; for (let i = 0; i < d.length; i += 4 * 97) s += d[i] + d[i + 1] * 3 + d[i + 2] * 7; return s; });
  for (const w of ['tide', 'bloom', 'prism']) {
    await tile.locator(`.under [data-world="${w}"]`).click();
    await sleep(500); const a = await ink(); await sleep(400); const b = await ink();
    check(`...${w}: drawn and moving`, a > 0 && Math.abs(b - a) > 0, `${a} ${b}`);
    await page.screenshot({ path: path.join(SHOTS, `track-aurora-2d-${w}.png`) });
  }
  check('...no errors', errors.length === 0, errors.join(' | '));
} finally {
  await noGL.close();
  server.kill();
}
console.log(`\n${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
