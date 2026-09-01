import { getSupabaseAdminClient } from "@/lib/supabase";

export const dynamic = "force-dynamic";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

type ChatBody = { message?: string; companyId?: string };

export async function POST(req: Request) {
  const body = (await req.json()) as ChatBody;
  const message = body.message?.trim();
  const companyId = body.companyId?.trim();

  if (!message || !companyId) {
    return Response.json({ error: "message ve companyId zorunludur." }, { status: 400, headers: corsHeaders });
  }

  const supabaseAdmin = getSupabaseAdminClient();

  const { data: company } = await supabaseAdmin
    .from("companies")
    .select("id, name, system_prompt, knowledge_base")
    .eq("id", companyId)
    .maybeSingle();

  return Response.json({ reply: company?.system_prompt ?? "" }, { headers: corsHeaders });
}
