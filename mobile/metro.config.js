const path = require('node:path');
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);
// The shared pure commerce helpers are also available in clean Android/web
// builds that install only mobile dependencies.
config.watchFolders = [...(config.watchFolders ?? []), path.resolve(__dirname, '../packages/contracts')];
module.exports = config;
