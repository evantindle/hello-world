#!/usr/bin/env node
// Build Gravitas into ONE self-contained HTML file (JS, CSS and fonts inlined):
//   npm run build:single   →  dist-single/gravitas.html
// Open it straight from disk, email it, or host it anywhere static.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, 'dist-single');

await build({
  root,
  logLevel: 'warn',
  build: {
    outDir,
    emptyOutDir: true,
    assetsInlineLimit: Number.MAX_SAFE_INTEGER,
    cssCodeSplit: false,
    modulePreload: false,
    rollupOptions: { output: { inlineDynamicImports: true } },
  },
});

let html = fs.readFileSync(path.join(outDir, 'index.html'), 'utf8');
const read = (href) => fs.readFileSync(path.join(outDir, href.replace(/^\.?\//, '')), 'utf8');
html = html.replace(/<link rel="stylesheet"[^>]*href="([^"]+)"[^>]*>/g, (_m, href) => `<style>\n${read(href)}\n</style>`);
html = html.replace(
  /<script type="module"[^>]*src="([^"]+)"[^>]*><\/script>/g,
  (_m, src) => `<script type="module">\n${read(src).replace(/<\/script/gi, '<\\/script')}\n</script>`,
);
if (/src="\.\/assets|href="\.\/assets/.test(html)) throw new Error('Unresolved asset reference left in HTML');

const file = path.join(outDir, 'gravitas.html');
fs.writeFileSync(file, html);
fs.rmSync(path.join(outDir, 'assets'), { recursive: true, force: true });
fs.rmSync(path.join(outDir, 'index.html'), { force: true });
console.log(`✓ ${path.relative(root, file)} (${(fs.statSync(file).size / 1024).toFixed(0)} KB)`);
