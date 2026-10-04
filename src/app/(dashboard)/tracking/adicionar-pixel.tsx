"use client";

import { useId, useState } from "react";
import { Copy, Plus, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import type { ChaveEvento } from "@/lib/tracking/eventos";
import type { DestinoNaTela, LojaTracking } from "@/lib/tracking/queries";
import { criarPixel } from "./acoes";
import { Logo } from "./logos";
import type { Plataforma } from "./saude";

// ============================================================================
// "Adicionar pixel": plataforma, como (novo ou de outra loja) e os campos.
//
// "Pixel de outra loja" so existe no Google: la o pixel e o ID mais os
// rotulos, que a tela ja tem. No Meta e o ID mais o TOKEN, e o token nunca
// sai do servidor -- copiar exigiria rota nova de escrita.
//
// No celular sobe de baixo, como folha; no desktop, centrado.
// ============================================================================

/** Ordem dos rotulos do Google: a compra primeiro, obrigatoria. */
const EVENTOS_GOOGLE: { chave: ChaveEvento; nome: string }[] = [
  { chave: "purchase", nome: "Compra" },
  { chave: "begin_checkout", nome: "Checkout" },
  { chave: "add_to_cart", nome: "Carrinho" },
  { chave: "view_item", nome: "Ver produto" },
];

const CAMPO = "h-10 text-body";
const OPCAO =
  "flex h-10 items-center gap-2 rounded-card border px-3.5 text-dense text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus";

export function AdicionarPixel({
  loja,
  lojas,
  plataformaInicial,
  onFechar,
  aoSalvar,
}: {
  loja: LojaTracking;
  /** Todas as lojas da tela: os pixels Google das outras podem ser reusados. */
  lojas: LojaTracking[];
  plataformaInicial: Plataforma;
  onFechar: () => void;
  aoSalvar: () => void;
}) {
  const id = useId();
  const [plat, setPlat] = useState<Plataforma>(plataformaInicial);
  const [metodo, setMetodo] = useState<"novo" | "existente">("novo");
  const [v, setV] = useState({ nome: "", pid: "", tok: "", teste: "", aw: "" });
  const [rotulos, setRotulos] = useState<string[]>([""]);
  const [escolhido, setEscolhido] = useState(0);
  const [erro, setErro] = useState(false);
  const [salvando, setSalvando] = useState(false);

  const outros: { d: DestinoNaTela; loja: string }[] = lojas
    .filter((l) => l.storeId !== loja.storeId)
    .flatMap((l) =>
      l.destinos
        .filter((d) => d.plataforma === "google" && d.labels.purchase)
        .map((d) => ({ d, loja: l.dominio }))
    );
  const podeReusar = plat === "google" && outros.length > 0;
  const modo = podeReusar ? metodo : "novo";

  async function salvar() {
    const falta =
      modo === "novo" &&
      (plat === "meta" ? !v.pid.trim() || !v.tok.trim() : !v.aw.trim() || !rotulos[0]?.trim());
    if (falta) {
      setErro(true);
      return;
    }
    setSalvando(true);
    try {
      if (plat === "meta") {
        await criarPixel({
          storeId: loja.storeId,
          plataforma: "meta",
          nome: v.nome.trim(),
          conta: v.pid.trim(),
          token: v.tok.trim(),
          teste: v.teste.trim(),
        });
      } else if (modo === "existente") {
        const o = outros[escolhido].d;
        await criarPixel({
          storeId: loja.storeId,
          plataforma: "google",
          nome: o.nome ?? "",
          conta: o.conta,
          labels: o.labels,
        });
      } else {
        const labels: Record<string, string> = {};
        rotulos.forEach((r, i) => {
          if (r.trim()) labels[EVENTOS_GOOGLE[i].chave] = r.trim();
        });
        await criarPixel({
          storeId: loja.storeId,
          plataforma: "google",
          nome: v.nome.trim(),
          conta: v.aw.trim(),
          labels,
        });
      }
      toast.success("Pixel adicionado");
      onFechar();
      aoSalvar();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não deu para adicionar o pixel.");
    } finally {
      setSalvando(false);
    }
  }

  function campo(
    chave: keyof typeof v,
    rotulo: string,
    exemplo: string,
    ajuda: string,
    o: { opc?: boolean; mono?: boolean; senha?: boolean; erroTxt?: string } = {}
  ) {
    const invalido = erro && !o.opc && !v[chave].trim();
    const idCampo = `${id}-${chave}`;
    return (
      <div className="flex flex-col gap-1.5">
        <label htmlFor={idCampo} className="text-dense font-medium text-ink">
          {rotulo}
          {o.opc && <span className="font-normal text-t2"> (opcional)</span>}
        </label>
        <Input
          id={idCampo}
          type={o.senha ? "password" : "text"}
          value={v[chave]}
          placeholder={exemplo}
          autoComplete="off"
          aria-invalid={invalido || undefined}
          aria-describedby={`${idCampo}-a`}
          className={cn(CAMPO, o.mono && "font-mono")}
          onChange={(e) => setV((s) => ({ ...s, [chave]: e.target.value }))}
        />
        <span id={`${idCampo}-a`} className={cn("text-label", invalido ? "text-err" : "text-t2")}>
          {invalido ? o.erroTxt : ajuda}
        </span>
      </div>
    );
  }

  const radio = (on: boolean) =>
    cn(OPCAO, on ? "border-ink bg-surface-2 shadow-[0_0_0_1px_var(--ink)]" : "border-border bg-surface");

  return (
    <Dialog open onOpenChange={(aberto) => !aberto && !salvando && onFechar()}>
      <DialogContent
        size="md"
        className="max-sm:top-auto max-sm:bottom-0 max-sm:w-full max-sm:max-w-none max-sm:translate-y-0 max-sm:rounded-b-none"
      >
        <DialogHeader>
          <DialogTitle>Adicionar pixel</DialogTitle>
          <DialogDescription>
            {plat === "meta"
              ? `As compras de ${loja.dominio} passam a chegar nesse pixel pelo servidor.`
              : `A tag do Google passa a contar as compras de ${loja.dominio} no navegador.`}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-5">
          <div role="radiogroup" aria-labelledby={`${id}-plat`} className="flex flex-col gap-2">
            <span id={`${id}-plat`} className="text-dense font-medium text-ink">
              Plataforma
            </span>
            <div className="flex flex-wrap gap-2">
              {(["meta", "google"] as const).map((p) => (
                <button
                  key={p}
                  type="button"
                  role="radio"
                  aria-checked={plat === p}
                  className={radio(plat === p)}
                  onClick={() => {
                    setPlat(p);
                    setErro(false);
                  }}
                >
                  <Logo marca={p} />
                  {p === "meta" ? "Meta" : "Google Ads"}
                </button>
              ))}
            </div>
          </div>

          {podeReusar && (
            <div role="radiogroup" aria-labelledby={`${id}-como`} className="flex flex-col gap-2">
              <span id={`${id}-como`} className="text-dense font-medium text-ink">
                Como
              </span>
              <div className="flex flex-wrap gap-2">
                {(
                  [
                    ["novo", "Novo pixel", Plus],
                    ["existente", "Pixel de outra loja", Copy],
                  ] as const
                ).map(([m, rotulo, Icone]) => (
                  <button
                    key={m}
                    type="button"
                    role="radio"
                    aria-checked={metodo === m}
                    className={radio(metodo === m)}
                    onClick={() => setMetodo(m)}
                  >
                    <Icone aria-hidden className="size-3.75" />
                    {rotulo}
                  </button>
                ))}
              </div>
            </div>
          )}

          {modo === "novo" && plat === "meta" && (
            <>
              {campo("nome", "Nome", "ex.: Loja principal", "Só aparece no xcart.", { opc: true })}
              {campo("pid", "ID do pixel", "ex.: 482917350021", "No Gerenciador de Eventos, abaixo do nome do pixel.", {
                mono: true,
                erroTxt: "Cole o ID do pixel.",
              })}
              {campo("tok", "Token de conversões", "começa com EAA", "Em Configurações do pixel › API de conversões › Gerar token.", {
                mono: true,
                senha: true,
                erroTxt: "Cole o token de conversões.",
              })}
              {campo("teste", "Código de teste", "ex.: TEST4821", "Para ver os eventos em “Testar eventos” no Meta.", {
                opc: true,
                mono: true,
              })}
            </>
          )}

          {modo === "novo" && plat === "google" && (
            <>
              {campo("nome", "Nome", "ex.: Pesquisa", "Só aparece no xcart.", { opc: true })}
              {campo("aw", "ID de conversão", "ex.: AW-1128430917", "No Google Ads: Metas › Conversões › Tag.", {
                mono: true,
                erroTxt: "Cole o ID que começa com AW-.",
              })}
              <div className="flex flex-col gap-2">
                <span className="text-dense font-medium text-ink">Rótulos de conversão</span>
                {rotulos.map((r, i) => {
                  const ev = EVENTOS_GOOGLE[i];
                  const invalido = erro && i === 0 && !r.trim();
                  return (
                    <div key={ev.chave} className="grid grid-cols-[96px_1fr_40px] items-center gap-2 sm:grid-cols-[130px_1fr_40px]">
                      <span className="flex h-10 items-center rounded-control border border-control-border px-3 text-dense text-ink">
                        {ev.nome}
                      </span>
                      <Input
                        value={r}
                        aria-label={`Rótulo de ${ev.nome}`}
                        aria-invalid={invalido || undefined}
                        placeholder="ex.: kP3xCJ7l8Y0Z"
                        autoComplete="off"
                        className="h-10 min-w-0 font-mono"
                        onChange={(e) => setRotulos((s) => s.map((x, j) => (j === i ? e.target.value : x)))}
                      />
                      <Button
                        variant="secondary"
                        size="icon"
                        className="size-10"
                        aria-label={`Remover rótulo de ${ev.nome}`}
                        // So o ultimo sai: cada linha e de um evento fixo.
                        disabled={i === 0 || i !== rotulos.length - 1}
                        onClick={() => setRotulos((s) => s.filter((_, j) => j !== i))}
                      >
                        <X aria-hidden />
                      </Button>
                    </div>
                  );
                })}
                {rotulos.length < EVENTOS_GOOGLE.length && (
                  <Button variant="secondary" onClick={() => setRotulos((s) => [...s, ""])}>
                    <Plus aria-hidden />
                    Adicionar rótulo de {EVENTOS_GOOGLE[rotulos.length].nome.toLowerCase()}
                  </Button>
                )}
                <span className={cn("text-label", erro && !rotulos[0]?.trim() ? "text-err" : "text-t2")}>
                  A compra é obrigatória; os outros eventos são opcionais.
                </span>
              </div>
            </>
          )}

          {modo === "existente" && (
            <div role="radiogroup" aria-labelledby={`${id}-outros`} className="flex flex-col gap-2">
              <span id={`${id}-outros`} className="text-dense font-medium text-ink">
                Pixels das suas outras lojas
              </span>
              {outros.map((o, i) => (
                <button
                  key={o.d.id}
                  type="button"
                  role="radio"
                  aria-checked={escolhido === i}
                  onClick={() => setEscolhido(i)}
                  className={cn(
                    "flex items-center gap-3 rounded-card border px-3.5 py-3 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus",
                    escolhido === i ? "border-ink bg-surface-2" : "border-border bg-surface"
                  )}
                >
                  <span aria-hidden className="grid size-4 place-items-center rounded-full border border-control-border">
                    {escolhido === i && <span className="size-2 rounded-full bg-ink" />}
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="text-dense font-medium text-ink">{o.d.nome || "Google Ads"}</span>
                    <span className="font-mono text-label text-t2">{o.d.conta}</span>
                  </span>
                  <span className="truncate text-label text-t2">{o.loja}</span>
                </button>
              ))}
              <span className="text-label text-t2">Usa o mesmo ID e os mesmos rótulos. Nada muda na outra loja.</span>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="secondary" onClick={onFechar} disabled={salvando}>
            Cancelar
          </Button>
          <Button pending={salvando} onClick={() => void salvar()} className="min-w-33">
            {salvando ? "Adicionando…" : "Adicionar pixel"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
