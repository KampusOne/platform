import { mkdirSync } from 'node:fs';
import { build } from 'esbuild';
mkdirSync('public/documents', { recursive: true });
await build({ entryPoints: ['scripts/document-reader.mjs'], outfile: 'public/documents/reader.js', bundle: true, minify: true, platform: 'browser', format: 'iife', target: 'es2022', external: ['node:*', '@napi-rs/canvas'] });
