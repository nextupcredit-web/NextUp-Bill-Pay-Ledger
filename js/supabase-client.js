/* ============================================================
   NextUp Bill Pay Ledger — Supabase Client
   Publishable key only — safe for client-side use, governed by
   Row Level Security policies on the tables it can reach.
   ============================================================ */

const SUPABASE_URL = 'https://zggyvqahzgczgubcgaba.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_NzJ9XL85ZHXurC_n8dCi-Q_svZj5t-8';

const supabaseClient = (typeof supabase !== 'undefined')
  ? supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY)
  : null;
