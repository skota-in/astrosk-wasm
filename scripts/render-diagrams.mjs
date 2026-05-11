#!/usr/bin/env node
// Render the README's ```mermaid blocks to docs/diagrams/*.svg using mermaid-cli.
//
// npm's README renderer does not support Mermaid, so we pre-render each
// diagram to SVG and reference it as an <img>. GitHub still shows the live
// ```mermaid source above the image fallback.
//
// Requirements: npx @mermaid-js/mermaid-cli (puppeteer-managed Chromium).
// Run: node scripts/render-diagrams.mjs

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const README = resolve(ROOT, 'README.md');
const OUT_DIR = resolve(ROOT, 'docs/diagrams');

const NAMES = ['pipeline', 'set-ephe-path', 'ephe-files', 'verification'];

function extractMermaidBlocks(md) {
  const fence = '```';
  const blocks = [];
  const lines = md.split('\n');
  let i = 0;
  while (i < lines.length) {
    if (lines[i].trim() === fence + 'mermaid') {
      const start = i + 1;
      let j = start;
      while (j < lines.length && lines[j].trim() !== fence) j++;
      blocks.push(lines.slice(start, j).join('\n'));
      i = j + 1;
    } else {
      i++;
    }
  }
  return blocks;
}

const md = await readFile(README, 'utf8');
const blocks = extractMermaidBlocks(md);
if (blocks.length !== NAMES.length) {
  throw new Error(`Found ${blocks.length} mermaid blocks, expected ${NAMES.length}`);
}

await mkdir(OUT_DIR, { recursive: true });

const puppeteerConfig = resolve(tmpdir(), 'astrosk-puppeteer.json');
await writeFile(
  puppeteerConfig,
  JSON.stringify({ args: ['--no-sandbox', '--disable-setuid-sandbox'] }),
);

for (let i = 0; i < blocks.length; i++) {
  const name = NAMES[i];
  const src = resolve(tmpdir(), `astrosk-${name}.mmd`);
  const out = resolve(OUT_DIR, `${name}.svg`);
  await writeFile(src, blocks[i]);
  process.stdout.write(`[${i + 1}/${blocks.length}] ${name}.svg ... `);
  const r = spawnSync(
    'npx',
    ['-y', '@mermaid-js/mermaid-cli', '-p', puppeteerConfig, '-i', src, '-o', out, '-b', 'transparent'],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  );
  if (r.status !== 0) {
    console.error('\n' + (r.stderr?.toString() ?? '') + (r.stdout?.toString() ?? ''));
    throw new Error(`mmdc failed for ${name}`);
  }
  console.log('ok');
}
console.log('Done.');
