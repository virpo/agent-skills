import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import vm from 'node:vm';

const scripts = new URL('../skills/infinite-book-explainer/scripts/', import.meta.url).pathname;

async function loadClock() {
  const source = await readFile(join(scripts, 'virtual-clock.js'), 'utf8');
  const sandbox = { performance: {}, Date: { now: () => 0 }, Math: Object.create(Math), console };
  sandbox.window = sandbox;
  vm.runInNewContext(source, sandbox);
  return sandbox;
}

test('virtual clock runs timers in order and hands frames the virtual time', async () => {
  const page = await loadClock();
  const log = [];
  page.setTimeout(() => log.push(['late', page.performance.now()]), 50);
  page.setTimeout(() => log.push(['early', page.performance.now()]), 10);
  page.requestAnimationFrame(t => log.push(['frame', t]));
  const cancelled = page.setTimeout(() => log.push(['cancelled']), 5);
  page.clearTimeout(cancelled);

  page.__clock.advance(30);
  assert.deepEqual(log, [['early', 10], ['frame', 30]]);

  page.__clock.advance(60);
  assert.deepEqual(log.at(-1), ['late', 50]);
  assert.equal(page.performance.now(), 60);
});

test('virtual clock repeats intervals and makes random numbers reproducible', async () => {
  const a = await loadClock();
  const b = await loadClock();
  let ticks = 0;
  a.setInterval(() => ticks++, 16);
  a.__clock.advance(100);
  assert.equal(ticks, 6);
  assert.deepEqual([a.Math.random(), a.Math.random()], [b.Math.random(), b.Math.random()]);
});

const python = spawnSync('python3', ['-c', 'import numpy, PIL, scipy, skimage'], { encoding: 'utf8' });
const hasPython = python.status === 0;

function run(args) {
  const r = spawnSync('python3', args, { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout;
}

test('tile.py align undoes a small shift and reports an improved score', { skip: !hasPython && 'needs python3 with numpy, Pillow, scipy and scikit-image' }, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'infinite-book-'));
  try {
    run(['-c', `
import numpy as np
from PIL import Image
from scipy.ndimage import gaussian_filter, shift
rng = np.random.default_rng(3)
base = gaussian_filter(rng.random((512, 768)), 3)
base = (base - base.min()) / (base.max() - base.min())
for k in range(60):
    y, x = rng.integers(20, 490), rng.integers(20, 740)
    base[y:y + 14, x:x + 22] = rng.random()
Image.fromarray((base * 255).astype(np.uint8)).convert('RGB').save('${dir}/crop.png')
moved = shift(base, (6, -9), mode='nearest')
Image.fromarray((moved * 255).astype(np.uint8)).convert('RGB').save('${dir}/raw.png')
`]);
    const result = JSON.parse(run([join(scripts, 'tile.py'), 'align', `${dir}/crop.png`, `${dir}/raw.png`, `${dir}/tile.png`]));
    assert.equal(result.warped, true);
    assert.ok(result.after > result.before, JSON.stringify(result));
    assert.ok(result.after > 0.98, JSON.stringify(result));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('cutout.py keeps painted pieces and drops the paper', { skip: !hasPython && 'needs python3 with numpy, Pillow, scipy and scikit-image' }, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'infinite-book-'));
  try {
    run(['-c', `
from PIL import Image, ImageDraw
im = Image.new('RGB', (600, 400), (249, 247, 242))
d = ImageDraw.Draw(im)
d.rectangle((60, 80, 220, 300), fill=(180, 40, 30), outline=(30, 25, 20), width=4)
d.ellipse((330, 100, 540, 310), fill=(40, 90, 160), outline=(30, 25, 20), width=4)
im.save('${dir}/sheet.png')
`]);
    const pieces = JSON.parse(run([join(scripts, 'cutout.py'), `${dir}/sheet.png`, `${dir}/piece`, '2000']));
    assert.equal(pieces.length, 2);
    assert.ok(pieces[0].x < pieces[1].x);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('grid.py and tile.py crop write images of the expected size', { skip: !hasPython && 'needs python3 with numpy, Pillow, scipy and scikit-image' }, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'infinite-book-'));
  try {
    run(['-c', `from PIL import Image; Image.new('RGB', (640, 360), (249, 247, 242)).save('${dir}/plate.png')`]);
    run([join(scripts, 'grid.py'), `${dir}/plate.png`, `${dir}/grid.png`, '32']);
    run([join(scripts, 'tile.py'), 'crop', `${dir}/plate.png`, '100.5', '40', '150', '100', `${dir}/src.png`]);
    const sizes = run(['-c', `from PIL import Image; print(Image.open('${dir}/grid.png').size, Image.open('${dir}/src.png').size)`]);
    assert.equal(sizes.trim(), '(640, 360) (1536, 1024)');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
