import { LogOut } from "lucide-react";
import { requireUser } from "@/lib/auth/session";
import { logout } from "../login/actions";
import { SideNav } from "./side-nav";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const isAdmin = user.role === "admin";
  return (
    <div className="shell">
      <SideNav
        isAdmin={isAdmin}
        footer={
          <div className="who">
            <span className="avatar" aria-hidden="true">
              {user.username.slice(0, 1).toUpperCase()}
            </span>
            <span className="who-text">
              <span className="who-name">{user.username}</span>
              <span className="who-role">{isAdmin ? "admin" : "warehouse staff"}</span>
            </span>
            <form action={logout}>
              <button type="submit" className="logout" title="Log out">
                <LogOut size={16} aria-hidden="true" />
                Log out
              </button>
            </form>
          </div>
        }
      />
      <main className="page">{children}</main>
    </div>
  );
}
