"use client";

import { useId, useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dica } from "@/components/ui/dica";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Section } from "@/components/ui/section";
import { StatusBadge } from "@/components/ui/status-badge";
import { ROTAS, type ConfigFinanceiraCorpo } from "@/lib/financeiro/tipos";
import { formTaxasDe, mensagemDeFalha, validarTaxas, type FormTaxas } from "./apresentar";

// ============================================================================
// (1) Taxa de pagamento e custo padrao. Vale para todo pedido da loja.
//
// Grava pela rota de sempre (POST /api/financeiro/config, mesmo corpo). O
// erro aparece no campo, todos de uma vez, antes de mandar; falha do servidor
// fica escrita embaixo do botao, nao so num toast.
// ============================================================================

async function lerJson(res: Response): Promise<{ error?: unknown } | null> {
  try {
    return (await res.json()) as { error?: unknown };
  } catch {
    return null;
  }
}

type Chave = keyof FormTaxas;

export function SecaoTaxas({
  storeId,
  moedaLoja,
  configurada,
  form,
  sujo,
  onMudar,
  onSalvo,
}: {
  storeId: string;
  moedaLoja: string | null;
  configurada: boolean;
  form: FormTaxas;
  sujo: boolean;
  onMudar: (campo: Chave, valor: string) => void;
  /** Chamado com os valores gravados (ja normalizados): viram a nova base. */
  onSalvo: (gravado: FormTaxas) => void;
}) {
  const router = useRouter();
  const id = useId();
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [recarregando, iniciar] = useTransition();
  const { erros } = validarTaxas(form);
  const moeda = moedaLoja ?? "moeda da loja";

  async function salvar(e: FormEvent) {
    e.preventDefault();
    if (salvando) return;
    const { corpo } = validarTaxas(form);
    if (!corpo) {
      document.querySelector<HTMLInputElement>(`[data-taxas="${id}"] [aria-invalid="true"]`)?.focus();
      return;
    }
    const enviar: ConfigFinanceiraCorpo = { store_id: storeId, ...corpo };
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
      // Sessao vencida: o proxy manda para /login e a resposta "da certo".
      if (!res.ok || res.redirected) {
        setErro(mensagemDeFalha(res.redirected ? 401 : res.status, await lerJson(res)));
        return;
      }
      onSalvo(formTaxasDe(corpo));
      toast.success("Taxas salvas", { description: "O lucro já usa os valores novos." });
      iniciar(() => router.refresh());
    } finally {
      setSalvando(false);
    }
  }

  return (
    <Section
      titulo="Taxa de pagamento"
      descricao={
        <span className="inline-flex items-center gap-1">
          Vale para todo pedido desta loja.
          <Dica rotulo="Onde achar a taxa">
            Use a do seu contrato com o gateway. No Shopify Payments, ela fica em Configurações › Pagamentos.
          </Dica>
        </span>
      }
      acoes={
        configurada ? (
          <StatusBadge tom="ok" tamanho="md">
            Configurada
          </StatusBadge>
        ) : (
          <StatusBadge tom="warn" tamanho="md">
            Não configurada
          </StatusBadge>
        )
      }
    >
      <form onSubmit={salvar} noValidate data-taxas={id} className="flex flex-col gap-4">
        <div className="grid gap-4 sm:grid-cols-3">
          <Campo
            id={`${id}-pct`}
            rotulo="Taxa por pedido (%)"
            placeholder="Ex.: 3,99"
            valor={form.pct}
            erro={erros.pct}
            ajuda="Sobre o valor recebido em cada pedido. Vazio vale zero."
            onMudar={(v) => onMudar("pct", v)}
          />
          <Campo
            id={`${id}-fixa`}
            rotulo={`Taxa fixa por pedido (${moeda})`}
            placeholder="Ex.: 0,39"
            valor={form.fixa}
            erro={erros.fixa}
            ajuda="Na moeda da loja. Vazio vale zero."
            onMudar={(v) => onMudar("fixa", v)}
          />
          <Campo
            id={`${id}-padrao`}
            rotulo="Custo padrão (% do preço)"
            placeholder="Vazio: não estimar"
            valor={form.padrao}
            erro={erros.padrao}
            ajuda="Só para produto sem custo lançado. Vazio: o Lucro mostra o que ficou sem custo."
            onMudar={(v) => onMudar("padrao", v)}
          />
        </div>

        <div className="flex flex-wrap items-center justify-end gap-3">
          {erro ? (
            <p role="alert" className="mr-auto text-dense text-err">
              {erro}
            </p>
          ) : null}
          <Button type="submit" pending={salvando || recarregando} disabled={configurada && !sujo}>
            {salvando ? "Salvando…" : "Salvar taxas"}
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
