// The tenant id is assembled here, from a request-scoped store this project
// populates in middleware. Nothing in the handler, and nothing reachable from it,
// shows what put the value there.
import { headers } from "next/headers";

type RequestContext = { scopeId: string };

export function currentContext(): RequestContext {
  // Populated upstream. The writer is not in this file and not in the handler.
  return (globalThis as unknown as { __ctx?: RequestContext }).__ctx ?? { scopeId: headers().get("x-scope") ?? "" };
}
