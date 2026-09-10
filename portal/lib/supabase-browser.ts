import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

export const isPortalSupabaseConfigured = Boolean(url && publishableKey && !url?.includes("your-project") && !publishableKey?.includes("replace_me"));

export const portalSupabase = isPortalSupabaseConfigured
  ? createClient(url!, publishableKey!, {
      auth: { autoRefreshToken: true, persistSession: true, detectSessionInUrl: true },
    })
  : null;
