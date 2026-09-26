// Shares must be stable across preview builds. Domain routing is a release gate.
const configured=process.env.EXPO_PUBLIC_APP_ORIGIN || 'https://kampusone.app';
const origin=new URL(configured);
if(origin.protocol!=='https:' || !(origin.hostname==='kampusone.app'||origin.hostname.endsWith('.kampusone.app')) || origin.username || origin.password || origin.port || origin.pathname!=='/' || origin.search || origin.hash) throw new Error('EXPO_PUBLIC_APP_ORIGIN must be an HTTPS KampusOne production origin.');
export const APP_ORIGIN=origin.origin;
export function appLink(path='') { if(path && (!path.startsWith('/')||path.startsWith('//')))throw new Error('Use an app-relative path.');return APP_ORIGIN+path; }
