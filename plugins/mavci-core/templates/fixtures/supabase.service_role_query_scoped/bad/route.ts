import { getSupabaseAdminClient } from "@/lib/supabase";

export async function POST(req: Request) {
  const supabaseAdmin = getSupabaseAdminClient();
  const { data } = await supabaseAdmin.from("conversations").select("id, messages");
  await supabaseAdmin.from("companies").delete();
  return Response.json({ data });
}
