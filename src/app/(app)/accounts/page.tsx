import { getDb } from "@/db";
import { requireAdmin } from "@/lib/auth/session";
import { listUsers, MIN_PASSWORD_LENGTH } from "@/lib/auth/users";
import { PasswordForm } from "./password-form";

export const metadata = { title: "Accounts · RB Collections FBA Dashboard" };

export default async function AccountsPage() {
  await requireAdmin();
  const users = await listUsers(getDb());
  return (
    <>
      <h1>Accounts</h1>
      <p className="muted">
        There are two logins. The admin login sees everything. The warehouse staff login only sees the Warehouse
        screen. Passwords need at least {MIN_PASSWORD_LENGTH} characters.
      </p>
      {users.map((u) => (
        <div className="card" key={u.id}>
          <h2 style={{ marginTop: 0 }}>
            {u.username} <span className="muted small">({u.role === "admin" ? "admin" : "warehouse staff"})</span>
          </h2>
          <PasswordForm userId={u.id} username={u.username} />
        </div>
      ))}
    </>
  );
}
