import { getDb } from "@/db";
import { requireAdmin } from "@/lib/auth/session";
import { listUsers, MIN_PASSWORD_LENGTH, PASSWORD_MAX_AGE_DAYS, passwordExpiresOn } from "@/lib/auth/users";
import { AddStaffForm, ChangeMyPasswordForm, UserControls } from "./forms";

export const metadata = { title: "Accounts · RB Collections FBA Dashboard" };

function day(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export default async function AccountsPage() {
  const me = await requireAdmin();
  const users = await listUsers(getDb());
  return (
    <>
      <h1>Accounts</h1>
      <p className="muted">
        Give every person their own login and never share one. Every login needs a password of at least{" "}
        {MIN_PASSWORD_LENGTH} characters with a special character, plus a code from an authenticator app.
        Passwords must be changed every {PASSWORD_MAX_AGE_DAYS} days. Warehouse staff only see the Warehouse screen.
      </p>

      <div className="card table-wrap" style={{ padding: 0 }}>
        <table>
          <thead>
            <tr>
              <th>Username</th>
              <th>Role</th>
              <th>Authenticator</th>
              <th>Password expires</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} data-testid="user-row">
                <td>{u.username}{u.id === me.id && <span className="muted small"> (you)</span>}</td>
                <td>{u.role === "admin" ? "Admin" : "Warehouse staff"}</td>
                <td>
                  {u.totpEnabledAt ? <span className="badge ok">Set up</span> : <span className="badge warn">At next login</span>}
                </td>
                <td>{u.mustChangePassword ? <span className="badge warn">Must change at next login</span> : day(passwordExpiresOn(u))}</td>
                <td>{u.disabledAt ? <span className="badge off">Turned off</span> : "Active"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="card">
        <h2 style={{ marginTop: 0 }}>Change your password</h2>
        <ChangeMyPasswordForm minLength={MIN_PASSWORD_LENGTH} />
      </div>

      <div className="card">
        <h2 style={{ marginTop: 0 }}>Add a warehouse staff login</h2>
        <AddStaffForm minLength={MIN_PASSWORD_LENGTH} />
      </div>

      {users
        .filter((u) => u.id !== me.id)
        .map((u) => (
          <div className="card" key={u.id}>
            <h2 style={{ marginTop: 0 }}>
              {u.username} <span className="muted small">({u.role === "admin" ? "admin" : "warehouse staff"})</span>
            </h2>
            <UserControls
              userId={u.id}
              username={u.username}
              isStaff={u.role === "staff"}
              disabled={!!u.disabledAt}
              minLength={MIN_PASSWORD_LENGTH}
            />
          </div>
        ))}
    </>
  );
}
