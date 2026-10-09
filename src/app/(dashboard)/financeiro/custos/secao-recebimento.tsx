"use client";

import { useId, useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dica } from "@/components/ui/dica";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Section } from "@/components/ui/section";
import { Segmented } from "@/components/ui/segmented";
import { AMOSTRA_MINIMA, type SugestaoCod } from "@/lib/financeiro/contra-entrega";
import { ROTAS, type ConfigRecebimentoCorpo } from "@/lib/financeiro/tipos";
import {
  formRecebimentoDe,
  mensagemDeFalha,
  textoSugestaoCod,
  validarRecebimento,
  type FormRecebimento,
  type ModoRecebimento,
} from "./apresentar";

// ============================================================================
// "Como a loja recebe": pagamento online ou contra entrega. Muda o Dashboard
// (Recebido, A receber e Previsto no lugar do Faturamento). Cada pedido
// contra entrega e reconhecido pelo gateway, com a loja em qualquer modo.
//
// Grava pela rota de sempre (POST /api/financeiro/config), so os campos de
// recebimento: a taxa de pagamento fica como esta. So depois de a taxa estar
// salva (a rota nao cria a linha so com o recebimento).
// ============================================================================

const MODOS: { valor: ModoRecebimento; rotulo: string }[] = [
  { valor: "online", rotulo: "Pagamento online" },
  { valor: "cod", rotulo: "Contra entrega" },
];

async function lerJson(res: Response): Promise<{ error?: unknown } | null> {
  try {
    return (await res.json()) as { error?: unknown };
  } catch {
    return null;
  }
}

export function SecaoRecebimento({
  storeId,
  moedaLoja,
  sugestao,
  taxaConfigurada,
  form,
  sujo,
  onMudar,
  onSalvo,
}: {
  storeId: string;
  moedaLoja: string | null;
  sugestao: SugestaoCod;
  /**
   * A loja ja tem a linha de taxas. Sem ela a rota recusa (409): criar a
   * linha so com o recebimento gravaria taxa 0 e tiraria o aviso de taxa.
   */
  taxaConfigurada: boolean;
  form: FormRecebimento;
  sujo: boolean;
  onMudar: (f: FormRecebimento) => void;
  onSalvo: (gravado: FormRecebimento) => void;
}) {
  const router = useRouter();
  const id = useId();
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [recarregando, iniciar] = useTransition();
  const { erros } = validarRecebimento(form);
  const textoSugestao = textoSugestaoCod(sugestao, form.modo);

  async function salvar(e: FormEvent) {
    e.preventDefault();
    if (salvando) return;
    const { corpo } = validarRecebimento(form);
    if (!corpo) {
      document.querySelector<HTMLInputElement>(`[data-recebimento="${id}"] [aria-invalid="true"]`)?.focus();
      return;
    }
    const enviar: ConfigRecebimentoCorpo = { store_id: storeId, ...corpo };
    setSalvando(true);
    setErro(null);
    try {
      let res: Response;
      try {
        res = await fetch(ROTAS.apiConfigFinanceira, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(enviar),
        });
      } catch {
        setErro(mensagemDeFalha(null, null));
        return;
      }
      if (!res.ok || res.redirected) {
        setErro(mensagemDeFalha(res.redirected ? 401 : res.status, await lerJson(res)));
        return;
      }
      onSalvo(formRecebimentoDe(corpo));
      toast.success("Recebimento salvo", {
        description: corpo.contra_entrega ? "O Dashboard já mostra a visão contra entrega." : undefined,
      });
      iniciar(() => router.refresh());
    } finally {
      setSalvando(false);
    }
  }

  return (
    <Section
      titulo="Como a loja recebe"
      descricao="Contra entrega troca o Faturamento por Recebido, A receber e Previsto no Dashboard."
    >
      <form onSubmit={salvar} noValidate data-recebimento={id} className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <Segmented
            rotulo="Como a loja recebe"
            tamanho="md"
            valor={form.modo}
            onValorChange={(modo) => onMudar({ ...form, modo })}
            opcoes={MODOS}
          />
          {textoSugestao ? (
            <span className="flex flex-wrap items-center gap-2 text-dense text-t1">
              {textoSugestao}
              <Button type="button" variant="secondary" size="sm" onClick={() => onMudar({ ...form, modo: "cod" })}>
                Usar contra entrega
              </Button>
            </span>
          ) : null}
        </div>

        {form.modo === "cod" ? (
          <div className="grid gap-4 sm:grid-cols-3">
            <Campo
              id={`${id}-entrega`}
              rotulo="Taxa de entrega padrão (%)"
              placeholder="70"
              valor={form.entrega}
              erro={erros.entrega}
              ajuda={`Quantos pedidos contra entrega são pagos. Vale até a loja ter ${AMOSTRA_MINIMA} pedidos finalizados; depois, usamos a taxa real dela.`}
              onMudar={(v) => onMudar({ ...form, entrega: v })}
            />
            <Campo
              id={`${id}-devolucao`}
              rotulo={`Custo por devolução (${moedaLoja ?? "moeda da loja"})`}
              placeholder="0"
              valor={form.devolucao}
              erro={erros.devolucao}
              ajuda="Frete de volta e taxa da transportadora de cada pedido recusado que foi enviado. Vazio vale zero."
              onMudar={(v) => onMudar({ ...form, devolucao: v })}
            />
          </div>
        ) : null}

        <div className="flex flex-wrap items-center justify-end gap-3">
          {erro ? (
            <p role="alert" className="mr-auto text-dense text-err">
              {erro}
            </p>
          ) : sujo && !taxaConfigurada ? (
            <p className="mr-auto text-dense text-t1">Salve a taxa de pagamento abaixo primeiro.</p>
          ) : null}
          <Button type="submit" pending={salvando || recarregando} disabled={!sujo || !taxaConfigurada}>
            {salvando ? "Salvando…" : "Salvar"}
          </Button>
        </div>
      </form>
    </Section>
  );
}

function Campo({
  id,
  rotulo,
  placeholder,
  valor,
  erro,
  ajuda,
  onMudar,
}: {
  id: string;
  rotulo: string;
  placeholder: string;
  valor: string;
  erro?: string;
  ajuda: string;
  onMudar: (v: string) => void;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <span className="flex items-center gap-1">
        <Label htmlFor={id}>{rotulo}</Label>
        <Dica rotulo={`Sobre ${rotulo}`}>{ajuda}</Dica>
      </span>
      <Input
        id={id}
        inputMode="decimal"
        autoComplete="off"
        spellCheck={false}
        value={valor}
        onChange={(e) => onMudar(e.target.value)}
        placeholder={placeholder}
        aria-invalid={erro ? true : undefined}
        aria-describedby={erro ? `${id}-erro` : undefined}
        className="num h-ctl-lg sm:h-ctl-md"
      />
      {erro ? (
        <p id={`${id}-erro`} className="text-label font-medium text-err">
          {erro}
        </p>
      ) : null}
    </div>
  );
}
