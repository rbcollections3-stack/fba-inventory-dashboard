import { jwtVerify, SignJWT } from "jose";
import type { Role } from "@/db/schema";

/** Kept separate from the server-only session code so the proxy can use it. */
export const SESSION_COOKIE = "fba_session";
export const SESSION_DAYS = 7;

export type SessionClaims = { userId: number; role: Role; v: number };

function key(secret: string | undefined): Uint8Array {
  if (!secret || secret.length < 32) {
    throw new Error("AUTH_SECRET must be set to at least 32 characters. See SETUP.md.");
  }
  return new TextEncoder().encode(secret);
}

export async function signSession(claims: SessionClaims, secret = process.env.AUTH_SECRET): Promise<string> {
  return new SignJWT({ role: claims.role, v: claims.v })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(String(claims.userId))
    .setIssuedAt()
    .setExpirationTime(`${SESSION_DAYS}d`)
    .sign(key(secret));
}

/** Returns the session claims, or null if the token is missing, expired or forged. */
export async function verifySession(
  token: string | undefined,
  secret = process.env.AUTH_SECRET,
): Promise<SessionClaims | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, key(secret), { algorithms: ["HS256"] });
    const userId = Number(payload.sub);
    const role = payload.role;
    const v = payload.v;
    if (!Number.isInteger(userId) || (role !== "admin" && role !== "staff") || typeof v !== "number") {
      return null;
    }
    return { userId, role, v };
  } catch {
    return null;
  }
}
