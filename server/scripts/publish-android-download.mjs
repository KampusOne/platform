import {readFileSync,writeFileSync,statSync,createReadStream} from 'node:fs';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';

const receipt=JSON.parse(readFileSync('KampusOne-Android-build.json','utf8'));
if(!/^[a-f0-9]{40}$/.test(receipt.sourceSha)||receipt.sourceSha!==process.env.BUILD_SHA)throw new Error('APK source receipt does not match the verified release.');
const hash=createHash('sha256');
for await(const chunk of createReadStream('KampusOne-Android.apk'))hash.update(chunk);
if(hash.digest('hex')!==receipt.apkSha256||statSync('KampusOne-Android.apk').size!==receipt.apkSizeBytes)throw new Error('APK bytes do not match the inspected package receipt.');
const objectKey=`releases/android/${receipt.sourceSha}.apk`;
writeFileSync('KampusOne-Android-download.json',JSON.stringify({...receipt,objectKey}));
function upload(key,file,type){
 const r=spawnSync('npx',['--yes','wrangler@4.130.0','r2','object','put',`kampusone-media/${key}`,'--file',file,'--content-type',type,'--remote'],{stdio:'inherit'});
 if(r.status!==0)throw new Error('Website download publication failed; the existing download pointer remains intact.');
}
// Publish immutable bytes first. Updating the small pointer is the final step.
upload(objectKey,'KampusOne-Android.apk','application/vnd.android.package-archive');
upload('releases/android/latest.json','KampusOne-Android-download.json','application/json');
console.log(`Website download published for ${receipt.versionName} (${receipt.sourceSha}).`);
