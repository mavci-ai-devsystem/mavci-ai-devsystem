import { getSupabaseAdminClient } from "@/lib/supabase";
import { verifySession } from "@/lib/auth";

export const dynamic = "force-dynamic";

const ARCHIVE_ORG = "00000000-0000-0000-0000-000000000000";

export async function GET(req: Request) {
  const session = verifySession(req.headers.get("cookie") ?? "");
  if (!session) return new Response("unauthorized", { status: 401 });

  const supabase = getSupabaseAdminClient();

  // site A: the scoping value comes from a verified session
  const { data: mine } = await supabase.from("orgs").select("id, name").eq("id", session.orgId);

  // site B: the scoping value is a server-side constant
  const { data: archived } = await supabase.from("orgs").select("id").eq("id", ARCHIVE_ORG);

  return Response.json({ mine, archived });
}
