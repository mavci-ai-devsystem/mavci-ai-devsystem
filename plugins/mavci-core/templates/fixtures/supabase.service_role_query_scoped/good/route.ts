import { getSupabaseAdminClient } from "@/lib/supabase";
import { verifyAdminToken } from "@/lib/admin-auth";

export async function POST(req: Request) {
  const payload = verifyAdminToken(req.headers.get("cookie") ?? "");
  if (!payload) return new Response("no", { status: 401 });
  const supabaseAdmin = getSupabaseAdminClient();
  const { data } = await supabaseAdmin
    .from("conversations")
    .select("id, messages")
    .eq("company_id", payload.companyId);
  return Response.json({ data });
}
