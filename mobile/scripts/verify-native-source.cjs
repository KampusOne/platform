const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'..'),digest=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const sources=fs.readdirSync(path.join(root,'plugins/kampus-alarms')).filter(file=>file.endsWith('.java')).sort();
const hashes={};
for(const file of sources){const source=path.join(root,'plugins/kampus-alarms',file),generated=path.join(root,'android/app/src/main/java/app/kampusone/alarms',file);hashes[file]=digest(source);if(digest(generated)!==hashes[file])throw new Error('Generated native plugin differs: '+file);}
for(const file of ['kampus-download-wordmark.png','fonts/lato-bold.ttf','fonts/lato-black.ttf','fonts/inter-regular.ttf','fonts/inter-semibold.ttf'])if(!fs.existsSync(path.join(root,'android/app/src/main/assets',file)))throw new Error('Native asset missing: '+file);
const application=fs.readFileSync(path.join(root,'android/app/src/main/java/app/kampusone/mobile/MainApplication.kt'),'utf8');
if(!application.includes('KampusAlarmPackage'))throw new Error('Native module package was not registered.');
const config=JSON.parse(fs.readFileSync(path.join(root,'app.json'),'utf8')).expo;
const receipt={sourceSha:process.env.SOURCE_SHA??null,package:config.android.package,version:config.version,versionCode:config.android.versionCode,javaSources:hashes,assets:'present',compilation:process.argv.includes('--compiled')?'PASS':'not yet run',configuration:'synthetic compile-only; no functional Firebase/Expo credentials',apkProduced:false,deviceTested:false};
fs.writeFileSync(path.join(root,'android-source-compilation.json'),JSON.stringify(receipt,null,2)+'\n');
console.log('Native plugin source and asset fingerprints verified; APK/device acceptance remains separate.');
