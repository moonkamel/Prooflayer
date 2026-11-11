"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Lien de navigation : la page courante est signalée par aria-current, pas seulement par le style. */
export function NavLink({ href, children }: { href: string; children: ReactNode }) {
  const pathname = usePathname();
  const current = pathname === href || pathname.startsWith(`${href}/`);
  return (
    <Link
      href={href}
      aria-current={current ? "page" : undefined}
      className={cn(
        "rounded-md px-2 py-1 text-sm text-foreground no-underline hover:bg-muted hover:no-underline",
        current && "bg-muted font-semibold",
      )}
    >
      {children}
    </Link>
  );
}
