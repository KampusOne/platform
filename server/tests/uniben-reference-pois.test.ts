import {afterAll,beforeAll,describe,expect,it} from 'vitest';
import {readFileSync} from 'node:fs';
import type {PGlite} from '@electric-sql/pglite';
import {createTestDatabase} from './helpers/database';

let db:PGlite;
const university='6a79211e-6e85-4d95-be24-976edb26ba58';
const campus='1d60dcae-760d-4de7-8443-6a870d9bbe1a';

beforeAll(async()=>{
  db=await createTestDatabase();
  await db.query("insert into public.universities(id,name,slug,updated_at) values($1,'University of Benin','uniben',now())",[university]);
  await db.query("insert into public.institution_campuses(id,institution_id,name,slug,latitude,longitude,status) values($1,$2,'Ugbowo Campus','ugbowo',6.398255,5.618838,'PUBLISHED')",[campus,university]);
},60000);
afterAll(async()=>db?.close());

describe('UNIBEN screenshot reference POIs',()=>{
  it('adds the three Plus Code landmarks as published but unverified campus centres',async()=>{
    await db.exec(readFileSync(new URL('../../database/neon/migrations/20261009001000_uniben_reference_pois.sql',import.meta.url),'utf8'));
    const result=await db.query<{name:string;latitude:string;longitude:string;source_provider:string;source_feature_id:string;verified_at:string|null;confidence:number}>(
      "select name,latitude::text,longitude::text,source_provider,source_feature_id,verified_at,confidence::float8 as confidence from public.campus_places where campus_id=$1 order by name",
      [campus],
    );
    expect(result.rows).toHaveLength(3);
    expect(result.rows).toEqual([
      {name:'Promise Land Restaurant',latitude:'6.4031875',longitude:'5.610078125',source_provider:'REFERENCE',source_feature_id:'pluscode:CJ36+72G',verified_at:null,confidence:0.7},
      {name:'Shopping Complex UNIBEN',latitude:'6.4023875',longitude:'5.610421875',source_provider:'REFERENCE',source_feature_id:'pluscode:CJ26+X53',verified_at:null,confidence:0.7},
      {name:'UNIBEN Farm Project',latitude:'6.4030625',longitude:'5.610921875',source_provider:'REFERENCE',source_feature_id:'pluscode:CJ36+69F',verified_at:null,confidence:0.7},
    ]);
    expect((await db.query<{map_revision:number}>('select map_revision from public.institution_campuses where id=$1',[campus])).rows[0]?.map_revision).toBe(2);
  });
});
