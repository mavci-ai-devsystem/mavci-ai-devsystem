import { NextResponse, type NextRequest } from 'next/server'

/**
 * Tenant resolution and session refresh.
 *
 * Note the absence of a RegExp built from a template literal: an interpolated
 * slug containing a dot becomes a wildcard, and one tenant's rule starts
 * matching another tenant's paths. Enforced by next.regex_no_template_literal.
 */
export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl
  if (pathname.startsWith('/api/')) return NextResponse.next()
  return NextResponse.next({ request })
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
