import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {runInNewContext} from 'node:vm';
import {waitForRequest,invalidationTargets,matchesRead,readCachePolicy,cacheScopeForUser,cacheExpiry} from '../../mobile/src/lib/request-policy.ts';
const require=createRequire(new URL('../../server/package.json',import.meta.url));
const ts=require('typescript');
export function nativeTransport(fetcher, clock = Date) {
  const policy={waitForRequest,invalidationTargets,matchesRead,readCachePolicy,cacheScopeForUser,cacheExpiry};
  const load=(file,mocks)=>{
    const exports={};
    const compiled=ts.transpileModule(readFileSync(new URL('../../mobile/src/lib/'+file,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
    runInNewContext(compiled,{exports,module:{exports},require:name=>{if(name in mocks)return mocks[name];throw Error('Missing mock '+name);},process:{env:{EXPO_PUBLIC_KAMPUSONE_API_URL:'https://primary.invalid',EXPO_PUBLIC_KAMPUSONE_API_FALLBACK_URL:'https://backup.invalid'}},fetch:fetcher,Headers,FormData,Response,AbortController,Error,TypeError,Date:clock,setTimeout,clearTimeout});
    return exports;
  };
  const deadline=load('request-deadline.ts',{'./request-policy':policy});
  return load('api-transport.ts',{'./request-policy':policy,'./request-deadline':deadline,'./session-lock':{withSessionLock:fn=>fn()},'expo-constants':{default:{expoConfig:{extra:{}}}},'react-native':{Platform:{OS:'android'}},'./analytics-bridge':{emitFeatureLifecycle(){}},'./session-storage':{readRefreshToken:async()=>null,removeRefreshToken:async()=>{},saveRefreshToken:async()=>{}}});
}
