"use client";

import * as React from "react";
import Link from "next/link";
import { XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { MENSAGEM_CONEXAO_PADRAO, mensagemConexao } from "@/lib/leitura/lojas-estado";
import { useConectarLoja } from "./conectar-loja";

const LINK = "font-medium text-brand underline underline-offset-2 hover:text-ink";

/**
 * Volta da Shopify: /stores?installed=1 (deu certo) ou ?error=... (nao deu).
 * Tambem aparece quando a loja conecta sem precisar do OAuth (o app ja estava
 * instalado). Mostra os proximos passos em vez de um toast que some.
 *
 * Os parametros saem da URL ao montar: recarregar nao repete o aviso.
 */
export function AvisoRetorno({ instalado, erro }: { instalado: boolean; erro: string | null }) {
  const { abrir, conectadaAgora, esquecerConectada } = useConectarLoja();
  const [sucesso, setSucesso] = React.useState(instalado);
  const [falha, setFalha] = React.useState(erro);

  React.useEffect(() => {
    if (!instalado && !erro) return;
    const url = new URL(window.location.href);
    url.searchParams.delete("installed");
    url.searchParams.delete("error");
    window.history.replaceState(null, "", `${url.pathname}${url.search}`);
  }, [instalado, erro]);

  if (falha) {
    return (
      <Callout
        tom="err"
        role="alert"
        titulo="A conexão com a Shopify não terminou"
        className="mb-6"
        acao={
          <Button size="sm" variant="secondary" onClick={() => abrir()}>
            Tentar de novo
          </Button>
        }
        dispensar={
          <Button size="icon-sm" variant="ghost" aria-label="Fechar aviso" onClick={() => setFalha(null)}>
            <XIcon aria-hidden />
          </Button>
        }
      >
        <p>{mensagemConexao(falha)}</p>
        {mensagemConexao(falha) === MENSAGEM_CONEXAO_PADRAO ? (
          <details className="mt-1 text-label text-t2">
            <summary className="cursor-pointer">Ver detalhe</summary>
            <p className="mt-1 font-mono break-all">{falha}</p>
          </details>
        ) : null}
      </Callout>
    );
  }

  if (!sucesso && !conectadaAgora) return null;

  return (
    <Callout
      tom="ok"
      role="status"
      className="mb-6"
      titulo={conectadaAgora ? `${conectadaAgora} conectada` : "Loja conectada"}
      dispensar={
        <Button
          size="icon-sm"
          variant="ghost"
          aria-label="Fechar aviso"
          onClick={() => {
            setSucesso(false);
            esquecerConectada();
          }}
        >
          <XIcon aria-hidden />
        </Button>
      }
    >
      <p>
        A Shopify autorizou o xcart. Os pedidos dos últimos 60 dias começam a chegar em alguns minutos. Próximos
        passos:
      </p>
      <p className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1">
        <Link href="/financeiro/anuncios" className={LINK}>
          Ligar contas de anúncio
        </Link>
        <Link href="/financeiro/custos" className={LINK}>
          Cadastrar custos
        </Link>
        <Link href="/tracking" className={LINK}>
          Ligar rastreamento
        </Link>
      </p>
    </Callout>
  );
}
