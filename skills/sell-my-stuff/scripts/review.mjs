#!/usr/bin/env node
// Local price review page for sell-my-stuff.
// Usage: node review.mjs <listings.json> [--port 4600]
// Serves the review page on 127.0.0.1 and writes every edit straight back to listings.json.

import { createServer } from 'node:http';
import { readFile, writeFile, rename, realpath } from 'node:fs/promises';
import { dirname, extname, isAbsolute, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const PAGE = join(dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'review.html');
const IMAGE_TYPES = {
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
  '.webp': 'image/webp', '.gif': 'image/gif', '.avif': 'image/avif',
};
const MAX_BODY = 64 * 1024;

export async function readListings(listingsPath) {
  return JSON.parse(await readFile(listingsPath, 'utf8'));
}

async function writeListings(listingsPath, data) {
  const tmp = `${listingsPath}.${process.pid}.tmp`;
  await writeFile(tmp, JSON.stringify(data, null, 2) + '\n');
  await rename(tmp, listingsPath);
}

export function validateEdit(body) {
  const edit = {};
  const errors = [];
  if ('price' in body) {
    if (body.price === null || (typeof body.price === 'number' && Number.isFinite(body.price) && body.price >= 0 && body.price <= 1e7)) edit.price = body.price;
    else errors.push('price must be a non-negative number or null');
  }
  for (const [key, max] of [['title', 200], ['description', 5000]]) {
    if (key in body) {
      if (typeof body[key] === 'string' && body[key].length <= max) edit[key] = body[key];
      else errors.push(`${key} must be a string of at most ${max} characters`);
    }
  }
  if ('include' in body) {
    if (typeof body.include === 'boolean') edit.include = body.include;
    else errors.push('include must be true or false');
  }
  if (!errors.length && !Object.keys(edit).length) errors.push('nothing to update');
  return { edit, errors };
}

function photosRoot(listingsPath, data) {
  const dir = data.photosDir || '.';
  return isAbsolute(dir) ? dir : resolve(dirname(listingsPath), dir);
}

function send(res, status, body, type = 'application/json; charset=utf-8') {
  res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store' });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}

function readBody(req) {
  return new Promise((ok, fail) => {
    let size = 0;
    const chunks = [];
    req.on('data', c => {
      size += c.length;
      if (size > MAX_BODY) { fail(new Error('body too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      try { ok(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); }
      catch { fail(new Error('invalid JSON')); }
    });
    req.on('error', fail);
  });
}

export function createReviewServer({ listingsPath }) {
  listingsPath = resolve(listingsPath);
  // Serialize writes so two quick edits never clobber each other.
  let queue = Promise.resolve();
  const mutate = fn => {
    const run = queue.then(async () => {
      const data = await readListings(listingsPath);
      const result = fn(data);
      if (result?.error) return result;
      data.review = { ...(data.review || {}), updatedAt: new Date().toISOString() };
      if (result?.done) Object.assign(data.review, { done: true, doneAt: data.review.updatedAt });
      await writeListings(listingsPath, data);
      return { data };
    });
    queue = run.catch(() => {});
    return run;
  };

  return createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      const path = decodeURIComponent(url.pathname);

      if (req.method === 'GET' && path === '/') return send(res, 200, await readFile(PAGE), 'text/html; charset=utf-8');
      if (req.method === 'GET' && path === '/api/listings') return send(res, 200, await readListings(listingsPath));

      if (req.method === 'GET' && path.startsWith('/photos/')) {
        const data = await readListings(listingsPath);
        const root = await realpath(photosRoot(listingsPath, data));
        const type = IMAGE_TYPES[extname(path).toLowerCase()];
        if (!type) return send(res, 404, { error: 'not an image' });
        let file;
        try { file = await realpath(join(root, path.slice('/photos/'.length))); }
        catch { return send(res, 404, { error: 'not found' }); }
        if (!file.startsWith(root + sep)) return send(res, 403, { error: 'outside the photo folder' });
        return send(res, 200, await readFile(file), type);
      }

      const itemMatch = path.match(/^\/api\/items\/([^/]+)$/);
      if (req.method === 'PUT' && itemMatch) {
        const { edit, errors } = validateEdit(await readBody(req));
        if (errors.length) return send(res, 400, { error: errors.join('; ') });
        const out = await mutate(data => {
          const item = (data.items || []).find(i => i.id === itemMatch[1]);
          if (!item) return { error: 'unknown item' };
          Object.assign(item, edit);
        });
        if (out.error) return send(res, 404, { error: out.error });
        return send(res, 200, out.data.items.find(i => i.id === itemMatch[1]));
      }

      if (req.method === 'POST' && path === '/api/done') {
        const out = await mutate(() => ({ done: true }));
        return send(res, 200, out.data.review);
      }

      send(res, 404, { error: 'not found' });
    } catch (err) {
      send(res, 500, { error: err.message });
    }
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const listingsPath = args.find(a => !a.startsWith('--'));
  const portFlag = args.indexOf('--port');
  let port = portFlag >= 0 ? Number(args[portFlag + 1]) : 4600;
  let tries = portFlag >= 0 ? 0 : 20; // without --port, step up to the next free port
  if (!listingsPath) {
    console.error('Usage: node review.mjs <listings.json> [--port 4600]');
    process.exit(1);
  }
  await readListings(listingsPath); // fail fast on a missing or broken file
  const server = createReviewServer({ listingsPath });
  server.on('error', err => {
    if (err.code === 'EADDRINUSE' && tries-- > 0) return server.listen(++port, '127.0.0.1');
    if (err.code === 'EADDRINUSE') console.error(`Port ${port} is busy. Try --port ${port + 1}.`);
    else console.error(err.message);
    process.exit(1);
  });
  server.on('listening', () => {
    console.log(`Review page: http://127.0.0.1:${server.address().port}/`);
    console.log(`Edits are saved to ${resolve(listingsPath)}`);
  });
  server.listen(port, '127.0.0.1');
}
