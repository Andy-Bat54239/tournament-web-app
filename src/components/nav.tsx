"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/", label: "Sign up" },
  { href: "/bracket", label: "Bracket" },
  { href: "/match", label: "My match" },
  { href: "/organizer", label: "Organizer" },
];

export function Nav() {
  const pathname = usePathname();
  return (
    <nav aria-label="Main">
      {TABS.map(({ href, label }) => (
        <Link key={href} href={href} aria-current={pathname === href ? "page" : undefined}>
          {label}
        </Link>
      ))}
    </nav>
  );
}
