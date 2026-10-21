// Builds the web app into web/dist (esbuild, no other tooling).
// Usage: npm run build:web   (dev deps: esbuild, react, react-dom, react-icons)
import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const out = path.join(root, 'web/dist');
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(path.join(out, 'assets'), { recursive: true });

const result = await build({
  entryPoints: [path.join(root, 'web/src/main.jsx')],
  bundle: true,
  minify: true,
  format: 'esm',
  target: ['es2020', 'chrome100', 'firefox100', 'safari15'],
  jsx: 'automatic',
  outdir: path.join(out, 'assets'),
  entryNames: '[name]-[hash]',
  assetNames: '[name]-[hash]',
  metafile: true,
  legalComments: 'none',
  define: { 'process.env.NODE_ENV': '"production"' },
  nodePaths: process.env.NODE_PATH ? process.env.NODE_PATH.split(':') : [],
  logLevel: 'info',
});

const outputs = Object.keys(result.metafile.outputs).map((f) => path.relative(out, path.resolve(f)));
const js = outputs.find((f) => f.endsWith('.js'));
const css = outputs.find((f) => f.endsWith('.css'));
const html = fs.readFileSync(path.join(root, 'web/index.html'), 'utf8')
  .replace('<!--CSS-->', css ? `<link rel="stylesheet" href="/${css}">` : '')
  .replace('<!--JS-->', `<script type="module" src="/${js}"></script>`);
fs.writeFileSync(path.join(out, 'index.html'), html);
fs.copyFileSync(path.join(root, 'web/favicon.svg'), path.join(out, 'favicon.svg'));
console.log('web/dist ->', js, css);
