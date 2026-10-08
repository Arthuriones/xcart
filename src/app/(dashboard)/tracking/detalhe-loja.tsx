"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { ChevronRight, Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Switch } from "@/components/ui/switch";
import { gravarCookie } from "@/components/layout/contexto";
import { COOKIE_LOJA, formatarDinheiro } from "@/lib/financeiro/tipos";
import type { DestinoNaTela } from "@/lib/tracking/queries";
import type { DiagnosticoLoja } from "@/lib/tracking/diagnostico";
import { ativarPixel, instalarScript, lerCabecalho, removerPixel, type CabecalhoLoja } from "./acoes";
import { CodigoDoPixel } from "./codigo-pixel";
import { PaginaExterna } from "./pagina-externa";
import { FormularioDestino } from "./destinos-ui";
import { CaixaLogo, Logo } from "./logos";
import { PLATAFORMAS, formatarInteiro, type LinhaLoja } from "./resumo";
import { NOME_DA_PLATAFORMA, type Plataforma } from "./saude";
import {
  avisosDaLoja,
  comprasDoPixel,
  estadoDoPixel,
  instalacaoDaLoja,
  type ItemInstalacao,
  type Tom,
} from "./vista";

// ============================================================================
// Detalhe de uma loja: faturamento, pedidos e ticket; a loja Shopify (campos
// e o interruptor); um bloco por plataforma com os pixels; e o pixel do
// checkout. O motivo de cada problema aparece no pixel ou no campo afetado.
//
// As chamadas de pixel, envio e script sao as mesmas de antes.
// ============================================================================

const PONTO: Record<Tom, string> = { ok: "bg-ok", warn: "bg-warn", err: "bg-err", neutral: "bg-t4" };
const TEXTO: Record<Tom, string> = { ok: "text-t1", neutral: "text-t1", warn: "text-warn", err: "text-err" };

export interface DetalheLojaProps {
  linha: LinhaLoja;
  diag: DiagnosticoLoja | null;
  /** A conferencia desta loja na Shopify falhou nesta carga. */
  falhou: boolean;
  rechecando: boolean;
  ligado: boolean;
  voltar: () => void;
  aoMudar: () => void;
  rechecar: () => void;
  ajustarDiag: (patch: Partial<DiagnosticoLoja>) => void;
  alternarEnvio: (ligar: boolean) => void;
  adicionarPixel: (p: Plataforma) => void;
}

/** Bloco do v3: fundo cinza, cabecalho e o conteudo num cartao branco. */
function Bloco({ cabeca, children }: { cabeca: ReactNode; children?: ReactNode }) {
  return (
    <section className="rounded-overlay bg-surface-2 p-1">
      <div className="flex items-center gap-3 py-2.5 pr-3 pl-2.5">{cabeca}</div>
      {children && <div className="rounded-card border border-border bg-surface">{children}</div>}
    </section>
  );
}

function Campo({
  rotulo,
  valor,
  tom = "ok",
  acao,
  nota,
}: {
  rotulo: string;
  valor: string;
  tom?: Tom;
  acao?: ReactNode;
  nota?: string;
}) {
  return (
    <div className="flex flex-col gap-2 border-b border-border-subtle px-4 py-3.5 last:border-b-0">
      <span className="text-dense font-medium text-ink">{rotulo}</span>
      <div className="flex min-h-ctl-md items-center gap-2 rounded-control bg-surface-2 px-3 text-dense">
        <span className={cn("min-w-0 flex-1 [overflow-wrap:anywhere]", TEXTO[tom])}>{valor}</span>
        {acao}
      </div>
      {nota && <span className="text-label text-t2">{nota}</span>}
    </div>
  );
}

const linkAcao =
  "shrink-0 rounded-sm text-label font-medium text-brand hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus disabled:text-t3";

export function DetalheLoja({
  linha,
  diag,
  falhou,
  rechecando,
  ligado,
  voltar,
  aoMudar,
  rechecar,
  ajustarDiag,
  alternarEnvio,
  adicionarPixel,
}: DetalheLojaProps) {
  const { loja } = linha;
  const id = loja.storeId;
  const inst = instalacaoDaLoja(loja, diag, falhou);
  const avisos = avisosDaLoja(loja, inst, ligado);
  const titulo = useRef<HTMLHeadingElement>(null);

  const [cab, setCab] = useState<CabecalhoLoja | null | "erro">(null);
  const [editando, setEditando] = useState<DestinoNaTela | null>(null);
  const [removendo, setRemovendo] = useState<DestinoNaTela | null>(null);
  const [instalando, setInstalando] = useState(false);
  const [plats, setPlats] = useState<Partial<Record<Plataforma, boolean>>>({});

  useEffect(() => {
    titulo.current?.focus({ preventScroll: true });
    let vivo = true;
    lerCabecalho(id)
      .then((c) => vivo && setCab(c))
      .catch(() => vivo && setCab("erro"));
    return () => {
      vivo = false;
    };
  }, [id]);

  const temGoogle = loja.destinos.some((d) => d.plataforma === "google" && d.ativo);

  async function gravarScript() {
    setInstalando(true);
    try {
      // Reinstalar sem pedir o remarketing tiraria a marca de quem ja tem. O
      // hit sai de qualquer jeito pelas contas do google-config.
      const manter = diag?.temRemarketing === true && temGoogle;
      await instalarScript(id, manter);
      toast.success("Script gravado no tema");
      ajustarDiag({ temSnippet: true, snippetComId: true, ...(manter ? { temRemarketing: true } : {}) });
    } catch (e) {
      const detalhe = (e as { detalhe?: unknown } | null)?.detalhe;
      toast.error(e instanceof Error ? e.message : "Não deu para gravar no tema.", {
        description: typeof detalhe === "string" ? detalhe : undefined,
      });
    } finally {
      setInstalando(false);
    }
  }

  async function alternarPlataforma(p: Plataforma, ligar: boolean) {
    const pixels = loja.destinos.filter((d) => d.plataforma === p);
    if (ligar && pixels.length === 0) {
      adicionarPixel(p);
      return;
    }
    setPlats((s) => ({ ...s, [p]: ligar }));
    try {
      await Promise.all(pixels.filter((d) => d.ativo !== ligar).map((d) => ativarPixel(d.id, ligar)));
      toast.success(`${NOME_DA_PLATAFORMA[p]} ${ligar ? "ligado" : "desligado"} nesta loja`);
      aoMudar();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não deu para salvar.");
      setPlats((s) => ({ ...s, [p]: undefined }));
    }
  }

  function verNoLucro() {
    // A loja vai para a barra do topo: o Lucro abre filtrado nela.
    gravarCookie(COOKIE_LOJA, id);
    window.location.assign("/financeiro");
  }

  function acaoDoCampo(item: ItemInstalacao) {
    if (item.id === "aviso" && item.tom === "err") {
      return (
        <Link href="/stores" className={linkAcao}>
          Abrir Lojas
        </Link>
      );
    }
    // Remarketing nao tem botao: o script do tema ja o faz para cada conta Google.
    if (item.id === "script" && !loja.desinstalada) {
      return (
        <button
          type="button"
          className={linkAcao}
          disabled={instalando}
          aria-busy={instalando || undefined}
          onClick={() => void gravarScript()}
        >
          {instalando
            ? "Gravando…"
            : item.tom === "ok"
              ? "Reinstalar"
              : item.valor === "Versão antiga"
                ? "Atualizar"
                : "Instalar"}
        </button>
      );
    }
    return null;
  }

  const fin = cab && cab !== "erro" ? cab.financeiro : null;
  const kpis = [
    { rotulo: "Faturamento", valor: fin ? formatarDinheiro(fin.receita, fin.moeda, fin.receita >= 1000 ? 0 : 2) : null },
    { rotulo: "Pedidos", valor: fin ? formatarInteiro(fin.pedidos) : null },
    {
      rotulo: "Ticket médio",
      valor: fin && fin.ticket !== null ? formatarDinheiro(fin.ticket, fin.moeda) : fin ? "—" : null,
    },
  ];
  const lojaCab = cab && cab !== "erro" ? cab.loja : null;
  const pixelCheckout = inst.itens.pixel!;

  return (
    <div className="mx-auto flex w-full max-w-205 flex-col gap-5">
      <nav aria-label="Caminho" className="flex min-w-0 items-center gap-2 text-dense">
        <button
          type="button"
          onClick={voltar}
          className="shrink-0 rounded-sm text-t2 hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
        >
          Rastreamento
        </button>
        <ChevronRight aria-hidden className="size-3 shrink-0 text-t3" />
        <h1
          ref={titulo}
          tabIndex={-1}
          className="truncate text-dense font-normal text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
        >
          {loja.nome}
        </h1>
      </nav>

      <div className="grid overflow-hidden rounded-card border border-border md:grid-cols-3">
        {kpis.map((k) => (
          <div
            key={k.rotulo}
            className="-mr-px -mb-px flex flex-col gap-2 border-r border-b border-border px-4.5 py-4"
          >
            <span className="flex justify-between text-dense text-t1">
              {k.rotulo}
              <button
                type="button"
                onClick={verNoLucro}
                aria-label={`Ver ${k.rotulo.toLowerCase()} no Lucro`}
                className={linkAcao}
              >
                Ver
              </button>
            </span>
            <span className="num text-kpi font-medium text-ink">
              {k.valor ?? (cab === null ? <span className="text-t3">…</span> : "—")}
            </span>
          </div>
        ))}
      </div>

      {avisos.map((a) => (
        <div
          key={a.texto}
          role={a.tom === "err" ? "alert" : "status"}
          className={cn(
            "flex flex-wrap items-center gap-3 rounded-card border px-4 py-3",
            a.tom === "err" ? "border-err-border bg-err-bg" : "border-warn-border bg-warn-bg"
          )}
        >
          <span className="min-w-50 flex-1 text-dense text-ink">{a.texto}</span>
          {a.acao === "lojas" && (
            <Link href="/stores" className={buttonVariants({ variant: "secondary", size: "sm" })}>
              Abrir Lojas
            </Link>
          )}
          {a.acao === "recarregar" && (
            <Button size="sm" variant="secondary" onClick={aoMudar}>
              Tentar de novo
            </Button>
          )}
          {a.acao === "ligar" && (
            <Button size="sm" variant="secondary" onClick={() => alternarEnvio(true)}>
              Ligar
            </Button>
          )}
          {a.acao === "adicionar" && (
            <Button size="sm" variant="secondary" onClick={() => adicionarPixel("meta")}>
              Adicionar pixel
            </Button>
          )}
          {a.acao === "conferir" && (
            <Button size="sm" variant="secondary" pending={rechecando} onClick={rechecar}>
              Tentar de novo
            </Button>
          )}
        </div>
      ))}

      <Bloco
        cabeca={
          <>
            <Logo marca="shopify" tamanho={22} />
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="text-dense font-semibold text-ink">Loja Shopify</span>
              {lojaCab && (
                <span className="text-label text-t2">
                  Conectada em {new Date(lojaCab.criadaEm).toLocaleDateString("pt-BR")}
                </span>
              )}
            </span>
            <Switch aria-label="Rastreamento desta loja" checked={ligado} onCheckedChange={alternarEnvio} />
          </>
        }
      >
        <Campo rotulo="Domínio permanente" valor={loja.dominio} />
        {lojaCab?.moeda && (
          <Campo
            rotulo="Moeda e fuso"
            valor={[lojaCab.moeda, lojaCab.fuso].filter(Boolean).join(" · ")}
          />
        )}
        {(["script", "aviso", "remarketing"] as const).map((k) => {
          const item = inst.itens[k];
          if (!item) return null;
          return (
            <Campo
              key={k}
              rotulo={
                k === "script" ? "Script no tema" : k === "aviso" ? "Aviso de pedidos da Shopify" : "Remarketing do Google"
              }
              valor={item.valor}
              tom={item.tom}
              acao={acaoDoCampo(item)}
            />
          );
        })}
      </Bloco>

      {PLATAFORMAS.map((p) => {
        const pixels = loja.destinos.filter((d) => d.plataforma === p);
        const ligadaNaTela = plats[p] ?? pixels.some((d) => d.ativo);
        return (
          <Bloco
            key={p}
            cabeca={
              <>
                <CaixaLogo marca={p} />
                <span className="flex-1 text-dense font-semibold text-ink">{NOME_DA_PLATAFORMA[p]}</span>
                <Switch
                  aria-label={`${NOME_DA_PLATAFORMA[p]} nesta loja`}
                  checked={ligadaNaTela}
                  onCheckedChange={(v) => void alternarPlataforma(p, v)}
                />
              </>
            }
          >
            {ligadaNaTela && (
              <>
                <ul>
                  {pixels.map((d) => {
                    const e = estadoDoPixel(d, loja, diag);
                    const compras = comprasDoPixel(d, loja, diag);
                    const nome = d.nome || NOME_DA_PLATAFORMA[p];
                    return (
                      <li
                        key={d.id}
                        className="flex flex-wrap items-center gap-2.5 border-b border-border-subtle py-3 pr-3 pl-4"
                      >
                        <span aria-hidden className={cn("size-2 shrink-0 rounded-full", PONTO[e.tom])} />
                        <span className="flex min-w-0 flex-1 basis-40 flex-wrap items-baseline gap-x-2.5 gap-y-0.5">
                          <span className="text-dense font-medium text-ink">{nome}</span>
                          <span className="font-mono text-label text-t2">{d.conta}</span>
                          {e.nota && <span className={cn("text-label", TEXTO[e.tom])}>{e.nota}</span>}
                          {e.erro && (
                            <span className="w-full line-clamp-2 text-label text-t2 [overflow-wrap:anywhere]">
                              “{e.erro}”
                            </span>
                          )}
                        </span>
                        {compras && <span className="num text-label text-t2">{compras}</span>}
                        <Button
                          variant="secondary"
                          size="icon-sm"
                          aria-label={`Editar ${nome}`}
                          onClick={() => setEditando(d)}
                        >
                          <Pencil aria-hidden />
                        </Button>
                        <Button
                          variant="secondary"
                          size="icon-sm"
                          aria-label={`Remover ${nome}`}
                          className="text-err"
                          onClick={() => setRemovendo(d)}
                        >
                          <Trash2 aria-hidden />
                        </Button>
                      </li>
                    );
                  })}
                </ul>
                <div className="flex justify-center p-3">
                  <Button variant="secondary" size="sm" onClick={() => adicionarPixel(p)}>
                    + Adicionar pixel
                  </Button>
                </div>
              </>
            )}
          </Bloco>
        );
      })}

      <Bloco
        cabeca={
          <>
            <CaixaLogo marca="shopify" />
            <span className="flex-1 text-dense font-semibold text-ink">Pixel do checkout</span>
            <span className="inline-flex items-center gap-1.5 text-label text-t2">
              <span aria-hidden className={cn("size-1.75 rounded-full", PONTO[pixelCheckout.tom])} />
              {pixelCheckout.valor}
            </span>
          </>
        }
      >
        <div className="flex flex-col gap-2.5 px-4 py-3.5">
          <p className="text-label text-t1">
            {loja.pixelCheckoutDesatualizado
              ? "Na Shopify: Configurações › Eventos do cliente › pixel “xcart” › troque o código pelo de baixo › Salvar."
              : "Na Shopify: Configurações › Eventos do cliente › Adicionar pixel personalizado › nome “xcart” › cole o código abaixo › Salvar › Conectar."}
          </p>
          <CodigoDoPixel storeId={id} />
        </div>
      </Bloco>

      <Bloco
        cabeca={
          <>
            <CaixaLogo marca="shopify" />
            <span className="flex-1 text-dense font-semibold text-ink">Página externa (VSL)</span>
          </>
        }
      >
        <PaginaExterna storeId={id} />
      </Bloco>

      <ConfirmDialog
        open={removendo !== null}
        onOpenChange={(v) => !v && setRemovendo(null)}
        titulo={`Remover ${removendo?.nome || "este pixel"}?`}
        descricao="As compras desta loja param de chegar a este pixel, e o histórico de envios dele é apagado. Para só pausar, desligue a plataforma."
        confirmar="Remover"
        mensagemErro="Não deu para remover agora. Tente de novo."
        onConfirmar={async () => {
          if (!removendo) return;
          await removerPixel(removendo.id);
          toast.success("Pixel removido");
          aoMudar();
        }}
      />

      {editando && (
        <FormularioDestino
          key={editando.id}
          storeId={id}
          plataforma={editando.plataforma}
          destino={editando}
          aberto
          onFechar={() => setEditando(null)}
          aoSalvar={aoMudar}
        />
      )}
    </div>
  );
}
