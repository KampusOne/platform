// Source selection adapted from createDefaultMapSources in gods-eye-view (MIT).
// Provider data retains its own attribution and licensing; see THIRD_PARTY_NOTICES.md.
export function createDefaultMapSources(satellite){return {
 defaultId:'osm',sources:[
 {id:'osm',available:true,tiles:['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],attribution:'© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap contributors</a>'},
 ...(satellite?.url&&satellite?.attribution?[{id:'satellite',available:true,tiles:[satellite.url],attribution:satellite.attribution}]:[])
 ]};}
