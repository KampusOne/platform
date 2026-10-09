import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import {
  verifyFirebaseProject,
  verifyFcmApiPermission,
  verifyGoogleKey,
  syncExpoFcm,
} from './sync-expo-fcm-credentials.mjs';

const firebase = {
  project_info: { project_id: 'kampusone-5064e', project_number: '102852292089' },
  client: [{ client_info: { android_client_info: { package_name: 'app.kampusone.mobile' } } }],
};
const service = {
  type: 'service_account',
  project_id: 'kampusone-5064e',
  client_email: 'tester@kampusone-5064e.iam.gserviceaccount.com',
  private_key_id: 'new-key',
  private_key: '-----BEGIN PRIVATE KEY-----\\nTEST\\n-----END PRIVATE KEY-----',
};
const projectId = '00000000-0000-4000-8000-000000000001';

test('service-account JSON must be for the Firebase project used by the Android package', () => {
  assert.equal(verifyFirebaseProject(service, firebase), 'kampusone-5064e');
  assert.throws(() => verifyFirebaseProject({ ...service, project_id: 'other' }, firebase), /does not belong/);
  assert.throws(() => verifyFirebaseProject({ ...service, type: undefined }, firebase), /service-account private key/);
  assert.throws(() => verifyFirebaseProject(service, { ...firebase, client: [] }), /not configured/);
});

test('Google OAuth JWT verifies valid service-account signing without exposing secrets', async () => {
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  let called = false;
  const token = await verifyGoogleKey({
    ...service,
    private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }),
  }, async (_url, options) => {
    called = true;
    const request = new URLSearchParams(options.body.toString());
    assert.equal(request.get('grant_type'), 'urn:ietf:params:oauth:grant-type:jwt-bearer');
    assert.equal(request.get('assertion')?.split('.').length, 3);
    return new Response(JSON.stringify({ access_token: 'test-oauth-access' }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    });
  });
  assert.ok(called);
  assert.equal(token, 'test-oauth-access');
});

test('rejects service accounts that lack permission for the FCM v1 send API', async () => {
  await verifyFcmApiPermission('kampusone-5064e', 'access', async (_url, options) => {
    assert.deepEqual(JSON.parse(options.body), { message: {} });
    return new Response('{}', { status: 400 });
  });
  await assert.rejects(
    () => verifyFcmApiPermission('kampusone-5064e', 'access', async () => new Response('', { status: 403 })),
    /Messaging API Admin role/,
  );
});

test('Expo FCM credentials are uploaded only to the verified project and Android package', async () => {
  let queries = 0;
  let uploads = 0;
  const fetchFn = async (_url, options) => {
    const request = JSON.parse(options.body);
    if (request.query.includes('query KampusOneFcm')) {
      queries++;
      assert.equal(request.variables.projectId, projectId);
      assert.equal(request.variables.packageName, 'app.kampusone.mobile');
      return Response.json({
        data: { app: { byId: { id: projectId, account: { id: 'expo-account' },
          androidAppCredentials: [{
            id: 'android-credentials', isLegacy: false, applicationIdentifier: 'app.kampusone.mobile',
            googleServiceAccountKeyForFcmV1: { projectIdentifier: 'kampusone-5064e', privateKeyIdentifier: queries === 1 ? 'old-key' : 'new-key' },
          }],
        } } },
      });
    }
    if (request.query.includes('mutation UploadFcmV1')) {
      uploads++;
      assert.equal(request.variables.accountId, 'expo-account');
      assert.equal(request.variables.androidCredentialsId, 'android-credentials');
      assert.equal(JSON.parse(request.variables.credential).project_id, service.project_id);
      return Response.json({ data: { androidAppCredentials: { createFcmV1Credential: {
        id: 'android-credentials',
        googleServiceAccountKeyForFcmV1: { projectIdentifier: 'kampusone-5064e', privateKeyIdentifier: 'new-key' },
      } } } });
    }
    throw new Error('Unexpected request');
  };
  assert.deepEqual(
    await syncExpoFcm({
      expoToken: 'fake-expo-token',
      projectId, serviceAccount: service, firebaseProjectId: 'kampusone-5064e',
      apply: true, fetchFn,
    }),
    { status: 'FCM_V1_CREDENTIAL_LINKED' },
  );
  assert.equal(queries, 2);
  assert.equal(uploads, 1);
});

test('Expo reads are limited to the expected project and fail closed', async () => {
  await assert.rejects(() => syncExpoFcm({
    expoToken: 'fake-expo-token',
    projectId,
    serviceAccount: service,
    firebaseProjectId: 'kampusone-5064e',
    apply: true,
    fetchFn: async () => Response.json({ data: { app: { byId: {
      id: 'WRONG-PROJECT', account: { id: 'account' }, androidAppCredentials: [],
    } } } }),
  }), /does not resolve/);
});
