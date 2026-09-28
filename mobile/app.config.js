const fs = require("fs");
const path = require("path");

module.exports = ({ config }) => {
  const projectId = process.env.EXPO_PUBLIC_EAS_PROJECT_ID?.trim();
  const googleServicesFile =
    process.env.GOOGLE_SERVICES_JSON_PATH?.trim() || "./google-services.json";
  const googleServicesPath = path.resolve(__dirname, googleServicesFile);

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
    android: {
      ...config.android,
      ...(fs.existsSync(googleServicesPath) ? { googleServicesFile } : {}),
    },
  };
};
