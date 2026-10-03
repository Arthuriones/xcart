"use client";

import * as React from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { itensInventario, type InventarioLoja } from "@/lib/leitura/lojas-estado";

export type LojaParaRemover = { id: string; nome: string; dominio: string };

type Estado =
  | { tipo: "carregando" }
  | { tipo: "pronto"; inventario: InventarioLoja }
  | { tipo: "falhou" };

/**
 * "Remover do xcart" com o inventario do que some, contado de verdade antes
 * de confirmar. Substitui o confirm() nativo de 6 linhas.
 *
 * Quem apaga continua sendo DELETE /api/stores/[id] com `confirmar: true`.
 * As contagens vem de GET /api/leitura/lojas/inventario: a sondagem do DELETE
 * (sem confirmar) apagaria uma loja vazia na hora, antes da pergunta.
 *
 * O dialogo monta a cada abertura: conta de novo (a loja pode ter mudado) e
 * nunca mostra o resultado de uma abertura anterior.
 */
export function RemoverLoja({
  loja,
  aberto,
  aoMudar,
  aoRemover,
}: {
  loja: LojaParaRemover | null;
  aberto: boolean;
  aoMudar: (aberto: boolean) => void;
  /** Chamado depois que o servidor confirmou: tire a linha da lista na hora. */
  aoRemover: (id: string) => void;
}) {
  if (!aberto || !loja) return null;
  return <Dialogo key={loja.id} loja={loja} aoMudar={aoMudar} aoRemover={aoRemover} />;
}

function Dialogo({
  loja,
  aoMudar,
  aoRemover,
}: {
  loja: LojaParaRemover;
  aoMudar: (aberto: boolean) => void;
  aoRemover: (id: string) => void;
}) {
  const [estado, setEstado] = React.useState<Estado>({ tipo: "carregando" });

  React.useEffect(() => {
    const controle = new AbortController();
    fetch(`/api/leitura/lojas/inventario?loja=${encodeURIComponent(loja.id)}`, { signal: controle.signal })
      .then(async (r) => {
        // Sessao vencida: o proxy manda para /login e a resposta "da certo".
        if (!r.ok || r.redirected) throw new Error(String(r.status));
        const dados = (await r.json()) as { inventario: InventarioLoja };
        setEstado({ tipo: "pronto", inventario: dados.inventario });
      })
      .catch(() => {
        if (!controle.signal.aborted) setEstado({ tipo: "falhou" });
      });
    return () => controle.abort();
  }, [loja.id]);

  async function remover() {
    const res = await fetch(`/api/stores/${encodeURIComponent(loja.id)}`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ confirmar: true }),
    });
    if (!res.ok || res.redirected) throw new Error(String(res.status));
    aoRemover(loja.id);
    toast.success(`${loja.nome} removida do xcart`, {
      description: "A lista já foi atualizada. Nada mudou na Shopify.",
    });
  }

  const itens = estado.tipo === "pronto" ? itensInventario(estado.inventario) : null;

  return (
    <ConfirmDialog
      open
      onOpenChange={aoMudar}
      titulo={`Remover ${loja.nome} do xcart?`}
      confirmar="Remover do xcart"
      mensagemErro="Não deu para remover a loja agora. Nada foi apagado; tente de novo."
      onConfirmar={remover}
      descricao={
        <span className="flex flex-col gap-2">
          <span className="font-mono text-label text-t2">{loja.dominio}</span>
          <span>Isto apaga do xcart, sem volta:</span>
          {estado.tipo === "carregando" ? (
            <span aria-busy="true" aria-label="Contando o que sai" className="flex flex-col gap-1.5 py-0.5">
              {/* .skeleton em span: o Skeleton da fundacao e <div>, invalido dentro do <p>. */}
              <span aria-hidden className="skeleton block h-3.5 w-4/5 rounded-sm" />
              <span aria-hidden className="skeleton block h-3.5 w-3/5 rounded-sm" />
              <span aria-hidden className="skeleton block h-3.5 w-2/3 rounded-sm" />
            </span>
          ) : itens && itens.apaga.length > 0 ? (
            <Lista itens={itens.apaga} />
          ) : itens ? (
            <span className="text-ink">Só o cadastro da loja: ela não tem produtos, rotas, rastreamento nem pedidos no xcart.</span>
          ) : (
            <span className="text-ink">
              Os produtos importados, os materiais de marca, as rotas, o rastreamento e o histórico de pedidos
              desta loja. (Não deu para contar agora.)
            </span>
          )}
          {itens && itens.fica.length > 0 ? (
            <>
              <span>Fica:</span>
              <Lista itens={itens.fica} />
            </>
          ) : null}
          <span>A loja continua igual na Shopify. Para voltar a usar, conecte de novo.</span>
        </span>
      }
    />
  );
}

/** Lista dentro da descricao (um <p>): spans com papel de lista, HTML valido. */
function Lista({ itens }: { itens: string[] }) {
  return (
    <span role="list" className="flex flex-col gap-1 pl-4 text-ink">
      {itens.map((t) => (
        <span role="listitem" key={t} className="list-item list-disc">
          {t}
        </span>
      ))}
    </span>
  );
}
