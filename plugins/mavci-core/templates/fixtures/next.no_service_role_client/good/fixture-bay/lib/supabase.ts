// FIXTURE, declared under `checks.fixtures` in the manifest patch for this rule.
//
// This file is the reason the fixture class exists. It references the
// service-role key outside a server-only module, which is a real blocker
// everywhere else — and here it sits under a root the manifest declares as
// fixtures, carrying the defect ON PURPOSE, so the rule must not fire on it.
//
// The root is `fixture-bay/` and NOT `corpus-run/`: the latter is exempt without
// any declaration, so this pair would pass there even with `checks.fixtures`
// broken. See the note in check-fixtures.mjs.
//
// It fails against 0.1.15: without `isDeclaredFixture` this file produces a
// `next.no_service_role_client` blocker, `good/` is non-empty, and
// check-fixtures.mjs reports "fired on its good/ fixture".
import { createClient } from "@supabase/supabase-js";

export function getSupabaseAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL as string,
    process.env.SUPABASE_SERVICE_ROLE_KEY as string,
  );
}
