"use client";

// Tab-bar island (PANEL-01 / D-01) — navigation only, no data.
//
// A "use client" island because it needs usePathname() to highlight the active tab. It renders the
// three shell tabs as Links and marks the one matching the current path with aria-current="page"
// (matched on exact href OR a nested sub-path so a future /unidades/[unitId] still lights Unidades).
// Navigation only — it never reads or mutates project data; the RSC pages own that. es-AR labels.
import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { seg: "unidades", label: "Unidades" },
  { seg: "leads", label: "Leads" },
  { seg: "hotspots", label: "Hotspots" },
] as const;

export function TabBar({ projectId }: { projectId: string }): React.JSX.Element {
  const pathname = usePathname();

  return (
    <nav aria-label="Secciones del proyecto">
      <ul>
        {TABS.map(({ seg, label }) => {
          const href = `/proyectos/${projectId}/${seg}`;
          const active = pathname === href || pathname.startsWith(`${href}/`);
          return (
            <li key={seg}>
              <Link href={href} aria-current={active ? "page" : undefined}>
                {label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
