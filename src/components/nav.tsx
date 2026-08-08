"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/", label: "Overview" },
  { href: "/cvs", label: "CV Library" },
  { href: "/profile", label: "My Professional Profile" },
  { href: "/search", label: "Search Terms" },
  { href: "/jobs", label: "Jobs" },
];

export function Nav() {
  const pathname = usePathname();

  return (
    <header className="hairline sticky top-0 z-20 border-b backdrop-blur" style={{ background: "color-mix(in srgb, var(--surface) 88%, transparent)" }}>
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
        <Link href="/" className="flex items-center gap-2 font-semibold">
          <span className="grid h-7 w-7 place-items-center rounded-md bg-brand-600 text-sm text-white">
            RX
          </span>
          Rolexa
        </Link>
        <nav className="flex flex-wrap items-center gap-1 text-sm">
          {LINKS.map((link) => {
            const active =
              link.href === "/" ? pathname === "/" : pathname.startsWith(link.href);
            return (
              <Link
                key={link.href}
                href={link.href}
                aria-current={active ? "page" : undefined}
                className={`rounded-md px-2.5 py-1.5 transition-colors ${
                  active
                    ? "bg-ink-100 font-medium dark:bg-ink-800"
                    : "muted hover:bg-ink-100 dark:hover:bg-ink-800"
                }`}
              >
                {link.label}
              </Link>
            );
          })}
        </nav>
      </div>
    </header>
  );
}
