const fs = require("fs");
const path = require("path");

module.exports = ({ config }) => {
  const shareOrigin = new URL(process.env.EXPO_PUBLIC_SHARE_ORIGIN || "https://links.kampusone.app");
  if (shareOrigin.protocol !== "https:" || !["links.kampusone.app", "kampusone.app"].includes(shareOrigin.hostname) || shareOrigin.username || shareOrigin.password || shareOrigin.port || shareOrigin.pathname !== "/" || shareOrigin.search || shareOrigin.hash) throw new Error("Configure a verified KampusOne share origin.");
  const distribution=process.env.EXPO_PUBLIC_ANDROID_DISTRIBUTION;
  if(distribution && !['play','direct'].includes(distribution))throw new Error('Unknown Android distribution.');
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
    plugins: [...(config.plugins || []), "expo-sharing", ["expo-media-library", { photosPermission: "Allow KampusOne to save photos you choose.", savePhotosPermission: "Allow KampusOne to save downloaded photos and videos." }]],
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
      associatedDomains: [`applinks:${shareOrigin.hostname}`],
      ...(fs.existsSync(googleServiceInfoPath)
        ? { googleServicesFile: googleServiceInfoFile }
        : {}),
    },
    android: {
      ...config.android,
      intentFilters: [{ action: "VIEW", autoVerify: true, data: [{ scheme: "https", host: shareOrigin.hostname, pathPrefix: "/s/" }], category: ["BROWSABLE", "DEFAULT"] }],
      ...(fs.existsSync(googleServicesPath) ? { googleServicesFile } : {}),
    },
  };
};
