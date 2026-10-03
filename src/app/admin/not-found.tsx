import Link from "next/link";

/** notFound() dentro do admin (usuario apagado, endereco errado): com o menu ao lado. */
export default function AdminNotFound() {
  return (
    <div className="flex min-h-[60dvh] flex-col items-center justify-center gap-3 px-4 py-12 text-center">
      <span className="font-mono text-label text-t2">Erro 404</span>
      <h1 className="text-page font-semibold text-ink">Não encontramos esta página</h1>
      <p className="max-w-115 text-body text-t1">
        O usuário pode ter sido apagado, ou o endereço mudou. Nada foi alterado.
      </p>
      <div className="flex flex-wrap justify-center gap-2">
        <Link
          href="/admin/users"
          className="inline-flex h-ctl-md items-center rounded-control bg-solid px-4 text-dense font-medium text-on-solid hover:bg-solid-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
        >
          Ver os usuários
        </Link>
        <Link
          href="/admin"
          className="inline-flex h-ctl-md items-center rounded-control border border-border-strong bg-surface px-4 text-dense font-medium text-ink hover:border-control-border hover:bg-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
        >
          Ir para a visão geral
        </Link>
      </div>
    </div>
  );
}
