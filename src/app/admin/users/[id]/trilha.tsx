import Link from "next/link";

/** Caminho "Usuários / cliente": o topo do celular mostra so "Usuários". */
export function Trilha({ atual }: { atual: string }) {
  return (
    <nav aria-label="Caminho" className="flex min-w-0 items-center gap-1.5 text-dense">
      <Link
        href="/admin/users"
        className="shrink-0 rounded-sm text-brand underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
      >
        Usuários
      </Link>
      <span aria-hidden className="text-t3">
        /
      </span>
      <span aria-current="page" className="truncate text-t1">
        {atual}
      </span>
    </nav>
  );
}
