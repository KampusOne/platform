import {defineConfig} from 'vitest/config';
import {readFileSync} from 'node:fs';
export default defineConfig({plugins:[{
  name:'worker-codec-module',enforce:'pre',
  resolveId(source){if(source.endsWith('webp_dec.wasm'))return '\0private-webp-decoder';},
  load(id){if(id==='\0private-webp-decoder')return `export default new WebAssembly.Module(Uint8Array.from(atob('${readFileSync(new URL('./node_modules/@jsquash/webp/codec/dec/webp_dec.wasm',import.meta.url)).toString('base64')}'),c=>c.charCodeAt(0)));`;},
}],test:{hookTimeout:60000}});
