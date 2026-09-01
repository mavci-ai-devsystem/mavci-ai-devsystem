// THE FIXTURE TO KEEP CLOSEST. This is the live bug from
// docs/chatbot-widget-connect-plan.md section 0a, reduced.
//
// companyId comes from an UNAUTHENTICATED request body. The filter is present and
// the value is worthless. This rule MUST report ZERO findings here: it checks
// PRESENCE, not PROVENANCE. A rule quietly believed to cover provenance converts an
// unchecked property into a green tick, which is finding 5 arriving by another door.
//
// This site belongs in guardian's WORKLIST, not in this rule's findings.
import { getSupabaseAdminClient } from "@/lib/supabase";

export async function POST(req: Request) {
  const body = await req.json();
  const companyId = body.companyId?.trim();
  const supabaseAdmin = getSupabaseAdminClient();
  const { data } = await supabaseAdmin
    .from("companies")
    .select("id, name, system_prompt, knowledge_base")
    .eq("id", companyId);
  return Response.json({ data });
}
