// Exporte les illustrations en PNG, polices Inter et Fira Code intégrées (le SVG seul, affiché
// par <img>, retombe sur les polices du système). Pour le livrable PDF, la vidéo, les slides.
//   node site/scripts/export.mjs [--scale 2] [--out dossier] [nom…]
// Sans nom, exporte tous les SVG de site/illustrations/. Par défaut : 3200×1800, dans
// site/illustrations/png/.

import { readFileSync, readdirSync, mkdirSync } from 'node:fs';
import { dirname, join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const SITE = join(dirname(fileURLToPath(import.meta.url)), '..');
const ILLU = join(SITE, 'illustrations');

const args = process.argv.slice(2);
let scale = 2;
let out = join(ILLU, 'png');
const names = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--scale') scale = Number(args[++i]);
  else if (args[i] === '--out') out = args[++i];
  else names.push(basename(args[i], '.svg'));
}

const font = (file) => readFileSync(join(SITE, 'fonts', file)).toString('base64');
const css = `
@font-face{font-family:Inter;src:url(data:font/woff2;base64,${font('inter-latin.woff2')}) format('woff2');font-weight:100 900}
@font-face{font-family:'Fira Code';src:url(data:font/woff2;base64,${font('fira-code.woff2')}) format('woff2');font-weight:300 700}
html,body{margin:0;background:#fff}svg{display:block}`;

const files = readdirSync(ILLU)
  .filter((f) => f.endsWith('.svg'))
  .filter((f) => names.length === 0 || names.includes(basename(f, '.svg')));

mkdirSync(out, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: scale, viewport: { width: 1600, height: 900 } });
for (const f of files) {
  const svg = readFileSync(join(ILLU, f), 'utf8').replace(/<\?xml[^>]*\?>/, '');
  await page.setContent(`<!doctype html><html><head><meta charset="utf-8"><style>${css}</style></head><body>${svg}</body></html>`);
  await page.evaluate(() => document.fonts.ready);
  const target = join(out, f.replace(/\.svg$/, '.png'));
  await page.locator('svg').first().screenshot({ path: target });
  console.log(target);
}
await browser.close();
