// A .from() that is NOT a service-role site: this file constructs no admin client.
// It must be recorded as EXCLUDED WITH A REASON, never silently absent - an omitted
// coarse hit and a named exclusion look identical in the site count and only one of
// them is honest.
import { createBrowserClient } from "@supabase/ssr";

export function useRows(orgId: string) {
  const supabase = createBrowserClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
  return supabase.from("conversations").select("id").eq("company_id", orgId);
}
