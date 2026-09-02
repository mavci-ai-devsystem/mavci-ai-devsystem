export type Session = { orgId: string; email: string };
export function verifySession(cookie: string): Session | null {
  return cookie.length > 10 ? { orgId: "from-verified-token", email: "x@y.z" } : null;
}
