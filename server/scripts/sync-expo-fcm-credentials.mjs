/**
 * Restore KampusOne Android FCM v1 push credentials from GitHub Environment secrets.
 *
 * This script never prints private keys, OAuth assertions or access tokens.
 * Only run in a trusted CI environment. Re-run after rotating the Firebase key.
 */
import { readFileSync } from 'node:fs';
import { sign } from 'node:crypto';

const EXPO_GRAPHQL = 'https://api.expo.dev/graphql';
const GOOGLE_OAUTH = 'https://oauth2.googleapis.com/token';
const ANDROID_PACKAGE = 'app.kampusone.mobile';

function requireEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing production secret/config: ${name}`);
  return value;
}
function secretJSON(base64, name) {
  try {
    const decoded = Buffer.from(base64, 'base64').toString('utf8');
    const value = JSON.parse(decoded);
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('not an object');
    return value;
  } catch {
    throw new Error(`${name} must be base64-encoded JSON (never commit or print this key).`);
  }
}
export function verifyFirebaseProject(serviceAccount, googleServices) {
  const project = googleServices?.project_info;
  if (serviceAccount?.type !== 'service_account' ||
      typeof serviceAccount?.private_key !== 'string' ||
      !serviceAccount.private_key.includes('-----BEGIN PRIVATE KEY-----') ||
      typeof serviceAccount?.private_key_id !== 'string' ||
      typeof serviceAccount?.client_email !== 'string') {
    throw new Error('FCM_SERVICE_ACCOUNT_JSON_BASE64 must be a Firebase service-account private key, NOT google-services.json.');
  }
  if (!project?.project_id || serviceAccount.project_id !== project.project_id) {
    throw new Error('The FCM V1 service account does not belong to the Firebase project in the installed Android app.');
  }
  if (!googleServices.client?.some(
    (client) => client.client_info?.android_client_info?.package_name === ANDROID_PACKAGE
  )) throw new Error('google-services.json is not configured for app.kampusone.mobile.');
  return project.project_id;
}
const base64url = (json) => Buffer.from(JSON.stringify(json)).toString('base64url');

export async function verifyGoogleKey(serviceAccount, fetchFn = fetch) {
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    iss: serviceAccount.client_email,
    scope: 'https://www.googleapis.com/auth/firebase.messaging',
    aud: GOOGLE_OAUTH,
    iat: now,
    exp: now + 1800,
  };
  const unsigned = base64url({ alg: 'RS256', typ: 'JWT' }) + '.' + base64url(payload);
  let assertion;
  try {
    assertion = unsigned + '.' + sign('RSA-SHA256', Buffer.from(unsigned), serviceAccount.private_key).toString('base64url');
  } catch {
    throw new Error('FCM service-account private key is malformed.');
  }
  const response = await fetchFn(GOOGLE_OAUTH, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) {
    throw new Error('Google rejected the FCM service-account key. Generate a new Firebase private key and update FCM_SERVICE_ACCOUNT_JSON_BASE64.');
  }
  const token = await response.json();
  if (typeof token.access_token !== 'string' || !token.access_token) throw new Error('Google did not issue a Firebase access token.');
  return token.access_token;
}

export async function verifyFcmApiPermission(projectId, googleToken, fetchFn = fetch) {
  // An intentionally invalid message cannot reach a real phone.
  // The FCM send API validates IAM and API availability before validating this empty message.
  const response = await fetchFn(
    `https://fcm.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/messages:send`,
    {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${googleToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: {} }),
      signal: AbortSignal.timeout(15000),
    }
  );
  if (response.status === 400) return;
  if (response.status === 401 || response.status === 403) {
    throw new Error('The Firebase service account cannot call FCM V1. Enable Firebase Cloud Messaging API and grant the Firebase Cloud Messaging API Admin role.');
  }
  throw new Error(`FCM V1 permission check returned HTTP ${response.status}; cannot safely upload unverified credentials.`);
}

export async function expoGraphql(token, query, variables, fetchFn = fetch) {
  const response = await fetchFn(EXPO_GRAPHQL, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error(`Expo project credential API returned HTTP ${response.status}.`);
  const json = await response.json();
  // Do not log GraphQL errors: provider errors can contain sensitive query arguments.
  if (json.errors?.length || !json.data) throw new Error('Expo rejected the project credential operation. Verify EXPO_TOKEN permissions and Expo project ownership.');
  return json.data;
}

const CREDENTIAL_QUERY = `
query KampusOneFcm($projectId: String!, $packageName: String!) {
  app {
    byId(appId: $projectId) {
      id
      account { id }
      androidAppCredentials(filter: { applicationIdentifier: $packageName }) {
        id
        applicationIdentifier
        isLegacy
        googleServiceAccountKeyForFcmV1 { projectIdentifier privateKeyIdentifier }
      }
    }
  }
}`;

const UPLOAD_MUTATION = `
mutation UploadFcmV1($accountId: ID!, $androidCredentialsId: String!, $credential: String!) {
  androidAppCredentials {
    createFcmV1Credential(
      accountId: $accountId,
      androidAppCredentialsId: $androidCredentialsId,
      credential: $credential
    ) {
      id
      googleServiceAccountKeyForFcmV1 { projectIdentifier privateKeyIdentifier }
    }
  }
}`;

export async function syncExpoFcm({
  expoToken, projectId, serviceAccount, firebaseProjectId,
  apply = false, refresh = false, fetchFn = fetch,
}) {
  const read = async () => {
    const data = await expoGraphql(
      expoToken, CREDENTIAL_QUERY,
      { projectId, packageName: ANDROID_PACKAGE }, fetchFn
    );
    const app = data.app?.byId;
    if (app?.id !== projectId || !app.account?.id) {
      throw new Error('The configured EAS project ID does not resolve to the expected Expo project.');
    }
    const matches = app.androidAppCredentials?.filter(
      (item) => item.applicationIdentifier === ANDROID_PACKAGE && !item.isLegacy
    ) ?? [];
    if (matches.length !== 1) {
      throw new Error('Expo must have exactly one non-legacy Android credential for app.kampusone.mobile. Inspect Project Settings > Credentials.');
    }
    return { accountId: app.account.id, android: matches[0] };
  };
  const current = await read();
  const alreadyMatches =
    current.android.googleServiceAccountKeyForFcmV1?.projectIdentifier === firebaseProjectId &&
    current.android.googleServiceAccountKeyForFcmV1?.privateKeyIdentifier === serviceAccount.private_key_id;
  if (!apply) return { status: alreadyMatches ? 'MATCHED' : 'NEEDS_SYNC' };
  if (alreadyMatches && !refresh) return { status: 'ALREADY_LINKED' };

  const result = await expoGraphql(expoToken, UPLOAD_MUTATION, {
    accountId: current.accountId,
    androidCredentialsId: current.android.id,
    credential: JSON.stringify(serviceAccount),
  }, fetchFn);
  const linked = result.androidAppCredentials?.createFcmV1Credential?.googleServiceAccountKeyForFcmV1;
  if (linked?.projectIdentifier !== firebaseProjectId ||
      linked?.privateKeyIdentifier !== serviceAccount.private_key_id) {
    throw new Error('Expo did not confirm the correct FCM V1 service-account association.');
  }
  const after = await read();
  if (after.android.googleServiceAccountKeyForFcmV1?.privateKeyIdentifier !== serviceAccount.private_key_id) {
    throw new Error('Expo did not retain the restored FCM V1 credential.');
  }
  return { status: 'FCM_V1_CREDENTIAL_LINKED' };
}

async function main() {
  const apply = process.argv.includes('--apply');
  const refresh = process.argv.includes('--refresh');
  const expoToken = requireEnv('EXPO_TOKEN');
  const projectId = requireEnv('EXPO_EAS_PROJECT_ID');
  if (!/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(projectId)) {
    throw new Error('EXPO_EAS_PROJECT_ID must be the UUID embedded in the KampusOne Android APK.');
  }
  const serviceAccount = secretJSON(requireEnv('FCM_SERVICE_ACCOUNT_JSON_BASE64'), 'FCM_SERVICE_ACCOUNT_JSON_BASE64');
  const googleServices = JSON.parse(readFileSync(new URL('../../mobile/google-services.json', import.meta.url), 'utf8'));
  const firebaseProjectId = verifyFirebaseProject(serviceAccount, googleServices);
  if (process.env.GOOGLE_SERVICES_JSON_BASE64) {
    const buildFirebase = secretJSON(process.env.GOOGLE_SERVICES_JSON_BASE64, 'GOOGLE_SERVICES_JSON_BASE64');
    if (buildFirebase.project_info?.project_id !== firebaseProjectId ||
        buildFirebase.project_info?.project_number !== googleServices.project_info?.project_number) {
      throw new Error('GitHub Android build Firebase configuration differs from the checked-in Android Firebase project.');
    }
  }
  // Authenticate the key and check the FCM API role before updating Expo.
  const googleToken = await verifyGoogleKey(serviceAccount);
  await verifyFcmApiPermission(firebaseProjectId, googleToken);
  const outcome = await syncExpoFcm({
    expoToken, projectId, serviceAccount, firebaseProjectId, apply, refresh,
  });
  console.log(`KampusOne Android push credential check: ${outcome.status}. Project: ${firebaseProjectId}; package: ${ANDROID_PACKAGE}.`);
  console.log('Provider credential linkage is not proof of phone delivery. Verify an Expo receipt and observe a real device notification.');
}

if (process.argv[1] && new URL(import.meta.url).pathname === process.argv[1]) {
  main().catch(error => {
    console.error(`FCM restoration blocked: ${error instanceof Error ? error.message : 'Unknown error'}`);
    process.exitCode = 1;
  });
}
