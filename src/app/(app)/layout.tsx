import Link from "next/link";
import { requireUser } from "@/lib/auth/session";
import { logout } from "../login/actions";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const isAdmin = user.role === "admin";
  return (
    <>
      <header className="topbar">
        <div className="topbar-inner">
          <Link href="/" className="brand">
            RB Collections
          </Link>
          <nav className="nav" aria-label="Main">
            {isAdmin && <Link href="/skus">SKUs</Link>}
            {isAdmin && <Link href="/skus/import">Import spreadsheet</Link>}
            {isAdmin && <Link href="/amazon">Amazon reports</Link>}
            <Link href="/warehouse">Warehouse</Link>
            <Link href="/warehouse/counts">Stock counts</Link>
            {isAdmin && <Link href="/accounts">Accounts</Link>}
          </nav>
          <div className="who">
            <span className="muted small">
              {user.username} ({isAdmin ? "admin" : "warehouse staff"})
            </span>
            <form action={logout}>
              <button type="submit">Log out</button>
            </form>
          </div>
        </div>
      </header>
      <main className="page">{children}</main>
    </>
  );
}
