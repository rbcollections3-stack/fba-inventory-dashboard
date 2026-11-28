import { jwtVerify, SignJWT } from "jose";
import type { Role } from "@/db/schema";

/** Kept separate from the server-only session code so the proxy can use it. */
export const SESSION_COOKIE = "fba_session";
/** Holds a half-finished login (password checked, code or new password still needed). */
export const PENDING_COOKIE = "fba_login";
export const SESSION_DAYS = 7;
export const PENDING_MINUTES = 10;

export type SessionClaims = { userId: number; role: Role; v: number };
/** mfa is true once the authenticator code has been checked. */
export type PendingClaims = { userId: number; v: number; mfa: boolean };

function key(secret: string | undefined): Uint8Array {
  if (!secret || secret.length < 32) {
    throw new Error("AUTH_SECRET must be set to at least 32 characters. See SETUP.md.");
  }
  return new TextEncoder().encode(secret);
}

async function sign(payload: Record<string, unknown>, userId: number, expires: string, secret: string | undefined) {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(String(userId))
    .setIssuedAt()
    .setExpirationTime(expires)
    .sign(key(secret));
}

async function verify(token: string | undefined, secret: string | undefined, typ: string) {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, key(secret), { algorithms: ["HS256"] });
    const userId = Number(payload.sub);
    if (payload.typ !== typ || !Number.isInteger(userId) || typeof payload.v !== "number") return null;
    return { payload, userId, v: payload.v };
  } catch {
    return null;
  }
}

export async function signSession(claims: SessionClaims, secret = process.env.AUTH_SECRET): Promise<string> {
  return sign({ typ: "session", role: claims.role, v: claims.v }, claims.userId, `${SESSION_DAYS}d`, secret);
}

/** Returns the session claims, or null if the token is missing, expired, forged or not a full session. */
export async function verifySession(
  token: string | undefined,
  secret = process.env.AUTH_SECRET,
): Promise<SessionClaims | null> {
  const r = await verify(token, secret, "session");
  if (!r) return null;
  const role = r.payload.role;
  if (role !== "admin" && role !== "staff") return null;
  return { userId: r.userId, role, v: r.v };
}

export async function signPending(claims: PendingClaims, secret = process.env.AUTH_SECRET): Promise<string> {
  return sign({ typ: "pending", v: claims.v, mfa: claims.mfa }, claims.userId, `${PENDING_MINUTES}m`, secret);
}

export async function verifyPending(
  token: string | undefined,
  secret = process.env.AUTH_SECRET,
): Promise<PendingClaims | null> {
  const r = await verify(token, secret, "pending");
  if (!r || typeof r.payload.mfa !== "boolean") return null;
  return { userId: r.userId, v: r.v, mfa: r.payload.mfa };
}

/**
 * Proof that a person just confirmed their authenticator setup. Handed to
 * the page with the backup codes, so the login can continue after they are
 * saved without setting a cookie (which would reload the page and hide the codes).
 */
export async function signSetupProof(claims: { userId: number; v: number }, secret = process.env.AUTH_SECRET) {
  return sign({ typ: "mfa-setup", v: claims.v }, claims.userId, `${PENDING_MINUTES}m`, secret);
}

export async function verifySetupProof(
  token: string | undefined,
  secret = process.env.AUTH_SECRET,
): Promise<{ userId: number; v: number } | null> {
  const r = await verify(token, secret, "mfa-setup");
  return r ? { userId: r.userId, v: r.v } : null;
}
