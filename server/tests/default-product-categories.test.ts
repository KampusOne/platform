import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
const migration=readFileSync(new URL('../../database/neon/migrations/20261010130000_default_product_categories.sql',import.meta.url),'utf8');
describe('seller category bootstrap',()=>{
 it('provides normal commerce categories for each campus while retaining local restrictions and future campuses',async()=>{
  const db=new PGlite();try{
   await db.exec(`create schema app_private;create table universities(id uuid primary key);create table product_categories(id uuid primary key default gen_random_uuid(),university_id uuid references universities(id),name text,status text,listing_rules text,reviewed_at timestamptz,unique(university_id,name));`);
   const a=crypto.randomUUID(),b=crypto.randomUUID(),c=crypto.randomUUID();
   await db.query('insert into universities values($1),($2)',[a,b]);
   await db.query("insert into product_categories(university_id,name,status,listing_rules)values($1,'Course materials','RESTRICTED','Existing campus rule')",[a]);
   await db.exec(migration);
   for(const campus of [a,b]){
    const names=(await db.query<{name:string}>('select name from product_categories where university_id=$1',[campus])).rows.map(row=>row.name);
    expect(names).toHaveLength(23);expect(names).toContain('Student handbooks');expect(names).toContain('Art & craft materials');expect(names).toContain('Electronics');
   }
   expect((await db.query('select status,listing_rules from product_categories where university_id=$1 and name=$2',[a,'Course materials'])).rows[0]).toMatchObject({status:'RESTRICTED',listing_rules:'Existing campus rule'});
   await db.query('insert into universities values($1)',[c]);
   await db.query('select app_private.seed_product_categories($1)',[c]);
   expect((await db.query('select * from product_categories where university_id=$1',[c])).rows).toHaveLength(23);
   expect((await db.query("select has_function_privilege('public','app_private.seed_product_categories(uuid)','execute') as allowed")).rows[0]).toMatchObject({allowed:false});
  }finally{await db.close();}
 },15000);
});
