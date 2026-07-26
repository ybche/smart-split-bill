/// <reference types="vite/client" />
import { createClient } from "@supabase/supabase-js";

const metaEnv = (import.meta as any).env || {};

const SUPABASE_URL =
  metaEnv.VITE_SUPABASE_URL ||
  (typeof process !== "undefined" && process.env?.SUPABASE_URL);

const SUPABASE_ANON_KEY =
  metaEnv.VITE_SUPABASE_ANON_KEY ||
  (typeof process !== "undefined" && process.env?.SUPABASE_ANON_KEY);

if (!SUPABASE_URL) {
  throw new Error("VITE_SUPABASE_URL environment variable is required");
}
if (!SUPABASE_ANON_KEY) {
  throw new Error("VITE_SUPABASE_ANON_KEY environment variable is required");
}

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
