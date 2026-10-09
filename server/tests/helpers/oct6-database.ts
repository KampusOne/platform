import {readFile} from 'node:fs/promises';
import {gunzipSync} from 'node:zlib';
import {PGlite} from '@electric-sql/pglite';
import {postgis} from '@electric-sql/pglite-postgis';

/** Today’s schema only; this fixture contains no production customer records. */
export async function october6Database() {
  const bytes=await readFile(new URL('../fixtures/oct6-current-live-schema.json.gz',import.meta.url));
  const schema=JSON.parse(gunzipSync(bytes).toString()) as Record<string,string[]>;
  const db=new PGlite({extensions:{postgis}});
  try {
    await db.exec('create extension postgis; create schema app_private; set search_path=public,app_private');
    for(const ddl of [...schema.enums!,...schema.tables!].filter(ddl=>!ddl.startsWith('create table public.spatial_ref_sys ')))await db.exec(ddl);
    const constraints=schema.constraints!.filter(ddl=>!/\bNOT NULL [a-z_]+;$/i.test(ddl)&&!ddl.includes('public.spatial_ref_sys')&&!ddl.includes(' TRIGGER'));
    for(const ddl of constraints.filter(ddl=>!ddl.includes('FOREIGN KEY')))await db.exec(ddl);
    for(const ddl of schema.indexes!){try{await db.exec(ddl);}catch(error){if((error as {code?:string}).code!=='42P07')throw error;}}
    for(const ddl of constraints.filter(ddl=>ddl.includes('FOREIGN KEY')))await db.exec(ddl);
    for(const ddl of [...schema.functions!,...schema.triggers!]){
      try{await db.exec(ddl);}catch(error){throw new Error('Schema restore failed at '+ddl.slice(0,180)+': '+(error as Error).message);}
    }
    for(const name of [
      '20261006100000_community_subscription_requests',
      '20261006101000_verified_vendor_publication',
      '20261006102000_large_private_documents',
      '20261006110000_customer_paid_provider_fees',
      '20261006120000_exam_schedules_and_awareness',
      '20261006130000_acquisition_and_featured_brands',
      '20261006140000_tutorial_video_storage',
      '20261006150000_public_website',
      '20261006160000_multi_source_campus_maps',
      '20261006190000_alarm_categories_and_assessments',
      '20261006191000_direct_storage_uploads',
      '20261009120000_class_alarm_daily_mute',
    ]){
      try{await db.exec(await readFile(new URL('../../../database/neon/migrations/'+name+'.sql',import.meta.url),'utf8'));}
      catch(error){throw new Error('Migration '+name+': '+(error as Error).message);}
    }
    return db;
  }catch(error){await db.close();throw error;}
}
