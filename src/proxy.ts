import { NextResponse, type NextRequest } from "next/server";
import { canAccess, homeFor, isPublicPath } from "@/lib/auth/access";
import { SESSION_COOKIE, verifySession } from "@/lib/auth/token";

/**
 * A quick first check on every page: not logged in goes to the login page,
 * and warehouse staff are kept on warehouse screens. Each page and action
 * checks again against the database (see lib/auth/session.ts).
 */
export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const claims = await verifySession(request.cookies.get(SESSION_COOKIE)?.value);

  if (!claims) {
    if (isPublicPath(pathname)) return NextResponse.next();
    return NextResponse.redirect(new URL("/login", request.url));
  }
  // The login page and home page check the session themselves, so a session
  // that has been signed out (password changed) cannot loop between pages.
  if (isPublicPath(pathname) || pathname === "/") return NextResponse.next();
  if (!canAccess(claims.role, pathname)) {
    return NextResponse.redirect(new URL(homeFor(claims.role), request.url));
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|SKU-setup-template.xlsx).*)"],
};
