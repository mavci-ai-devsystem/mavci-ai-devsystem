import { getSupabaseAdminClient } from "@/lib/supabase";
import { currentContext } from "@/lib/context";

export const dynamic = "force-dynamic";

export async function GET() {
  const { scopeId } = currentContext();
  const supabase = getSupabaseAdminClient();

  // The predicate is present. Whether scopeId can be trusted depends on what
  // populates __ctx, which is middleware this project does not expose here.
  const { data } = await supabase.from("reports").select("id, total").eq("org_id", scopeId);

  return Response.json({ data });
}
