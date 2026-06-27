// Supabase client for the Tuttle Kids · Will It Sell application form.
//
// Loaded from the public form (apply.html) and any other page that
// needs to read/write the `applications` table or the
// `application-videos` Storage bucket.
//
// The anon key below is the PUBLIC key — Supabase deliberately
// designed this one for browser exposure. Row-level security
// policies (set up in supabase-setup.sql) are what actually protect
// the data. Anon may INSERT new applications + upload videos, but
// CANNOT read, edit, or delete anything. Service-role moderator
// access lives in a separate (private) admin tool.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL  = "https://ukeqcxdpzkhwlibabawg.supabase.co";
const SUPABASE_ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVrZXFjeGRwemtod2xpYmFiYXdnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI1MjMwMjYsImV4cCI6MjA5ODA5OTAyNn0.-0a_9qz4ryHNBi6P6cXMTF02ceMwYmkuRtoT4uE-_v4";

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON, {
  // The public form never needs an auth session.
  auth: { persistSession: false, autoRefreshToken: false },
});

export const STORAGE_BUCKET = "application-videos";
