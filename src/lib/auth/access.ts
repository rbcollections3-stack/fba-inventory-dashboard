import type { Role } from "@/db/schema";

/**
 * Which screens each login can open. Warehouse staff only see warehouse
 * screens. The admin sees everything.
 */
export const STAFF_PATH_PREFIXES = ["/warehouse"] as const;

/**
 * Open without a login. The cron path is called by Vercel's scheduler and
 * checks its own secret (CRON_SECRET) instead.
 */
export const PUBLIC_PATHS = ["/login", "/api/cron"] as const;

function matches(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(prefix + "/");
}

export function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.some((p) => matches(pathname, p));
}

export function canAccess(role: Role, pathname: string): boolean {
  if (isPublicPath(pathname)) return true;
  if (role === "admin") return true;
  return STAFF_PATH_PREFIXES.some((p) => matches(pathname, p));
}

/** Where each login lands after signing in. */
export function homeFor(role: Role): string {
  return role === "admin" ? "/skus" : "/warehouse";
}
