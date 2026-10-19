const { withGradleProperties } = require('expo/config-plugins');

// React Native AsyncStorage 2.x uses SQLite on Android; default total limit is
// 6 MB. Set a bounded 16 MB ceiling for offline drafts and encrypted snapshots.
// This is applied only by native prebuild: already-installed APKs do not change.
module.exports = function withKampusAsyncStorage(config) {
  return withGradleProperties(config, current => {
    current.modResults = current.modResults.filter(
      item => !(item.type === 'property' && item.key === 'AsyncStorage_db_size_in_MB'),
    );
    current.modResults.push({ type: 'property', key: 'AsyncStorage_db_size_in_MB', value: '16' });
    return current;
  });
};
