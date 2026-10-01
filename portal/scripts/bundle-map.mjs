import {mkdirSync,copyFileSync} from 'node:fs';
mkdirSync('public/maps',{recursive:true});
for(const name of ['view.html','view.js','providers.js'])copyFileSync(`../mobile/public/maps/${name}`,`public/maps/${name}`);
for(const name of ['maplibre-gl.mjs','maplibre-gl-shared.mjs','maplibre-gl-worker.mjs','maplibre-gl.css'])copyFileSync(`node_modules/maplibre-gl/dist/${name}`,`public/maps/${name}`);
