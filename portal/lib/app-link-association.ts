// These are public signing identifiers, never credentials. Missing deployment
// values must not produce an association claiming an invented signing identity.
export function androidAssociation(fingerprints: string | undefined) {
  const values = [
    ...new Set(
      (fingerprints ?? "")
        .split(",")
        .map((s) => s.trim().toUpperCase())
        .filter(Boolean),
    ),
  ];
  if (
    !values.length ||
    !values.every((s) => /^(?:[0-9A-F]{2}:){31}[0-9A-F]{2}$/.test(s))
  )
    return null;
  return [
    {
      relation: ["delegate_permission/common.handle_all_urls"],
      target: {
        namespace: "android_app",
        package_name: "app.kampusone.mobile",
        sha256_cert_fingerprints: values,
      },
    },
  ];
}
export function appleAssociation(teamId: string | undefined) {
  if (!teamId || !/^[A-Z0-9]{10}$/.test(teamId)) return null;
  return {
    applinks: {
      apps: [],
      details: [
        {
          appIDs: [`${teamId}.app.kampusone.mobile`],
          components: [{ "/": "/s/*" }],
        },
      ],
    },
  };
}
export const sharedKinds = [
  "post",
  "profile",
  "business",
  "product",
  "tutorial",
  "material",
  "community",
  "study-group",
  "class-community",
  "message",
] as const;
export function validSharedPath(kind:string,id:string){
 if(kind==='ai')return id==='kira';
 if(kind==='streak')return id==='today';
 if(kind==='exam-period'){
  const [start,end,...extra]=id.split('_');
  const real=(v:string|undefined)=>!!v&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&Number.isFinite(Date.parse(v+'T12:00:00Z'))&&new Date(v+'T12:00:00Z').toISOString().slice(0,10)===v;
  return !extra.length&&real(start)&&real(end)&&end!>=start!&&Date.parse(end!)-Date.parse(start!)<=366*86400000;
 }
 return sharedKinds.some(k=>k===kind)&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
}
export function androidDownloadUrl(value: string | undefined) {
  try {
    const url = new URL(value ?? "");
    return url.protocol === "https:" &&
      (url.hostname === "kampusone.app" ||
        url.hostname.endsWith(".kampusone.app")) &&
      !url.username &&
      !url.password &&
      !url.port &&
      !url.hash &&
      url.pathname.endsWith(".apk")
      ? url.href
      : null;
  } catch {
    return null;
  }
}
