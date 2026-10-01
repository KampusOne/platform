// Source selection adapted from createDefaultMapSources in gods-eye-view (MIT).
// Provider data retains its own attribution and licensing; see THIRD_PARTY_NOTICES.md.
export function createDefaultMapSources(){return {
 defaultId:'osm',sources:[
 {id:'osm',available:true,tiles:['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],attribution:'© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap contributors</a>'},
 {id:'satellite',available:true,tiles:['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],attribution:'Tiles © Esri — Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community',tileFailureFallback:{id:'osm',threshold:2,message:'Satellite imagery is unavailable. Street map is shown.'}}
 ]};}
