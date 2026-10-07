import {randomBytes} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {readFileSync,writeFileSync,chmodSync} from 'node:fs';
import {fileURLToPath} from 'node:url';

const target=process.argv[2];
if(!target||!process.env.RUNNER_TEMP||!target.startsWith(process.env.RUNNER_TEMP+'/'))throw new Error('Use a temporary runner path for identity configuration.');
const output=execFileSync(fileURLToPath(new URL('../node_modules/.bin/wrangler',import.meta.url)),['secret','list','--name','platformp'],{encoding:'utf8',timeout:60000});
const start=output.indexOf('['),end=output.lastIndexOf(']');
if(start<0||end<start)throw new Error('Unable to check existing secret names.');
const names=new Set(JSON.parse(output.slice(start,end+1)).map(s=>s.name));
const secrets={};
if(!names.has('KYC_FINGERPRINT_SECRET'))throw new Error('The existing identity fingerprint configuration must be preserved and available.');
if(!names.has('KYC_ENCRYPTION_KEY')){
 const proof=JSON.parse(readFileSync(new URL('../../database/verification/production-20261001-october.json',import.meta.url),'utf8'));
 const check=proof.identityProvisioning;
 const age=Date.now()-Date.parse(check?.checkedAt);
 if(proof.environment!=='production'||proof.projectId!=='rough-breeze-36415261'||proof.branchId!=='br-quiet-butterfly-ayrj264q'||check?.encryptedIdentity!==0||check?.encryptedDrafts!==0||!Number.isFinite(age)||age<0||age>6*60*60*1000)throw new Error('A fresh zero-encrypted-record production check is required before initial key provisioning.');
 secrets.KYC_ENCRYPTION_KEY=randomBytes(32).toString('hex');
}
const fcmEncoded=process.env.FCM_SERVICE_ACCOUNT_JSON_BASE64?.trim();
if(!fcmEncoded)throw new Error('FCM_SERVICE_ACCOUNT_JSON_BASE64 is required for reliable Android push delivery.');
let fcm;
try{fcm=JSON.parse(Buffer.from(fcmEncoded,'base64').toString('utf8'));}catch{throw new Error('FCM service account JSON is invalid.');}
if(typeof fcm?.project_id!=='string'||typeof fcm?.client_email!=='string'||typeof fcm?.private_key!=='string')throw new Error('FCM service account must include project_id, client_email and private_key.');
secrets.FCM_SERVICE_ACCOUNT_JSON=JSON.stringify(fcm);
// Wrangler applies this file additively to the new Worker deployment. Existing
// encryption keys and all unrelated provider credentials are never replaced.
writeFileSync(target,JSON.stringify(secrets),{mode:0o600});chmodSync(target,0o600);
console.log(Object.keys(secrets).length?'Initial identity encryption will be configured with this Worker release.':'Existing identity encryption configuration will be retained.');
