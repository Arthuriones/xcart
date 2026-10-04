"use client";

import { useId, useMemo, useState, useTransition, type ChangeEvent } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Download, Upload } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { cn } from "@/components/ui/cn";
import { Label } from "@/components/ui/label";
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { StatusBadge } from "@/components/ui/status-badge";
import { Textarea } from "@/components/ui/textarea";
import { ROTAS, type CustosCorpo } from "@/lib/financeiro/tipos";
import { parseCsvCustos } from "@/lib/financeiro/csv-custos";
import type { DadosCustos } from "@/lib/financeiro/custos-queries";
import { fmtInteiro, mensagemDeFalha, montarModeloCsv, plural, resumirPrevia } from "./apresentar";

// ============================================================================
// Importar pela planilha (CSV): atalho para lancar muitos custos de uma vez.
// Fica num painel lateral, aberto pelo "Importar CSV" da tabela: quem lanca
// um custo por vez nao precisa ver nada disto.
//
// Baixar o modelo ja preenchido, escolher o arquivo ou colar, conferir a
// previa (erros por linha, SKUs sem venda) e importar. A previa usa a mesma
// validacao da rota: o que ela mostra como pronto, o servidor aceita.
// Grava pela rota de sempre (POST /api/financeiro/custos, origem "csv").
//
// O texto colado mora na tela (custos-screen): fechar o painel nao perde o
// que foi colado, e o aviso ao sair continua sabendo dele.
// ============================================================================

const MAX_ARQUIVO = 5 * 1024 * 1024;

async function lerJson(res: Response): Promise<{ error?: unknown; gravados?: unknown } | null> {
  try {
    return (await res.json()) as { error?: unknown; gravados?: unknown };
  } catch {
    return null;
  }
}

export function PainelPlanilha({
  aberto,
  onAberto,
  dados,
  dominio,
  texto,
  onTexto,
}: {
  aberto: boolean;
  onAberto: (aberto: boolean) => void;
  dados: DadosCustos;
  dominio: string;
  texto: string;
  onTexto: (t: string) => void;
}) {
  const router = useRouter();
  const id = useId();
  const [arquivo, setArquivo] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [importando, setImportando] = useState(false);
  const [recarregando, iniciar] = useTransition();
  const moedaPadrao = dados.moedaLoja || "USD";

  const previa = useMemo(() => (texto.trim() ? parseCsvCustos(texto, moedaPadrao) : null), [texto, moedaPadrao]);
  const resumo = useMemo(() => (previa ? resumirPrevia(previa, dados.skus) : null), [previa, dados.skus]);

  function baixarModelo() {
    // BOM: sem ele o Excel abre UTF-8 como Latin-1 e estraga SKU com acento.
    const blob = new Blob(["﻿" + montarModeloCsv(dados.skus, moedaPadrao)], {
      type: "text/csv;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `custos-${dominio || "loja"}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function lerArquivo(ev: ChangeEvent<HTMLInputElement>) {
    const escolhido = ev.target.files?.[0];
    ev.target.value = "";
    if (!escolhido) return;
    setErro(null);
    if (escolhido.size > MAX_ARQUIVO) {
      setErro("O arquivo passa de 5 MB. Divida a planilha em partes menores.");
      return;
    }
    const leitor = new FileReader();
    leitor.onload = () => {
      setArquivo(escolhido.name);
      onTexto(typeof leitor.result === "string" ? leitor.result : "");
    };
    leitor.onerror = () => setErro("Não deu para ler o arquivo. Salve como CSV e tente de novo.");
    leitor.readAsText(escolhido);
  }

  function limpar() {
    onTexto("");
    setArquivo(null);
    setErro(null);
  }

  async function importar() {
    if (!previa || previa.itens.length === 0 || importando) return;
    const corpo: CustosCorpo = { store_id: dados.storeId, origem: "csv", itens: previa.itens };
    setImportando(true);
    setErro(null);
    try {
      let res: Response;
      try {
        res = await fetch(ROTAS.apiCustos, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(corpo),
        });
      } catch {
        setErro(mensagemDeFalha(null, null));
        return;
      }
      const j = await lerJson(res);
      if (!res.ok || res.redirected) {
        setErro(mensagemDeFalha(res.redirected ? 401 : res.status, j, previa.itens.length));
        return;
      }
      const gravados = Number(j?.gravados) || previa.itens.length;
      toast.success(gravados === 1 ? "1 custo importado" : `${fmtInteiro(gravados)} custos importados`, {
        description: "A tabela e o lucro já usam os custos novos.",
      });
      iniciar(() => {
        limpar();
        onAberto(false);
        router.refresh();
      });
    } finally {
      setImportando(false);
    }
  }

  return (
    <Sheet open={aberto} onOpenChange={onAberto}>
      <SheetContent size="lg">
        <SheetHeader>
          <SheetTitle>Importar CSV</SheetTitle>
          <SheetDescription>Para lançar muitos custos de uma vez.</SheetDescription>
        </SheetHeader>

        <SheetBody className="flex flex-col gap-4">
          <Callout tom="warn" titulo="Não use a planilha de produtos da Shopify">
            Importar com “sobrescrever” sem as colunas de opção apaga as variantes, e isso quebra o SKU, a rota e o
            rastreamento. Use o modelo desta tela.
          </Callout>

          <ol className="flex list-decimal flex-col gap-1 pl-5 text-dense text-t1">
            <li>Baixe o modelo: ele já vem com os produtos e o custo atual de cada um.</li>
            <li>Preencha custo, frete e moeda. Decimal com vírgula (12,50); data vazia vale a partir de hoje.</li>
            <li>Escolha o arquivo ou cole o conteúdo abaixo e confira a prévia.</li>
          </ol>

          <div className="flex flex-wrap items-center gap-2">
            <Button variant="secondary" className="h-ctl-lg sm:h-ctl-md" onClick={baixarModelo}>
              <Download aria-hidden />
              Baixar modelo
            </Button>
            <label
              className={cn(
                buttonVariants({ variant: "secondary" }),
                "h-ctl-lg cursor-pointer focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-focus sm:h-ctl-md"
              )}
            >
              <Upload aria-hidden />
              Escolher arquivo
              <input type="file" accept=".csv,.txt,text/csv,text/plain" onChange={lerArquivo} className="sr-only" />
            </label>
            {arquivo ? <span className="min-w-0 truncate text-label text-t2">{arquivo}</span> : null}
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${id}-csv`}>Conteúdo da planilha</Label>
            <Textarea
              id={`${id}-csv`}
              value={texto}
              onChange={(e) => {
                setArquivo(null);
                onTexto(e.target.value);
              }}
              rows={6}
              spellCheck={false}
              aria-describedby={`${id}-formato`}
              placeholder={"sku;custo_unitario;frete_unitario;moeda;valido_desde\nCIL-001;12,50;3,20;USD;2026-10-01"}
              className="font-mono text-dense"
            />
            <p id={`${id}-formato`} className="text-label text-t2">
              Colunas: <span className="font-mono">sku; custo_unitario; frete_unitario; moeda; valido_desde</span>.
              Moeda vazia vale {moedaPadrao}.
            </p>
          </div>

          {erro && !previa ? (
            <p role="alert" className="text-dense font-medium text-err">
              {erro}
            </p>
          ) : null}

          {previa && resumo ? (
            <div className="flex flex-col gap-3 rounded-control border border-border bg-surface-2 p-3">
              <div aria-live="polite" className="flex flex-wrap gap-2">
                <StatusBadge tom={resumo.prontos > 0 ? "ok" : "neutral"}>
                  {plural(resumo.prontos, "linha pronta", "linhas prontas")}
                </StatusBadge>
                {resumo.comErro > 0 ? (
                  <StatusBadge tom="err">{plural(resumo.comErro, "linha com erro", "linhas com erro")}</StatusBadge>
                ) : null}
                {resumo.semVenda.length > 0 ? (
                  <StatusBadge tom="neutral">
                    {plural(resumo.semVenda.length, "SKU sem venda", "SKUs sem venda")}
                  </StatusBadge>
                ) : null}
              </div>

              {previa.erros.length > 0 ? (
                <div className="flex flex-col gap-1">
                  <p className="text-dense font-semibold text-ink">
                    Linhas com erro (não entram; corrija na planilha e cole de novo)
                  </p>
                  <ul className="max-h-40 overflow-y-auto text-dense text-t1">
                    {previa.erros.slice(0, 100).map((e, i) => (
                      <li key={`${e.linha}-${i}`}>
                        <span className="num font-medium text-ink">Linha {e.linha}:</span> {e.motivo}
                      </li>
                    ))}
                    {previa.erros.length > 100 ? <li>E mais {fmtInteiro(previa.erros.length - 100)}.</li> : null}
                  </ul>
                </div>
              ) : null}

              {resumo.semVenda.length > 0 ? (
                <p className="text-dense text-t1">
                  {resumo.semVenda.length === 1
                    ? "1 SKU não vendeu nos últimos 60 dias e será gravado assim mesmo: "
                    : `${fmtInteiro(resumo.semVenda.length)} SKUs não venderam nos últimos 60 dias e serão gravados assim mesmo: `}
                  <span className="break-all font-mono text-ink">
                    {resumo.semVenda.slice(0, 15).join(", ")}
                    {resumo.semVenda.length > 15 ? "…" : ""}
                  </span>
                </p>
              ) : null}

              {resumo.repetidos > 0 ? (
                <p className="text-dense text-t1">
                  {resumo.repetidos === 1
                    ? "1 linha repete o SKU e a data de outra: vale a que está mais abaixo."
                    : `${fmtInteiro(resumo.repetidos)} linhas repetem o SKU e a data de outra: vale a que está mais abaixo.`}
                </p>
              ) : null}

              {erro ? (
                <p role="alert" className="text-dense font-medium text-err">
                  {erro}
                </p>
              ) : null}
            </div>
          ) : null}
        </SheetBody>

        {previa && resumo ? (
          <SheetFooter>
            <Button variant="ghost" onClick={limpar} disabled={importando}>
              Limpar
            </Button>
            <Button pending={importando || recarregando} disabled={resumo.prontos === 0} onClick={() => void importar()}>
              {importando
                ? "Importando…"
                : resumo.prontos === 1
                  ? "Importar 1 custo"
                  : `Importar ${fmtInteiro(resumo.prontos)} custos`}
            </Button>
          </SheetFooter>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
