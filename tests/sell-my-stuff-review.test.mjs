import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createReviewServer, validateEdit } from '../skills/sell-my-stuff/scripts/review.mjs';

let dir, listingsPath, server, base;

const listings = {
  version: 1,
  photosDir: 'photos',
  currency: 'EUR',
  items: [
    { id: 'bike', title: 'Mountain bike, size L', description: 'Lightly used.', photos: ['bike-1.jpg'], suggestedPrice: 289, price: 289, include: true },
    { id: 'lamp', title: 'Desk lamp', description: 'Works.', photos: [], suggestedPrice: 15, price: 15, include: true },
  ],
  review: { done: false },
};

before(async () => {
  dir = await mkdtemp(join(tmpdir(), 'sell-my-stuff-'));
  await mkdir(join(dir, 'photos'));
  await writeFile(join(dir, 'photos', 'bike-1.jpg'), Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
  await writeFile(join(dir, 'secret.jpg'), 'outside');
  listingsPath = join(dir, 'listings.json');
  await writeFile(listingsPath, JSON.stringify(listings));
  server = createReviewServer({ listingsPath });
  await new Promise(ok => server.listen(0, '127.0.0.1', ok));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise(ok => server.close(ok));
  await rm(dir, { recursive: true, force: true });
});

const saved = async () => JSON.parse(await readFile(listingsPath, 'utf8'));
const put = (id, body) => fetch(`${base}/api/items/${id}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

test('serves the review page and the listings', async () => {
  const page = await fetch(`${base}/`);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /Price review/);
  const data = await (await fetch(`${base}/api/listings`)).json();
  assert.equal(data.items.length, 2);
});

test('writes a price edit back to listings.json', async () => {
  const res = await put('bike', { price: 250 });
  assert.equal(res.status, 200);
  const data = await saved();
  assert.equal(data.items[0].price, 250);
  assert.equal(data.items[0].suggestedPrice, 289, 'suggested price is kept for reference');
  assert.ok(data.review.updatedAt);
});

test('keeps concurrent edits to different items', async () => {
  await Promise.all([put('bike', { title: 'Bike L' }), put('lamp', { include: false })]);
  const data = await saved();
  assert.equal(data.items[0].title, 'Bike L');
  assert.equal(data.items[1].include, false);
});

test('rejects invalid edits and unknown items', async () => {
  assert.equal((await put('bike', { price: -5 })).status, 400);
  assert.equal((await put('bike', { price: '12' })).status, 400);
  assert.equal((await put('bike', { photos: ['x.jpg'] })).status, 400, 'only reviewable fields can change');
  assert.equal((await put('nope', { price: 1 })).status, 404);
  assert.equal((await saved()).items[0].price, 250);
});

test('serves photos only from the photo folder', async () => {
  const ok = await fetch(`${base}/photos/bike-1.jpg`);
  assert.equal(ok.status, 200);
  assert.equal(ok.headers.get('content-type'), 'image/jpeg');
  const escape = await fetch(`${base}/photos/..%2Fsecret.jpg`);
  assert.notEqual(escape.status, 200);
  assert.equal((await fetch(`${base}/photos/../listings.json`)).status, 404);
});

test('marks the review done', async () => {
  const res = await fetch(`${base}/api/done`, { method: 'POST' });
  assert.equal(res.status, 200);
  const data = await saved();
  assert.equal(data.review.done, true);
  assert.ok(data.review.doneAt);
});

test('validateEdit accepts null price to mean no price yet', () => {
  assert.deepEqual(validateEdit({ price: null }).errors, []);
  assert.deepEqual(validateEdit({}).errors, ['nothing to update']);
});
