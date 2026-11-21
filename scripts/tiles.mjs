// tiles.mjs: what goes into each renderer tile, for publish.mjs. Moved here from C:\thunderbird-cafe\maze-tiles on
// Nov 20 2026 (claude/mixtape-3c-track-renderer-notes.md, R3c-5); the settings are unchanged, so the published records
// and Raku's pins stay as they are.
//   place-renderer     "Places", the place renderer: one place record as a postcard, for Raku (PLACE_TILES; --place)
//   signpost-renderer  "Signposts", the signpost renderer: where one exit leads, for Raku (SIGNPOST_TILES; --signpost)
//   track-renderer     "Tracks", the track renderer: one song, played in a look, for Raku (TRACK_TILES; --track)
// The records they show (places, signposts and their two lexicons) stay with the maze and Winter Forest in maze-tiles.
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// Every renderer is published from thunderbird.cafe.
export const THUNDERBIRD_DID = 'did:plc:6vxjigxrqizmbo56gojxico3';     // thunderbird.cafe

// The place renderer (claude/raku-renderer-tiles-plan.md, RT1 to RT9): a tile that shows one place record as a
// postcard, given the record by its host over the tiles spec's data protocol. Raku pins it (RENDERERS in Raku's
// src/config.js) and opens it for place addresses. Published on its own with publish.mjs --place.
export const PLACE_TILES = {
  // Its id is not "places": maze-tiles' published.json uses that key for the place records (Nov 6: the first publish
  // under that id overwrote them; repaired by hand).
  'place-renderer': {
    name: 'Places',
    description: "Shows a place (a cafe.thunderbird.way.place record) as a postcard: its name, who made it, the card of the tile behind it, and a way into that tile. A place keeps one address while its tile is replaced. Raku opens this when you open a place's address.",
    sizing: { width: 640, height: 480 },
    folder: 'place/tile',
    files: ['index.html', 'place.css', 'place.js', 'view.js'],
    cards: ['icon.png', 'banner.png'],
    icon: '/icon.png',
    screenshot: '/banner.png',
    cardArt: 'open place\\dev\\card-art.html in a browser and save both pictures into place\\tile\\',
    generator: 'Places',
    renderer: 'cafe.thunderbird.way.place',       // the kind Raku pins it for: publish.mjs prints the pin
  },
};

// The signpost renderer (claude/raku-renderer-tiles-plan.md, "The signpost renderer", SR1 to SR7): one signpost record
// (where one exit of a tile leads) as a postcard, given the record over the data protocol; it asks its host for the
// records the names come from ({ get }, SR2 and SR6). Raku pins it for signposts. Published on its own with
// publish.mjs --signpost. (In maze-tiles it also published the ways lexicons when they'd changed; they stay there now,
// published with Winter Forest's --forest.)
export const SIGNPOST_TILES = {
  'signpost-renderer': {
    name: 'Signposts',
    description: "Shows a signpost (a cafe.thunderbird.way.signpost record) as a postcard: the way out it belongs to, who made it, where it leads, and a way to go there. A signpost can be changed any time without changing either tile. Raku opens this when you open a signpost's address.",
    sizing: { width: 640, height: 480 },
    folder: 'signpost/tile',
    files: ['index.html', 'signpost.css', 'signpost.js', 'view.js'],
    cards: ['icon.png', 'banner.png'],
    icon: '/icon.png',
    screenshot: '/banner.png',
    cardArt: 'open signpost\\dev\\card-art.html in a browser and save both pictures into signpost\\tile\\',
    generator: 'Signposts',
    renderer: 'cafe.thunderbird.way.signpost',
  },
};

// The track renderer (claude/mixtape-3c-track-renderer-notes.md, R3c-1 to R3c-9): one song record, ours
// (cafe.thunderbird.audio.track, from the Foundry's importer) or plyr.fm's (fm.plyr.track), with its credits, played in
// the look the listener picks. It asks its host for the song's audio when Play is pressed ({ audio }, R3c-4). Raku pins
// it for both kinds. Published on its own with publish.mjs --track.
export const TRACK_TILES = {
  'track-renderer': {
    name: 'Tracks',
    description: "Plays a song (a cafe.thunderbird.audio.track or fm.plyr.track record) with its credits, in the look you pick: a jukebox, a reel-to-reel deck, an oscilloscope, or plain. The song is fetched from its account when you press play. Raku opens this when you open a song's address.",
    sizing: { width: 640, height: 480 },
    folder: 'track/tile',
    files: ['index.html', 'track.css', 'track.js', 'view.js', 'looks.js'],
    cards: ['icon.png', 'banner.png'],
    icon: '/icon.png',
    screenshot: '/banner.png',
    cardArt: 'npm run dev-track, then http://127.0.0.1:5240/card-art.html, and save both pictures into track\\tile\\',
    generator: 'Tracks',
    renderer: ['cafe.thunderbird.audio.track', 'fm.plyr.track'],
  },
};

// Each publish.mjs option and its tiles.
export const KINDS = { '--place': PLACE_TILES, '--signpost': SIGNPOST_TILES, '--track': TRACK_TILES };

// The Foundry's one fixed type per kind of file (web-tile-foundry/src/core/fileset.js CONTENT_TYPES).
export const PUBLISH_TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.json': 'application/json' };

// The tile's own security policy, from its page's <meta> tag (it also goes in the record, as the Foundry does).
export function cspOf(html) {
  const m = /<meta\s+http-equiv="Content-Security-Policy"\s+content="([^"]*)"/i.exec(html);
  if (!m) throw new Error('The tile page has no security policy.');
  return m[1];
}

// A tile's files for publishing: [{ path, bytes, contentType }], "/" being its page.
export function publishFiles(id, tiles) {
  const t = tiles[id];
  const out = [];
  const cards = t.cards;
  for (const f of [...t.files, ...cards]) {
    const file = join(ROOT, t.folder, f);
    if (!existsSync(file)) throw new Error(`Missing ${t.folder}/${f}${cards.includes(f) ? ` (draw it: ${t.cardArt})` : ''}`);
    const path = f === 'index.html' ? '/' : `/${f}`;
    out.push({ path, bytes: new Uint8Array(readFileSync(file)), contentType: PUBLISH_TYPES[extname(f)] });
  }
  return out;
}
