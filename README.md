# Renderer tiles

Web tiles that Raku uses to show a record that isn't a tile: **Places** (a place, `cafe.thunderbird.way.place`),
**Signposts** (a signpost, `cafe.thunderbird.way.signpost`), **Tracks** (a song, `cafe.thunderbird.audio.track` or
`fm.plyr.track`) and **Videos** (a video, `cafe.thunderbird.video.track`, since Nov 27). Raku pins each one by its record (`RENDERERS` in `C:\thunderbird-cafe\raku\src\config.js`) and
opens it in a tab for an address of that kind, handing it the record over the tiles spec's data protocol (tp-data). All
four are published from thunderbird.cafe. Background: claude/raku-renderer-tiles-plan.md in the Foundry project, and
the blog post *Renderer tiles* (https://thunderbird.cafe/blog/renderer-tiles).

They moved here from `C:\thunderbird-cafe\maze-tiles` on Nov 20 2026 (from maze-tiles `4e702f1`; their history is
there; claude/mixtape-3c-track-renderer-notes.md, R3c-5). Nothing was republished: the records and Raku's pins are the
ones in `published.json`. The records they show stay with the maze and Winter Forest in maze-tiles: the place and
signpost records, the two ways lexicons (`lexicons\`) and the way pages.

## The folders

- `place\`, `signpost\`, `track\`, `video\`: each renderer, with `tile\` (the tile as published) and `dev\` (its stand-in host
  and card pictures). Below, one section each.
- `scripts\` `publish.mjs` publishes one renderer (`tiles.mjs` says what goes into each); `lib\` holds the
  record-building code (copied from maze-tiles, which copied it from rooms-lab: the Foundry's own).
- `test\` `npm test`: each renderer's view, page and publishing (`place.test.mjs`, `signpost.test.mjs`,
  `track.test.mjs`, `video.test.mjs`), and publishing in general (`publish.test.mjs`), against a stand-in server (`fake-pds.mjs`).
  `test\browser\check_place.mjs`, `check_signpost.mjs`, `check_track.mjs` and `check_video.mjs` try every state
  through each stand-in host (they need Playwright; run in the build chat). Raku's `test\browser\check_renderer.py`
  runs the first three through the real tile loader, and `check_video_renderer.py` Videos.
- `published.json`: what was published (each renderer's address and record CID: the values in Raku's pins).

No packages: Node 22 is enough for `npm test`, the dev servers and publishing.

## Publishing

In `C:\thunderbird-cafe\renderer-tiles`, always naming the renderer (`--place`, `--signpost`, `--track` or `--video`):

```
node scripts/publish.mjs --track --dry-run
node scripts/publish.mjs --track
node scripts/publish.mjs --track --again
```

It asks for a **thunderbird.cafe** app password (hidden as you type) and once more before writing, publishes the tile
as a new record, reads everything back, writes `published.json` (commit it) and prints the pin for Raku: the tile's
`uri` and record `cid`, which go in `RENDERERS` in `C:\thunderbird-cafe\raku\src\config.js` before Raku is pushed
("publish and pin before pushing"). `--again` publishes a new record after a change; Raku's pin must then move too, or
Raku refuses the changed tile. Delete the earlier record in PDSls once the new pin works.

## Places (`place\`): the place renderer

A tile that shows one place record (`cafe.thunderbird.way.place`) as a postcard: the place's name, who made it and
when, a **Step into <name>** button, and "The tile behind it": the tile's card (its banner, name, who made it and its
description, read through its host) above the tile's `at://` address. Raku opens it when
someone opens a place's own address (`at://pyxorium.com/cafe.thunderbird.way.place/maze`); it plays no part in
walking between tiles. Plan: claude/raku-renderer-tiles-plan.md in the Foundry project (RT1 to RT9) and its mockup
claude/raku-place-renderer-mockup.html.

- **How it gets the record (RT1):** the tiles spec's data protocol (tp-data). The tile loads its host's
  `/.well-known/web-tiles/data.js` (never bundled: each host serves its own), adds its handler, then calls `listen()`;
  the host answers "ready" with one payload `{ uri, cid, did, handle, collection, rkey, value }`, the record as
  stored (RT4). So any host that speaks tp-data can use it, not only Raku.
- **Step into (RT5):** sends `{ open: "at://…/ing.dasl.masl/…" }` (the place's tile). The tile can't tell whether its
  host opened anything, so a quiet line then says "If nothing opens, copy the address below into Raku."
- **The tile's card (claude/raku-places-card-plan.md, PC1 to PC6):** once it has the place, the tile asks its host for
  the tile record behind it, `{ get: "<the tile's at:// address>" }`, once (Raku allows it: the address is in the
  place record, SR6), and draws its banner (else its icon beside the name), name, who made it and when, and the first
  three lines of its description with More / Less. The picture comes from a second request, `{ picture: "<blob cid>",
  from: "<the tile record's at:// address>" }`; the host answers `{ gotPicture, from, type, bytes }` (PNG, JPEG, WebP
  or GIF, at most 1 MB), shown as a `blob:` picture (the tile's policy allows that; it still reaches no network). A
  picture that's refused, isn't one, or hasn't come within 10 s: the card without one, no message. When the tile
  record's version differs from the one the place records, a line says portals in other tiles won't lead to it until
  the place is updated (the travel pages refuse it) and that Step into opens the changed tile anyway (PC4). "not-found":
  "Raku couldn't find this tile…", Step into kept; "hidden": "Raku doesn't show this tile.", no Step into (PC5). A host
  that doesn't answer, or any other refusal: the card as before, the address only. These three are all it sends.
- **Other states (RT6):** "Waiting for a place…"; no record within 3 s, or opened on its own: "This tile shows
  places." (naming no place); a record of another kind: "This isn't a place."; a place pointing at no tile: no button.
- **The look (RT7):** the travel pages', light only. The `:root` line of `place\tile\place.css` is the same as
  maze-tiles' `site\way.css`'s; `test\place.test.mjs` fails if they drift (when `C:\thunderbird-cafe\maze-tiles` is
  beside this folder; skipped otherwise), so change both together.
- `place\tile\` the tile: `index.html` (its policy: nothing reaches the network), `place.js` (drawing and the data
  protocol), `view.js` (what to show for a payload; no DOM, tested in Node), `place.css`, `icon.png`, `banner.png`.
- **The card pictures:** a carved door (owner, Nov 5: its stepped carved band curving like the cornice of a carved
  door, raised in the centre, dipping, rising near the ends, falling slightly at the tips; hanging beads; studded
  pilasters, round bases, a scalloped plinth; the arch plain cream), in the travel pages' blue and cream. To redraw,
  open `place\dev\card-art.html` in a browser (no server needed) and save both pictures into `place\tile\`. The
  choices: claude/place-renderer-door-sheet.html in the Foundry project.
- `npm run dev-place`: http://127.0.0.1:5220/ holds the tile in a stand-in host that answers "ready" with a sample
  (Winter Forest, the Escher maze, a long name, a place with no tile, a record that isn't a place, or nothing), answers
  `get` and `picture` with the samples' tile records and the real banners and icon (copied into `place\dev\` from
  maze-tiles; switches for a changed tile, not found, hidden, a refusal or no answer; a slow, refused or non-picture
  answer, or none), and logs what the tile asks; Phone narrows it.
- `test\place.test.mjs` (part of `npm test`): the view, the colours kept in step, the page, publishing with `--place`.
  `test\browser\check_place.mjs` tries every state through the stand-in host (run in the build chat). Raku's
  `test\browser\check_renderer.py` runs it through the real tile loader.

**Publishing it** (`--place`: this tile only), in `C:\thunderbird-cafe\renderer-tiles`:

```
node scripts/publish.mjs --place --dry-run
node scripts/publish.mjs --place
```

From thunderbird.cafe (it asks for a thunderbird.cafe app password). At the end it prints the pin for Raku: the
tile's `uri` and record `cid`, which go in `RENDERERS` in `C:\thunderbird-cafe\raku\src\config.js` before Raku is
pushed ("publish and pin before pushing"). `--place --again` publishes a new record after a change; Raku's pin must
then move too, or Raku refuses the changed tile.

## Signposts (`signpost\`): the signpost renderer

A tile that shows one signpost record (`cafe.thunderbird.way.signpost`: where one exit of a tile leads) as a
postcard. Raku opens it when someone opens a signpost's own address
(`at://thunderbird.cafe/cafe.thunderbird.way.signpost/winter-forest.slide`). Plan: claude/raku-renderer-tiles-plan.md
in the Foundry project, "The signpost renderer" (SR1 to SR8), with its mockup claude/raku-signpost-renderer-mockup.html.

- **What it shows (SR1):** real names, with the record's own data beside them in brackets naming the kind:

  ```
  The slide, in Winter Forest
  A way out of [place: winter-forest] [leave/exit: slide]
  by @thunderbird.cafe [did:plc:…]
  Updated Oct 29, 2026.
  ( Go to Escher maze )
  WHERE IT LEADS
  A way in to [place: maze] [arrive/entrance: obelisk]
  by @pyxorium.com [did:plc:…]
  ```

  Several destinations: a "Go there" per row (a destination's `label`, if written, on top of its row); none: "This
  doesn't lead anywhere yet."; the signpost's `note` under the heading. The tile's id and the exit's come from the
  record key (`winter-forest.slide`); a key with no dot shows only `[leave/exit: …]`.
- **The exit's name (SR5):** the signpost's optional `name` (new in the lexicon, Nov 6; fill it in PDSls, e.g. "The
  slide"); without it, one made from the id (`tree-door` → "Tree door").
- **Where the names come from (SR2, SR6):** the record holds addresses only, so the tile asks its host for the
  records it needs: `{ get: "at://…" }` for the tile's own place (same account) and each destination. A host that
  answers sends `{ got, record }` (the same shape as the signpost) or `{ got, error }`. Raku answers only for
  addresses in the signpost or in its own account. With no answers, the bracketed record data still shows.
- **Going (as Places' Step into):** "Go to …" / "Go there" sends `{ open: "at://…" }` (a place opens as its own
  postcard; a tile as the tile). It only ever sends `get` and `open`.
- **The look:** the travel pages' and Places', light only; `signpost\tile\signpost.css`'s `:root` line is the same
  as `place\tile\place.css`'s (`test\signpost.test.mjs` checks), and so maze-tiles' `site\way.css`'s.
- **The card pictures (SR4):** a trail signpost in the Places colours, a dotted trail at its foot; the banner on a
  faint map, its boards saying CHICAGO and SANTA MONICA. To redraw, open `signpost\dev\card-art.html` in a browser
  and save both pictures into `signpost\tile\`. The choices: claude/signpost-renderer-icon-sheet.html.
- `npm run dev-signpost`: http://127.0.0.1:5230/ holds the tile in a stand-in host that answers "ready" with a sample
  and its `get`s by Raku's rule ("Answer get: No" shows a host that doesn't), and logs what the tile asks.
- `test\signpost.test.mjs` (part of `npm test`); `test\browser\check_signpost.mjs` through the stand-in host (run in
  the build chat); Raku's `test\browser\check_renderer.py` through the real loader.

**Publishing it** (`--signpost`: this tile only), in `C:\thunderbird-cafe\renderer-tiles`. The two ways lexicons
stay in maze-tiles (`lexicons\`) and are published from there, with Winter Forest's `--forest`, when they change:

```
node scripts/publish.mjs --signpost --dry-run
node scripts/publish.mjs --signpost
```

From thunderbird.cafe. At the end it prints the pin for Raku's `RENDERERS` (`'cafe.thunderbird.way.signpost'`).

## Tracks (`track\`): the track renderer

A tile that plays one song record, with its credits, in the look the listener picks. Raku opens it when someone opens
a song's own address: one of ours (`cafe.thunderbird.audio.track`, from the Web Tile Foundry's importer) or a plyr.fm
song (`fm.plyr.track`). Plan: claude/mixtape-3c-track-renderer-notes.md in the Foundry project (R3c-1 to R3c-9), with
its approved mockup claude/raku-track-renderer-mockup.html. It lived in maze-tiles until Nov 20 (R3c-5).

- **The looks (R3c-1, R3c-2, R3c-8, R3c-12):** Jukebox (the first look), Reel-to-reel, Oscilloscope (a calm braid
  with a glow between its strands, green or rainbow), Aurora and Plain, switched on the tile (a small menu on phones);
  the music carries on across a switch. The look, the scope's colour and Aurora's world are remembered in the tile's
  own storage when the browser keeps it (all three written together on every change). A device that asks for less
  motion opens on Plain (a look chosen before still wins). Drawing: `track\tile\looks.js`, and `aurora.js` for Aurora.
- **The jukebox (Nov 20, R3c-13):** the light arch keeps its rainbow, red to magenta, and all 14 segments and both
  pillars pulse together with the beat (the bass, quick to rise, slower to fall); each bubble tube has its own 22
  bubbles, rising very slowly and steadily, whatever the music does.
- **Aurora (Nov 20, R3c-12):** our own drawing, inspired by Spectra (Shimmer Math Labs,
  https://shimmermathlabs.com/spectra.html; credited under the look and on the "opened alone" screen; no code of
  theirs). Three worlds, chosen under the picture: **Tide** (the song's recent past as diagonal ribbons drifting left),
  **Bloom** (rings, bass near the centre; since Part B, PB6: switched on by the music rather than following it closely,
  fading up over about 3 s and down over about 4; a soft drifting cloud at the centre, breathing every 12 s, in place of
  the old petalled core; a slow wave from the cloud every 12 s, crossing in 8 s, brightening and gently bulging the rings
  it passes; `BLOOM` and `bloomWave` in `aurora.js`) and **Prism** (mirrored rays, turning slowly); each brings its
  own tuned colours and settings, Tide first. The music is kept as 64 bands × 256 moments of spectrum history. Drawn
  with WebGL on its own canvas (one small shader per world), or a 2D fallback on the looks' canvas when the browser has
  no WebGL; on a phone at half resolution and 30 frames a second. Its title card is night navy with an iridescent edge.
- **What it shows (R3c-3, R3c-6):** the title card (title, band, "venue, place · date", "Set 1 · track 7 · 7:17"),
  the player, and a credits card (band, where, when, set, taper, source; the Archive and policy links; notes folded;
  tags; "Shared by @handle"). A plyr.fm song: "Uploaded through plyr.fm" and "Listen on plyr.fm ↗"; an old one whose
  audio is only on plyr.fm's storage gets the link only.
- **The song (R3c-4):** fetched only when Play is pressed: the tile sends `{ audio: "<blob cid>", from: "<record>" }`;
  a host that answers sends `{ audioProgress, from, received, total }` while it downloads, then
  `{ gotAudio, from, type, bytes }` (or `{ gotAudio, from, error }`); it plays from a `blob:` address, so seeking
  always works. Raku fetches only the record's own `audioBlob`, from its account's server, at most 100 MB, audio by
  its bytes, checked against the record's CID. A cover (`imageBlob`) comes through `{ picture }`, as Places' card.
  It only ever sends `audio` and `picture`.
- **The compact layout (Part B, PB5):** in a frame under 360 px high, such as a tile post's slot in Raku (about
  438×246, or 358×201 on a phone), the look's picture fills the frame; a strip along the bottom holds ▶, the title and
  band, the time and seek bar; the look menu (with the scope's colour or Aurora's world as small menus) and **Credits**
  sit top left, the top right left clear for the host's own buttons; the credits open over the picture with Close.
  Plain shows the title card over the cream. A taller frame (a tab, or Raku's Expand) gets the full page. The stand-in
  host's **Post slot** and **Post slot (phone)** widths show it.
- **Opened alone (R3c-10):** with no host, or a host that sends no record within 3 s (webtil.es, a gallery, its own
  address in Raku), it says what Tracks is under a still picture of the jukebox, with two songs to try ("Open in Raku
  ↗", each address in a box to select and copy), the two kinds of song record, a link to the *Renderer tiles* post and
  Aurora's credit.
- **The look of the page:** the travel pages' cream; `track\tile\track.css`'s `:root` line is the same as
  `place\tile\place.css`'s (`test\track.test.mjs` checks).
- **The card pictures:** the jukebox, drawn by the tile's own `looks.js`; the banner names the five looks (since Nov
  20; the icon is still the Nov 15 one). To redraw: `npm run dev-track`, open http://127.0.0.1:5240/card-art.html, and
  save the pictures into `track\tile\`.
- `npm run dev-track`: http://127.0.0.1:5240/ holds the tile in a stand-in host that answers "ready" with a sample
  (an Archive song, a plyr.fm song, an old one, one with a cover, a long one, not a song, nothing), its audio request
  with a short synth loop made for this (`track\dev\sample.mp3`, no one's music) or a refusal or silence, and logs
  what the tile asks.
- `test\track.test.mjs` (part of `npm test`); `test\browser\check_track.mjs` through the stand-in host (run in the
  build chat); Raku's `test\browser\check_renderer.py` through the real loader.

**Publishing it** (`--track`: this tile only), in `C:\thunderbird-cafe\renderer-tiles`:

```
node scripts/publish.mjs --track --dry-run
node scripts/publish.mjs --track
```

From thunderbird.cafe. At the end it prints the pin for Raku's `RENDERERS`, for both song kinds
(`'cafe.thunderbird.audio.track', 'fm.plyr.track'`).

## Videos (`video\`): the video renderer

A tile that plays one video record (`cafe.thunderbird.video.track`, from pyxorium/video-tracks: the record's fields,
its MUXL media and the scripts that make and publish it live there). Raku opens it when someone opens a video's own
address, or presses Play here on a video post. Plan: claude/muxl-concert-plan.md in the Foundry project; the player
comes from the squirrel tile's (`C:\thunderbird-cafe\muxl-tile`, claude/muxl-publish-plan.md,
claude/video-tile-lessons.md). The first video: Waxahatchee, "Fruits of My Labor", live at Red Rocks (Nov 27).

- **The media:** MUXL pieces, one per second and track, each a blob of the record. A renderer has no network of its
  own, so it asks its host for each file: `{ piece: "<blob cid>", from: "<record>" }`, answered `{ gotPiece, from,
  bytes }` or `{ gotPiece, from, error }`. Raku fetches only files the record lists in its `muxl` section, from its
  account's server, each checked against its address; the tile checks each one again before using it. The poster
  (the first frame) comes through `{ picture }`, as Places' card. It only ever sends `piece`, `picture` and `link`.
- **Playing:** `index.json` and both init segments are asked for as the record comes (with the poster), nothing else
  before ▶. On play and after a jump, the second being watched and the next two (picture and sound) are asked for
  together; Media Source Extensions (ManagedMediaSource on iPhones); the watchdog for Chrome's and Edge's stall; a
  piece the host couldn't fetch is asked for again after 1.5 s while it's still needed. Bytes aren't kept once
  appended (a second the browser let go of is asked for again; Raku's kept files may answer).
- **The progress bar is the seconds:** one cell each, bright green once its picture and sound are checked, dim green
  for sound only, amber while arriving, red for a piece that didn't match its address (not played). Click or drag
  to jump.
- **Listen only (🎧):** only the sound pieces (about a tenth of the bytes), four seconds ahead, the poster in the
  picture's place; the time carries over both ways.
- **Looks:** the gear's menu, the squirrel tile's five CSS looks (Original, Black & white, Sepia, Polaroid, Noir),
  remembered in the tile's own storage. WebGL looks are a later update.
- **Credits:** over the video: band, the record's credits (names only), where, when, how it was recorded, the tour;
  the record's links as buttons, each asked of the host (`{ link }`; Raku shows it in its link message first: a tile
  can't open pages itself); "Shared by @handle".
- **Small frames** (a tile post's slot, a phone: under 560 px wide or 360 px high): tighter controls, the title
  smaller; the top right left clear for the host's own buttons. The title and controls fade while it plays.
- **The look of the page:** black around the video; the states without one (waiting, opened alone, not a video, a
  format it doesn't play yet) in the travel pages' cream, `video\tile\video.css`'s `:root` line the same as
  `place\tile\place.css`'s (`test\video.test.mjs` checks).
- **The card pictures:** a play button and the seconds bar (no footage: it plays anyone's video), drawn by
  `python video\dev\card_art.py` (Pillow) into `video\tile\`.
- `npm run dev-video`: http://127.0.0.1:5250/ holds the tile in a stand-in host that plays the concert's real media
  from `C:\thunderbird-cafe\video-tracks\videos\waxahatchee-fruits` (made there with `npm run media`; another
  folder with `VIDEO_DIR`), answers its requests as Raku does, can refuse, lose or change a piece, sends other
  records, and logs what the tile asks; `?lat=300&bw=1250000` slows it to the owner's connection.
- `test\video.test.mjs` (part of `npm test`); `test\browser\check_video.mjs` through the stand-in host, including
  frame by frame at the owner's speed (run in the build chat); Raku's `test\browser\check_video_renderer.py` through
  the real loader.

**Publishing it** (`--video`: this tile only), in `C:\thunderbird-cafe\renderer-tiles`:

```
node scripts/publish.mjs --video --dry-run
node scripts/publish.mjs --video
```

Then its address and record CID go in `RENDERERS['cafe.thunderbird.video.track']` in
`C:\thunderbird-cafe\raku\src\config.js` (the script prints them) before Raku is pushed.
