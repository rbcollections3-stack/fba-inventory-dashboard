"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import {
  Barcode,
  ChartLine,
  ClipboardCheck,
  CloudDownload,
  FileSpreadsheet,
  Layers,
  LayoutDashboard,
  Menu,
  Package,
  PackageOpen,
  Ship,
  Truck,
  Users,
  Warehouse,
  X,
  type LucideIcon,
} from "lucide-react";

type Item = { href: string; label: string; icon: LucideIcon; adminOnly?: boolean };
type Section = { title: string; items: Item[] };

/** Every screen in the side menu. Add new screens here. */
const SECTIONS: Section[] = [
  {
    title: "Plan",
    items: [
      { href: "/overview", label: "Overview", icon: LayoutDashboard, adminOnly: true },
      { href: "/shipments", label: "Ship to Amazon", icon: Truck, adminOnly: true },
      { href: "/forecast-check", label: "Forecast check", icon: ChartLine, adminOnly: true },
      { href: "/china", label: "China orders", icon: Ship, adminOnly: true },
    ],
  },
  {
    title: "Products",
    items: [
      { href: "/skus", label: "SKUs", icon: Package, adminOnly: true },
      { href: "/skus/import", label: "Import spreadsheet", icon: FileSpreadsheet, adminOnly: true },
      { href: "/amazon", label: "Amazon reports", icon: CloudDownload, adminOnly: true },
    ],
  },
  {
    title: "Warehouse",
    items: [
      { href: "/warehouse", label: "Warehouse", icon: Warehouse },
      { href: "/warehouse/shipments", label: "Pallet sheets", icon: Layers },
      { href: "/warehouse/labels", label: "Barcode labels", icon: Barcode },
      { href: "/warehouse/receiving", label: "Receiving", icon: PackageOpen },
      { href: "/warehouse/counts", label: "Stock counts", icon: ClipboardCheck },
    ],
  },
  {
    title: "Admin",
    items: [{ href: "/accounts", label: "Accounts", icon: Users, adminOnly: true }],
  },
];

/** The longest menu link that the current address starts with is the one shown as selected. */
function currentHref(pathname: string, hrefs: string[]): string | null {
  let best: string | null = null;
  for (const href of hrefs) {
    if ((pathname === href || pathname.startsWith(href + "/")) && (!best || href.length > best.length)) best = href;
  }
  return best;
}

export function SideNav({ isAdmin, footer }: { isAdmin: boolean; footer: React.ReactNode }) {
  const pathname = usePathname();
  // On phones the menu opens over the page; it closes again when the address changes.
  const [openOn, setOpenOn] = useState<string | null>(null);
  const open = openOn === pathname;

  const sections = SECTIONS.map((s) => ({ ...s, items: s.items.filter((i) => isAdmin || !i.adminOnly) })).filter(
    (s) => s.items.length > 0,
  );
  const current = currentHref(pathname, sections.flatMap((s) => s.items.map((i) => i.href)));

  return (
    <aside className="sidenav no-print" data-open={open ? "true" : "false"}>
      <div className="sidenav-head">
        <Link href="/" className="brand">
          <span className="brand-mark" aria-hidden="true">
            RB
          </span>
          <span className="brand-text">
            <span className="brand-name">RB Collections</span>
            <span className="brand-sub">FBA dashboard</span>
          </span>
        </Link>
        <button
          type="button"
          className="menu-toggle"
          aria-expanded={open}
          aria-controls="main-menu"
          onClick={() => setOpenOn(open ? null : pathname)}
        >
          {open ? <X size={20} aria-hidden="true" /> : <Menu size={20} aria-hidden="true" />}
          <span className="sr-only">{open ? "Close menu" : "Open menu"}</span>
        </button>
      </div>
      <div className="sidenav-body" id="main-menu">
        <nav aria-label="Main">
          {sections.map((s) => (
            <div className="nav-section" key={s.title}>
              {isAdmin && <div className="nav-title">{s.title}</div>}
              <ul>
                {s.items.map((i) => {
                  const Icon = i.icon;
                  return (
                    <li key={i.href}>
                      <Link href={i.href} aria-current={i.href === current ? "page" : undefined}>
                        <Icon size={18} strokeWidth={1.8} aria-hidden="true" />
                        {i.label}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>
        <div className="sidenav-foot">{footer}</div>
      </div>
    </aside>
  );
}
