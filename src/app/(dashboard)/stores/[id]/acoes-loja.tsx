"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ExternalLinkIcon, RefreshCwIcon } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { Callout } from "@/components/ui/callout";
import { COOKIE_LOJA } from "@/lib/financeiro/tipos";
import { gravarCookie } from "@/components/layout/contexto";
import type { ChaveConexao } from "@/lib/leitura/lojas-estado";
import { useConectarLoja } from "../conectar-loja";
import { RemoverLoja } from "../remover-loja";
import { useSincronizarLoja } from "../usar-sincronizar";

type LojaAcoes = { id: string; nome: string; dominio: string; chave: ChaveConexao; semAcesso: boolean };

/**
 * Botoes do cabecalho do detalhe: admin da Shopify e Sincronizar. Reconectar e
 * Remover ficam no aviso de conexao logo abaixo, quando a loja esta sem acesso.
 */
export function AcoesLoja({ loja, sincronizando }: { loja: LojaAcoes; sincronizando: boolean }) {
  const { sincronizar, emCurso } = useSincronizarLoja();
  const desinstalada = loja.chave === "appDesinstalado";

  return (
    <div className="flex flex-wrap items-center gap-2">
      <a
        href={`https://${loja.dominio}/admin`}
        target="_blank"
        rel="noopener noreferrer"
        className={cn(buttonVariants({ variant: "secondary" }))}
      >
        Admin da Shopify
        <ExternalLinkIcon aria-hidden className="size-3.5" />
        <span className="sr-only">(abre em outra aba)</span>
      </a>
      {!desinstalada ? (
        <Button
          variant={loja.semAcesso ? "secondary" : "primary"}
          pending={emCurso === loja.id}
          disabled={sincronizando}
          onClick={() => void sincronizar(loja)}
          className="min-w-40"
        >
          {emCurso === loja.id ? null : <RefreshCwIcon aria-hidden />}
          {emCurso === loja.id || sincronizando ? "Sincronizando…" : "Sincronizar agora"}
        </Button>
      ) : null}
    </div>
  );
}

const AVISO: Partial<Record<ChaveConexao, { tom: "err" | "warn"; titulo: string; texto: string }>> = {
  semPermissao: {
    tom: "err",
    titulo: "A Shopify não deixa o xcart ler os pedidos desta loja",
    texto: "Falta a permissão de pedidos. Reconecte e aprove o acesso na Shopify; até lá, nenhum pedido novo chega.",
  },
  tokenInvalido: {
    tom: "warn",
    titulo: "A credencial desta loja não vale mais",
    texto: "Reconecte com o Client ID e o Client Secret do app. Até lá, nenhum pedido novo chega.",
  },
  pausada: {
    tom: "warn",
    titulo: "A loja está pausada ou sem plano na Shopify",
    texto: "Enquanto isso, nenhum pedido novo chega. Se você não usa mais esta loja, remova do xcart.",
  },
  appDesinstalado: {
    tom: "warn",
    titulo: "O app foi desinstalado desta loja",
    texto: "Nenhum pedido novo chega e o rastreamento parou. Reconecte para voltar a usar, ou remova do xcart.",
  },
  falhaSync: {
    tom: "warn",
    titulo: "A última busca de pedidos falhou",
    texto: "A loja continua conectada. Tente de novo; se repetir, o detalhe abaixo ajuda o suporte.",
  },
};

/** Aviso de conexao no topo do detalhe, com a acao que resolve. */
export function AvisoConexao({ loja, erro }: { loja: LojaAcoes; erro: string | null }) {
  const router = useRouter();
  const { abrir } = useConectarLoja();
  const { sincronizar, emCurso } = useSincronizarLoja();
  const [remover, setRemover] = React.useState(false);
  const aviso = AVISO[loja.chave];
  if (!aviso) return null;

  return (
    <>
      <Callout
        tom={aviso.tom}
        titulo={aviso.titulo}
        className="mb-5"
        acao={
          loja.chave === "falhaSync" ? (
            <Button size="sm" variant="secondary" pending={emCurso === loja.id} onClick={() => void sincronizar(loja)}>
              Tentar de novo
            </Button>
          ) : (
            <span className="flex flex-wrap gap-2">
              <Button size="sm" onClick={() => abrir({ dominio: loja.dominio, reconectar: true })}>
                Reconectar
              </Button>
              <Button size="sm" variant="destructive" onClick={() => setRemover(true)}>
                Remover do xcart
              </Button>
            </span>
          )
        }
      >
        <p>{aviso.texto}</p>
        {erro ? (
          <details className="mt-1 text-label text-t2">
            <summary className="cursor-pointer">Ver detalhe</summary>
            <p className="mt-1 font-mono break-all">{erro}</p>
          </details>
        ) : null}
      </Callout>
      <RemoverLoja
        loja={loja}
        aberto={remover}
        aoMudar={setRemover}
        aoRemover={() => {
          router.push("/stores");
          router.refresh();
        }}
      />
    </>
  );
}

/**
 * Link para outra tela ja filtrada nesta loja: grava a loja da barra do topo
 * (o mesmo cookie do seletor) antes de navegar. Custos, Lucro e Alertas leem
 * esse cookie no servidor.
 */
export function LinkComLoja({
  lojaId,
  href,
  className,
  children,
}: {
  lojaId: string;
  href: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <Link href={href} prefetch={false} className={className} onClick={() => gravarCookie(COOKIE_LOJA, lojaId)}>
      {children}
    </Link>
  );
}
