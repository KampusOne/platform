/** Nonfunctional build input. Never use this fixture for a release or provider test. */
const fs=require('node:fs'),path=require('node:path');
if(process.env.CI!=='1'||process.env.EXPO_PUBLIC_KAMPUSONE_API_URL!=='https://api.example.invalid'||process.env.GOOGLE_SERVICES_JSON_PATH!=='./google-services.compile-only.json')throw new Error('Compile-only fixture requires isolated CI configuration.');
const root=path.resolve(__dirname,'..'),config=JSON.parse(fs.readFileSync(path.join(root,'app.json'),'utf8')).expo;
const fixture={project_info:{project_number:'000000000000',project_id:'kampusone-compile-only',storage_bucket:'compile-only.example.invalid'},client:[{client_info:{mobilesdk_app_id:'1:000000000000:android:0000000000000000',android_client_info:{package_name:config.android.package}},api_key:[{current_key:'compile-only-nonfunctional'}],oauth_client:[]}],configuration_version:'1'};
fs.writeFileSync(path.join(root,'google-services.compile-only.json'),JSON.stringify(fixture,null,2)+'\n');
console.log('Synthetic native compile input prepared; no provider credentials.');
