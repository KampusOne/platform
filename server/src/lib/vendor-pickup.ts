import { sql } from 'drizzle-orm';
import { database, firstRow } from './database';
import { AppError } from './errors';
import type { Bindings } from '../types';

/** A saved collection address belongs to the store, not the vendor's live GPS session. */
export async function requireVendorPickup(env: Bindings, profileId: string, universityId: string) {
  const store = firstRow(await database(env).execute<{ ready: boolean }>(sql`
    select (length(trim(coalesce(pickup_location,''))) >= 5 and pickup_place_id is not null) as ready
    from public.vendor_storefronts where vendor_profile_id=${profileId}::uuid
      and university_id=${universityId}::uuid and status <> 'SUSPENDED'
  `));
  if (!store?.ready) throw new AppError(409, 'CONFLICT', 'Save your store pickup address and map location before uploading products.', { reason: 'VENDOR_PICKUP_REQUIRED' });
}
