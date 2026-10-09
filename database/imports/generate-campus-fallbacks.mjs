import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// The reviewed directory is shared by online, offline and empty-database maps.
// IDs and verification timestamps remain identical to the actual live directory.
const root = new URL('../../', import.meta.url);
const reviewed = JSON.parse(readFileSync(new URL('uniben-map2-2026-10-06.json', import.meta.url), 'utf8'));
const corrections = JSON.parse(readFileSync(new URL('uniben-ground-truth-corrections-2026-10-07.json', import.meta.url), 'utf8'));
const referencePois = JSON.parse(readFileSync(new URL('uniben-reference-pois-2026-10-09.json', import.meta.url), 'utf8'));
const correctionById = new Map(corrections.places.map(place => [place.id, place]));
const directory = reviewed.directory.map(place => {
  const correction = correctionById.get(place.id);
  return correction ? {...place, latitude: correction.latitude, longitude: correction.longitude, verified_at: null} : place;
});
const expandedDirectory = [...directory,...referencePois.places.map(p=>({...p,verified_at:null}))];
const rows = expandedDirectory.map(p => [p.id,p.name,p.category,p.description,
  String(p.latitude),String(p.longitude),p.search_aliases ?? [],p.verified_at]);
const serverPath = new URL('server/src/lib/campus-defaults.ts', root);
let server = readFileSync(serverPath, 'utf8').replace(/const REVIEWED_AT = .*?;\n\n/, '')
  .replace('verified: boolean,', 'verifiedAt: string | null,')
  .replace(/(?:\/\/ Generated from database\/imports\/uniben-map2-2026-10-06\.json[^\n]*\n)*const RAW_UNIBEN_UGBOWO_PLACES = \[[\s\S]*?\] satisfies readonly RawStarterPlace\[\];/,
    `// Generated from database/imports/uniben-map2-2026-10-06.json plus 2026-10-07 corrections and 2026-10-09 reference POIs.\nconst RAW_UNIBEN_UGBOWO_PLACES = ${JSON.stringify(rows,null,2)} satisfies readonly RawStarterPlace[];`)
  .replace('aliases, verified])', 'aliases, verifiedAt])').replace('verified_at: verified ? REVIEWED_AT : null,','verified_at: verifiedAt,');
writeFileSync(serverPath,server);
const mobilePath = new URL('mobile/src/lib/campus-data.ts', root);
const mobile = readFileSync(mobilePath,'utf8');
const header=mobile.slice(0,mobile.indexOf('export const UNIBEN_UGBOWO_FALLBACK'))
  .replace(/\/\/ Generated from database\/imports\/uniben-map2-2026-10-06\.json[^\n]*\n?$/,'');
writeFileSync(mobilePath,header+`// Generated from database/imports/uniben-map2-2026-10-06.json plus 2026-10-07 corrections and 2026-10-09 reference POIs.\nexport const UNIBEN_UGBOWO_FALLBACK: CampusPlace[] = (${JSON.stringify(rows,null,2)} as Array<\n  [string, string, string, string, string, string, string[], string | null]\n>).map(([id,name,category,description,latitude,longitude,aliases,verifiedAt]) => ({\n  id,name,category,description,latitude,longitude,accessibility_notes:null,image_url:null,\n  search_aliases:aliases,verified_at:verifiedAt,\n}));\n`);
console.log(`Generated ${rows.length} reviewed campus places in both fallbacks.`);
