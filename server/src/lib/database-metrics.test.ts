import {describe,it,expect,vi} from "vitest";
const mock=vi.hoisted(()=>({executions:0,options:[] as unknown[]}));
vi.mock("@neondatabase/serverless",()=>({neon:(_connection:string,options:unknown)=>{
  mock.options.push(options);
  const query=(text:string)=>({parameterizedQuery:{query:text,params:[]},then(resolve:(value:unknown)=>unknown,reject:(error:unknown)=>unknown){mock.executions++;return Promise.resolve([{ok:true}]).then(resolve,reject);}});
  const client=Object.assign(query,{query,transaction:async(queries:Array<{parameterizedQuery:unknown}> | ((sql:typeof query)=>Array<{parameterizedQuery:unknown}>))=>{
    const batch=typeof queries==="function"?queries(query):queries;
    expect(batch.every(item=>item.parameterizedQuery!==undefined)).toBe(true);
    mock.executions+=batch.length;return batch.map(()=>[{ok:true}]);
  }});return client;
}}));
import {sqlClient} from "./database";
import {beginReadMetrics} from "./read-cache-metrics";
import type {Bindings} from "../types";
describe("request-scoped database metrics",()=>{
  it("preserves lazy transaction statements and records round trips without SQL/parameters",async()=>{
    const env={DATABASE_URL:"synthetic"} as Bindings,metrics=beginReadMetrics(env),client=sqlClient(env);
    const queries=[client.query("synthetic A"),client.query("synthetic B")];
    expect(metrics.dbQueries).toBe(0);
    await client.transaction(queries);expect(metrics.dbQueries).toBe(2);expect(metrics.dbRoundTrips).toBe(1);
    await client.query("synthetic C");expect(metrics.dbQueries).toBe(3);expect(metrics.dbRoundTrips).toBe(2);
    await client.transaction(sql=>[sql.query("synthetic D")]);expect(metrics.dbQueries).toBe(4);expect(metrics.dbRoundTrips).toBe(3);
    expect(JSON.stringify(metrics)).not.toContain("synthetic");expect(mock.options).toContainEqual({fetchOptions:{cache:"no-store"},fullResults:false});
  });
  it("does not share counters or clients across concurrent HTTP request bindings",async()=>{
    const a={DATABASE_URL:"synthetic"} as Bindings,b={DATABASE_URL:"synthetic"} as Bindings;
    const one=beginReadMetrics(a),two=beginReadMetrics(b);
    await Promise.all([sqlClient(a).query("synthetic"),sqlClient(b).transaction([sqlClient(b).query("synthetic"),sqlClient(b).query("synthetic")])]);
    expect(one.dbQueries).toBe(1);expect(two.dbQueries).toBe(2);expect(sqlClient(a)).not.toBe(sqlClient(b));
  });
});
