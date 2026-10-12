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
    if (request.query.includes('query KampusOneFcm(')) {
      queries++;
      assert.ok(request.query.includes('ownerAccount'));
      assert.ok(!request.query.includes(' account {'));
      assert.equal(request.variables.projectId, projectId);
      assert.equal(request.variables.packageName, 'app.kampusone.mobile');
      return Response.json({
        data: { app: { byId: { id: projectId, ownerAccount: { id: 'expo-account',name:'kampusone' },
          androidAppCredentials: [{
            id: 'android-credentials', isLegacy: false, applicationIdentifier: 'app.kampusone.mobile',
            googleServiceAccountKeyForFcmV1: { id:queries===1?'old-id':'new-id',projectIdentifier: 'kampusone-5064e', privateKeyIdentifier: queries === 1 ? 'old-key' : 'new-key' },
          }],
        } } },
      });
    }
    if(request.query.includes('query KampusOneFcmKeys')){
      assert.equal(request.variables.accountName,'kampusone');
      return Response.json({data:{account:{byName:{id:'expo-account',googleServiceAccountKeysPaginated:{edges:[],pageInfo:{hasNextPage:false}}}}}});
    }
    if (request.query.includes('mutation UploadFcmV1')) {
      uploads++;
      assert.equal(request.variables.accountId, 'expo-account');
      assert.deepEqual(request.variables.input.jsonKey,service);
      assert.ok(request.query.includes('createGoogleServiceAccountKey'));
      return Response.json({data:{googleServiceAccountKey:{createGoogleServiceAccountKey:{id:'new-id',projectIdentifier:'kampusone-5064e',privateKeyIdentifier:'new-key'}}}});
    }
    if(request.query.includes('mutation AssignFcmV1')){
      assert.equal(request.variables.androidCredentialsId,'android-credentials');
      assert.equal(request.variables.keyId,'new-id');
      assert.ok(request.query.includes('setGoogleServiceAccountKeyForFcmV1'));
      return Response.json({data:{androidAppCredentials:{setGoogleServiceAccountKeyForFcmV1:{id:'android-credentials',googleServiceAccountKeyForFcmV1:{id:'new-id',projectIdentifier:'kampusone-5064e',privateKeyIdentifier:'new-key'}}}}});
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
      id: 'WRONG-PROJECT', ownerAccount: { id: 'account',name:'wrong' }, androidAppCredentials: [],
    } } } }),
  }), /does not resolve/);
});

test('a retry reuses a key uploaded earlier instead of creating another private-key record',async()=>{
  let assigned=false,uploads=0;
  const key={id:'saved-key-id',projectIdentifier:'fixture-project',privateKeyIdentifier:'fixture-key'};
  const fetchFn=async(_url,options)=>{
    const {query,variables}=JSON.parse(options.body);
    if(query.includes('query KampusOneFcm('))return Response.json({data:{app:{byId:{id:projectId,ownerAccount:{id:'account',name:'owner'},androidAppCredentials:[{id:'android',isLegacy:false,applicationIdentifier:'app.kampusone.mobile',googleServiceAccountKeyForFcmV1:assigned?key:null}]}}}});
    if(query.includes('query KampusOneFcmKeys'))return Response.json({data:{account:{byName:{id:'account',googleServiceAccountKeysPaginated:{edges:[{node:key}],pageInfo:{hasNextPage:false}}}}}});
    if(query.includes('mutation UploadFcmV1')){uploads++;throw Error('An existing key must not be uploaded again');}
    assert.equal(variables.keyId,key.id);assert.equal(variables.androidCredentialsId,'android');assigned=true;
    return Response.json({data:{androidAppCredentials:{setGoogleServiceAccountKeyForFcmV1:{id:'android',googleServiceAccountKeyForFcmV1:key}}}});
  };
  assert.deepEqual(await syncExpoFcm({expoToken:'synthetic',projectId,serviceAccount:{private_key_id:key.privateKeyIdentifier},firebaseProjectId:key.projectIdentifier,apply:true,fetchFn}),{status:'FCM_V1_CREDENTIAL_LINKED'});
  assert.equal(uploads,0);
});
