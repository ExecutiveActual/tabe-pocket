// Builds dist/index.html: one self-contained file (sim + viewer inlined), works offline on a phone.
import { build } from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
const r = await build({ entryPoints: ['src/view/main.ts'], bundle: true, minify: true, format: 'iife', target: ['safari15'], write: false });
const js = r.outputFiles[0].text.replace(/<\/script/g, '<\\/script');
const html = readFileSync('src/view/index.html', 'utf8').replace('/*BUNDLE*/', () => js);
mkdirSync('dist', { recursive: true }); writeFileSync('dist/index.html', html);
console.log('dist/index.html', (html.length / 1024).toFixed(0) + ' KB');
