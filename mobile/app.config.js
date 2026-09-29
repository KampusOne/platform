const fs = require("fs");
const path = require("path");

module.exports = ({ config }) => {
  const projectId = process.env.EXPO_PUBLIC_EAS_PROJECT_ID?.trim();
  const googleServicesFile =
    process.env.GOOGLE_SERVICES_JSON_PATH?.trim() || "./google-services.json";
  const googleServicesPath = path.resolve(__dirname, googleServicesFile);
  const googleServiceInfoFile =
    process.env.GOOGLE_SERVICE_INFO_PLIST_PATH?.trim() ||
    "./GoogleService-Info.plist";
  const googleServiceInfoPath = path.resolve(__dirname, googleServiceInfoFile);

  return {
    ...config,
    extra: {
      ...config.extra,
      ...(projectId
        ? {
            eas: {
              ...(config.extra?.eas || {}),
              projectId,
            },
          }
        : {}),
    },
    ios: {
      ...config.ios,
      ...(fs.existsSync(googleServiceInfoPath)
        ? { googleServicesFile: googleServiceInfoFile }
        : {}),
    },
    android: {
      ...config.android,
      ...(fs.existsSync(googleServicesPath) ? { googleServicesFile } : {}),
    },
  };
};
