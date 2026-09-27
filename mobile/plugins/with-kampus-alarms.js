const { withAndroidManifest, withMainApplication, withDangerousMod, withAppBuildGradle } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');
module.exports = function withKampusAlarms(config) {
  config = withAndroidManifest(config, config => {
    const manifest = config.modResults.manifest;
    manifest['uses-permission'] ??= [];
    for (const name of ['SCHEDULE_EXACT_ALARM','USE_FULL_SCREEN_INTENT','RECEIVE_BOOT_COMPLETED','WAKE_LOCK','FOREGROUND_SERVICE','FOREGROUND_SERVICE_MEDIA_PLAYBACK','POST_NOTIFICATIONS','VIBRATE']) {
      if (!manifest['uses-permission'].some(item => item.$['android:name'] === `android.permission.${name}`)) manifest['uses-permission'].push({ $: { 'android:name': `android.permission.${name}` } });
    }
    const application = manifest.application[0];
    if (!manifest['uses-permission'].some(item => item.$['android:name'] === 'android.permission.WRITE_EXTERNAL_STORAGE')) manifest['uses-permission'].push({ $: { 'android:name': 'android.permission.WRITE_EXTERNAL_STORAGE', 'android:maxSdkVersion': '28' } });
    application.service ??= [];
    application.receiver ??= [];
    application.activity ??= [];
    const add = (collection, entry) => { if (!collection.some(item => item.$['android:name'] === entry.$['android:name'])) collection.push(entry); };
    add(application.service, { $: { 'android:name': 'app.kampusone.alarms.KampusAlarmService', 'android:exported': 'false', 'android:foregroundServiceType': 'mediaPlayback' } });
    add(application.activity, { $: { 'android:name': 'app.kampusone.alarms.KampusAlarmActivity', 'android:exported': 'false', 'android:excludeFromRecents': 'true', 'android:showWhenLocked': 'true', 'android:turnScreenOn': 'true', 'android:launchMode': 'singleTop', 'android:theme': '@android:style/Theme.Material.Light.NoActionBar' } });
    add(application.receiver, { $: { 'android:name': 'app.kampusone.alarms.KampusAlarmReceiver', 'android:exported': 'false' } });
    add(application.receiver, { $: { 'android:name': 'app.kampusone.alarms.KampusAlarmBootReceiver', 'android:exported': 'false' }, 'intent-filter': [{ action: ['BOOT_COMPLETED','MY_PACKAGE_REPLACED','TIME_SET','TIMEZONE_CHANGED'].map(name => ({ $: { 'android:name': `android.intent.action.${name}` } })).concat([{ $: { 'android:name': 'android.app.action.SCHEDULE_EXACT_ALARM_PERMISSION_STATE_CHANGED' } }]) }] });
    return config;
  });
  config = withMainApplication(config, config => {
    const content = config.modResults.contents;
    if (!content.includes('app.kampusone.alarms.KampusAlarmPackage')) {
      if (!content.includes('PackageList(this).packages.apply {')) throw new Error('KampusOne alarm package: unsupported MainApplication template. Register KampusAlarmPackage explicitly before building.');
      config.modResults.contents = content.replace('PackageList(this).packages.apply {', 'PackageList(this).packages.apply {\n              add(app.kampusone.alarms.KampusAlarmPackage())');
    }
    return config;
  });
  config = withAppBuildGradle(config, config => {
    const dependency = "implementation 'io.github.maitrungduc1410:ffmpeg-kit-min:6.0.6'";
    if (!config.modResults.contents.includes(dependency)) config.modResults.contents += `\n// Same FFmpeg distribution as the installed video trimmer.\ndependencies { ${dependency} }\n`;
    return config;
  });
  return withDangerousMod(config, ['android', async config => {
    const destination = path.join(config.modRequest.platformProjectRoot, 'app/src/main/java/app/kampusone/alarms');
    fs.mkdirSync(destination, { recursive: true });
    const assets = path.join(config.modRequest.platformProjectRoot, 'app/src/main/assets');
    fs.mkdirSync(assets, { recursive: true });
    fs.copyFileSync(path.join(config.modRequest.projectRoot, 'assets/brand/kampusone-horizontal-ink.png'), path.join(assets, 'kampus-download-wordmark.png'));
    for (const file of fs.readdirSync(path.join(__dirname, 'kampus-alarms'))) if (file.endsWith('.java')) fs.copyFileSync(path.join(__dirname, 'kampus-alarms', file), path.join(destination, file));
    return config;
  }]);
};
