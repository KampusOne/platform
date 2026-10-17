import { mkdirSync, copyFileSync } from 'node:fs';
import { build } from 'esbuild';
mkdirSync('public/documents', { recursive: true });
copyFileSync('node_modules/@expo-google-fonts/inter/400Regular/Inter_400Regular.ttf','public/documents/inter.ttf');
await build({ entryPoints: ['scripts/document-reader.mjs'], outfile: 'public/documents/reader.js', bundle: true, minify: true, platform: 'browser', format: 'iife', target: 'es2022', external: ['node:*', '@napi-rs/canvas'] });
await build({ entryPoints: ['scripts/learning-viewer.mjs'], outfile: 'public/documents/viewer.js', bundle: true, minify: true, platform: 'browser', format: 'iife', target: 'es2022', external: ['node:*', '@napi-rs/canvas'] });
