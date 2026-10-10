import {describe,it,expect,vi,beforeEach} from "vitest";
import type {Context} from "hono";
import type {Bindings,Variables} from "../types";
const mock=vi.hoisted(()=>({execute:vi.fn()}));
vi.mock("./database",()=>({database:()=>({execute:mock.execute}),firstRow:(result:{rows:unknown[]})=>result.rows[0]}));
import {cachedVersionedRead} from "./cache-revision";
function context(){return {env:{ENVIRONMENT:"staging",SHARED_READ_CACHE_ENABLED:"true",VERSIONED_READ_CACHE_ENABLED:"true"},req:{url:"https://revision.test/v1/student/catalog"}} as unknown as Context<{Bindings:Bindings;Variables:Variables}>;}
beforeEach(()=>{mock.execute.mockReset();});
describe("revision readiness",()=>{
  it("fails open to fresh origin when the schema or revision is missing",async()=>{
    let reads=0;const load=async()=>++reads;
    mock.execute.mockRejectedValue(new Error("missing table"));
    expect(await cachedVersionedRead(context(),"academic-catalog","academic.catalog","all",60,load)).toBe(1);
    mock.execute.mockResolvedValue({rows:[]});
    expect(await cachedVersionedRead(context(),"academic-catalog","academic.catalog","all",60,load)).toBe(2);
  });
  it("does not query readiness when disabled and never accepts a corrupt revision",async()=>{
    const c=context();c.env.VERSIONED_READ_CACHE_ENABLED="false";
    expect(await cachedVersionedRead(c,"academic-catalog","academic.catalog","all",60,async()=>4)).toBe(4);
    expect(mock.execute).not.toHaveBeenCalled();
    mock.execute.mockResolvedValue({rows:[{revision:"-5"}]});
    expect(await cachedVersionedRead(context(),"academic-catalog","academic.catalog","all",60,async()=>5)).toBe(5);
  });
});
