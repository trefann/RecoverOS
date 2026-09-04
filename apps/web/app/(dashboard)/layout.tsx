"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import clsx from "clsx";

const NAV = [
  { href: "/overview", label: "Overview" },
  { href: "/queue", label: "Recovery Queue" },
  { href: "/analytics", label: "Analytics" },
  { href: "/audit", label: "AI Activity" },
];

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setVisible(true), 30);
    return () => clearTimeout(timer);
  }, []);

  return (
    <div className={clsx("min-h-screen transition-opacity duration-300 ease-out", visible ? "opacity-100" : "opacity-0")}>
      <header className="sticky top-0 z-10 border-b border-surface-border bg-surface-panel/80 backdrop-blur">
        <div className="mx-auto grid max-w-6xl grid-cols-[1fr_auto_1fr] items-center gap-4 px-6 py-3">
          <Link href="/" className="font-mono text-base font-black tracking-tight">
            RecoverOS
          </Link>

          <nav className="flex items-center gap-1 rounded-full border border-surface-border bg-surface-raised/50 p-1">
            {NAV.map((item) => {
              const active = pathname === item.href || pathname?.startsWith(item.href + "/");
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={clsx(
                    "rounded-full px-4 py-1.5 text-sm font-semibold transition",
                    active ? "bg-signal-ai text-black" : "text-ink-muted hover:text-ink"
                  )}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>

          <div />
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl overflow-x-auto">{children}</main>
    </div>
  );
}
