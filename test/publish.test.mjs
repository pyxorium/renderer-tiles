// Publishing a renderer (scripts\publish.mjs, the renderers' part of maze-tiles' publish script, moved here Nov 20 2026):
// which renderer the command line names, a dry run, published once and --again, a wrong password or "no", and every
// file read back. Each renderer's own publish test is in its test file (place, signpost, track).
import test from 'node:test';
import assert from 'node:assert/strict';
import { runPublish, kindOf, ACCOUNT } from '../scripts/publish.mjs';
import { PLACE_TILES, SIGNPOST_TILES, TRACK_TILES, VIDEO_TILES } from '../scripts/tiles.mjs';
import { createFakePds } from './fake-pds.mjs';
import { dagCborCid } from '../scripts/lib/dagcbor.js';
import { rawCid } from '../scripts/lib/cid.js';

const quiet = () => {};
const cafePds = () => createFakePds({ did: ACCOUNT, handle: 'thunderbird.cafe' });
function run(pds, opts = {}) {
  let published = opts.published || {};
  const logs = [];
  return runPublish({
    fetchImpl: pds.fetchImpl, log: (s) => logs.push(s), ask: async () => opts.answer ?? 'y', askHidden: async () => opts.password ?? 'right-password',
    readPublished: () => published, writePublished: (o) => { published = o; }, tiles: TRACK_TILES,
    now: () => '2026-11-20T12:00:00.000Z', ...opts,
  }).then((r) => ({ ...r, published, logs }));
}

test('the command line names exactly one renderer', () => {
  assert.equal(kindOf(['--place']), PLACE_TILES);
  assert.equal(kindOf(['--signpost', '--dry-run']), SIGNPOST_TILES);
  assert.equal(kindOf(['--again', '--track']), TRACK_TILES);
  assert.equal(kindOf(['--video', '--dry-run']), VIDEO_TILES);
  assert.throws(() => kindOf([]), /--place, --signpost, --track or --video/);
  assert.throws(() => kindOf(['--dry-run']), /--place, --signpost, --track or --video/);
  assert.throws(() => kindOf(['--place', '--track']), /one at a time/);
});

test('without a renderer named, nothing is asked or written', async () => {
  const pds = cafePds();
  await assert.rejects(run(pds, { tiles: undefined }), /--place, --signpost, --track or --video/);
  assert.equal(pds.calls.length, 0);
});

test('a dry run writes nothing and asks nothing', async () => {
  const pds = cafePds();
  const r = await run(pds, { dryRun: true, askHidden: async () => { throw new Error('asked'); } });
  assert.equal(r.changed, false);
  assert.deepEqual(r.plan.map((t) => t.id), ['track-renderer']);
  assert.ok(!pds.calls.some((c) => /uploadBlob|createRecord|putRecord|createSession/.test(c)), 'nothing written');
});

test('publishing: a Foundry-shaped record, every file read back', async () => {
  const pds = cafePds();
  const r = await run(pds);
  assert.equal(r.changed, true);
  const p = r.published['track-renderer'];
  assert.match(p.uri, new RegExp(`^at://${ACCOUNT}/ing.dasl.masl/`), 'from thunderbird.cafe');
  assert.deepEqual(r.published.accounts, { 'thunderbird.cafe': ACCOUNT });
  const value = pds.records.get(`ing.dasl.masl/${p.uri.split('/').pop()}`).value;
  assert.equal(value.$type, 'ing.dasl.masl');
  assert.equal(value.cid, await dagCborCid(value.tile));
  assert.deepEqual(value.tile.sizing, { width: 640, height: 480 });
  const csp = value.tile.resources['/']['content-security-policy'];
  assert.match(csp, /connect-src 'self'/, 'it can\'t reach the network');
  for (const [path, entry] of Object.entries(value.tile.resources)) {
    const b = pds.blobs.get(entry.src.ref.$link);
    assert.ok(b, `${path} uploaded`);
    assert.equal(await rawCid(b.bytes), entry.src.ref.$link);
  }
});

test('published once: nothing to do; --again: a new record, and the earlier one named for deleting', async () => {
  const pds = cafePds();
  const first = await run(pds);
  const second = await run(pds, { published: first.published });
  assert.equal(second.changed, false);
  const again = await run(pds, { published: first.published, again: true });
  assert.equal(again.changed, true);
  assert.notEqual(again.published['track-renderer'].uri, first.published['track-renderer'].uri);
  assert.ok(again.logs.some((l) => l.includes(`The earlier record (${first.published['track-renderer'].uri})`)));
});

test('a wrong password or "no" publishes nothing', async () => {
  const pds = cafePds();
  await assert.rejects(run(pds, { password: 'wrong' }), /Invalid identifier or password/);
  const no = await run(pds, { answer: 'n' });
  assert.equal(no.changed, false);
  assert.ok(!pds.calls.some((c) => c.includes('uploadBlob')));
});
