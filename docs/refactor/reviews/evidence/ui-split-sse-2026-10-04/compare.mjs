#!/usr/bin/env node
/**
 * Compare two screenshot directories pixel by pixel (no image library: the PNGs
 * are decoded by the same Playwright Chromium through a canvas).
 *
 *   node compare.mjs <dirA> <dirB> [--threshold 0] [--tolerance 2]
 *
 * Prints JSON: per file the byte equality, decoded size, differing pixel count
 * (any channel delta > threshold), the largest channel delta, a few sample
 * pixels, the bounding box of the differences and a non-empty check for dirA
 * (sampled distinct colours and the share of pixels that differ from the most
 * common colour). The summary also lists files whose largest channel delta is
 * above `tolerance` (default 2/255: anti-aliasing noise stays below it).
 * Use it for run-to-run determinism (before vs before) and later for before
 * vs after.
 */
import { createRequire } from 'node:module';
import { readdir, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_DIR ? join(process.env.PLAYWRIGHT_DIR, 'index.js') : 'playwright');
const args = process.argv.slice(2);
const numberOption = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? Number(args[index + 1]) : fallback;
};
const positional = args.filter((arg, index) => !arg.startsWith('--') && !(index > 0 && args[index - 1].startsWith('--')));
const [dirA, dirB] = positional;
const threshold = numberOption('threshold', 0);
const tolerance = numberOption('tolerance', 2);
if (dirA === undefined || dirB === undefined) {
  process.stderr.write('usage: node compare.mjs <dirA> <dirB> [--threshold 0] [--tolerance 2]\n');
  process.exit(2);
}
const filesA = (await readdir(dirA)).filter(name => name.endsWith('.png')).sort();
const filesB = new Set((await readdir(dirB)).filter(name => name.endsWith('.png')));
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
await page.setContent('<canvas id="a"></canvas><canvas id="b"></canvas>');
const results = [];
for (const name of filesA) {
  const a = await readFile(join(dirA, name));
  const entry = { file: name, bytesA: a.length, sha256A: createHash('sha256').update(a).digest('hex') };
  if (!filesB.has(name)) { results.push({ ...entry, missingInB: true }); continue; }
  const b = await readFile(join(dirB, name));
  entry.bytesB = b.length;
  entry.byteIdentical = Buffer.compare(a, b) === 0;
  const pixel = await page.evaluate(async ({ a, b, threshold }) => {
    const load = src => new Promise((resolvePromise, reject) => {
      const image = new Image(); image.onload = () => resolvePromise(image); image.onerror = reject; image.src = src;
    });
    const decode = async (src, id) => {
      const image = await load(src);
      const canvas = document.getElementById(id);
      canvas.width = image.width; canvas.height = image.height;
      const context = canvas.getContext('2d', { willReadFrequently: true });
      context.drawImage(image, 0, 0);
      return { width: image.width, height: image.height, data: context.getImageData(0, 0, image.width, image.height).data };
    };
    const left = await decode(a, 'a');
    const right = await decode(b, 'b');
    // Non-empty check on A: most common colour share and sampled distinct colours.
    const counts = new Map();
    for (let index = 0; index < left.data.length; index += 4 * 7) {
      const key = (left.data[index] << 16) | (left.data[index + 1] << 8) | left.data[index + 2];
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    const samples = [...counts.values()].reduce((sum, value) => sum + value, 0);
    const dominant = Math.max(...counts.values());
    const content = { sampledDistinctColours: counts.size, nonDominantShare: Number((1 - dominant / samples).toFixed(4)) };
    if (left.width !== right.width || left.height !== right.height) {
      return { sizeA: [left.width, left.height], sizeB: [right.width, right.height], sizeMismatch: true, content };
    }
    let differing = 0; let maxDelta = 0; const diffSamples = []; let minX = Infinity; let minY = Infinity; let maxX = -1; let maxY = -1;
    for (let index = 0; index < left.data.length; index += 4) {
      const delta = Math.max(Math.abs(left.data[index] - right.data[index]), Math.abs(left.data[index + 1] - right.data[index + 1]),
        Math.abs(left.data[index + 2] - right.data[index + 2]), Math.abs(left.data[index + 3] - right.data[index + 3]));
      if (delta > threshold) {
        differing += 1; if (delta > maxDelta) maxDelta = delta;
        const pixelIndex = index / 4; const x = pixelIndex % left.width; const y = Math.floor(pixelIndex / left.width);
        if (x < minX) minX = x; if (y < minY) minY = y; if (x > maxX) maxX = x; if (y > maxY) maxY = y;
        if (diffSamples.length < 12) diffSamples.push({ x, y, a: Array.from(left.data.slice(index, index + 4)), b: Array.from(right.data.slice(index, index + 4)) });
      }
    }
    return { size: [left.width, left.height], differingPixels: differing, maxChannelDelta: maxDelta, sampleDifferences: diffSamples,
      differingBox: differing === 0 ? null : { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 }, content };
  }, { a: `data:image/png;base64,${a.toString('base64')}`, b: `data:image/png;base64,${b.toString('base64')}`, threshold });
  results.push({ ...entry, ...pixel });
}
await browser.close();
const summary = {
  dirA, dirB, threshold, files: results.length,
  byteIdentical: results.filter(result => result.byteIdentical).length,
  pixelIdentical: results.filter(result => result.differingPixels === 0).length,
  differing: results.filter(result => result.differingPixels > 0 || result.sizeMismatch || result.missingInB).map(result => result.file),
  tolerance,
  aboveTolerance: results.filter(result => result.sizeMismatch || result.missingInB
    || (result.maxChannelDelta ?? 0) > tolerance).map(result => result.file),
  emptyLooking: results.filter(result => result.content !== undefined
    && (result.content.sampledDistinctColours < 8 || result.content.nonDominantShare < 0.02)).map(result => result.file),
};
process.stdout.write(`${JSON.stringify({ summary, results }, null, 2)}\n`);
