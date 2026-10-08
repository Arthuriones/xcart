"use client";

import { useId, useState, useTransition } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { MoreHorizontalIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { Caixa } from "@/components/ui/checkbox";
import { cn } from "@/components/ui/cn";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Section } from "@/components/ui/section";
import { Segmented } from "@/components/ui/segmented";
import { StatusBadge } from "@/components/ui/status-badge";
import { BotaoConectar } from "@/app/(dashboard)/stores/conectar-loja";
import type { GraphTarget } from "@/lib/checkout-routes/graph";
import { mercadoDoPais, type CheckoutDoDestino } from "@/lib/checkout-routes/mercado";
import { Instalador } from "./instalar";
import {
  ESTRATEGIAS,
  conferirDivisao,
  dividirIgual,
  estadoDaLoja,
  limiteValido,
  limitesIniciais,
  mudancasDaDivisao,
  mudancasDaLista,
  rascunhoInicial,
  temaFicouParaTras,
  textoDoLimite,
  type Estrategia,
} from "./logica";

// Os dialogos so existem depois de um clique: fora do download da aba.
const SwapImagesDialog = dynamic(
  () => import("@/components/routed-checkout/swap-images-dialog").then((m) => m.SwapImagesDialog),
  { ssr: false }
);
const CheckoutSettingsDialog = dynamic(
  () => import("@/components/routed-checkout/checkout-settings-dialog").then((m) => m.CheckoutSettingsDialog),
  { ssr: false }
);

/** O ajuste de checkout na linha da loja; o padrao nao aparece. */
function textoDoCheckout(c: CheckoutDoDestino): string {
  if (c.modo === "comprador") return " · checkout no país do comprador";
  if (c.modo === "fixo" && c.pais) {
    const m = mercadoDoPais(c.pais);
    return ` · checkout em ${m ? `${m.nome} (${m.moeda})` : c.pais}`;
  }
  return "";
}

export interface LojaNaRota {
  id: string;
  storeId: string;
  nome: string;
  dominio: string;
  enabled: boolean;
  weight: number;
  sharePercent: number;
  mappedSkuCount: number;
  /** Teto de pedidos nas ultimas 24 h; null = sem teto. */
  dailyLimit: number | null;
  /** Pedidos reais da loja nas ultimas 24 h. */
  orders24h: number;
  /** Rota antiga sem linha de destino: nao da para pausar, tirar nem pesar. */
  legacy: boolean;
  /** Ultimo conserto nesta loja: o selo mostra "Pausada pela Shopify" etc. */
  conserto?: GraphTarget["conserto"];
  /** Pais/moeda e dominio do checkout desta loja (settings do destino). */
  checkout: CheckoutDoDestino;
  /** Idioma da loja de checkout: de onde sai o pais no modo padrao. */
  idiomaDaLoja: string | null;
}

type Props = {
  rotaId: string;
  rotaLigada: boolean;
  vitrineId: string;
  estrategia: Estrategia;
  lojas: LojaNaRota[];
  disponiveis: { id: string; nome: string; dominio: string }[];
  token: string;
  origem: string;
};

type Tema = { estado?: string } | undefined;

/** Devolve como foi o reenvio automatico ao tema da vitrine. */
async function patchAlvos(rotaId: string, corpo: object): Promise<Tema> {
  const r = await fetch(`/api/checkout-routes/${rotaId}/targets`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(corpo),
  });
  if (!r.ok) throw new Error("patch");
  const d = (await r.json().catch(() => ({}))) as { tema?: Tema };
  return d.tema;
}

/**
 * Aba Lojas e divisao: cada loja de checkout com estado, fatia, pausar e
 * tirar; a divisao editada num rascunho e gravada de uma vez em "Salvar
 * divisao" (antes cada tecla gravava: digitar 45 gravava 4 e redistribuia as
 * outras); e adicionar lojas.
 *
 * Mudou a divisao, pausou ou entrou loja: o servidor reenvia a configuracao
 * ao tema da vitrine sozinho. O aviso com o botao so aparece quando esse
 * reenvio nao chegou (ver temaFicouParaTras).
 */
export function AbaLojas(props: Props) {
  const [reenviar, setReenviar] = useState(false);
  // Cada reenvio leva o config inteiro: o ultimo que chegou deixa o tema em
  // dia, mesmo depois de um que falhou.
  const aoMudar = (tema: Tema) => setReenviar(temaFicouParaTras(tema));
  // O editor remonta quando o servidor devolve outra divisao (depois de
  // salvar, pausar, tirar): o rascunho nasce do dado novo, sem efeito.
  const chave = `${props.estrategia}|${props.lojas.map((l) => `${l.id}:${l.enabled}:${l.sharePercent}:${l.dailyLimit ?? ""}`).join(",")}`;

  return (
    <div className="flex flex-col gap-4">
      <EditorLojas key={chave} {...props} aoMudar={aoMudar} />

      {reenviar ? (
        <Callout tom="warn" titulo="Falta reenviar ao tema da vitrine">
          <p>
            A mudança está salva, mas o xcart não conseguiu levar a configuração ao tema da vitrine sozinho. O
            comprador só vê a mudança depois que ela chega ao tema.
          </p>
          <div className="mt-2">
            <Instalador
              rotaId={props.rotaId}
              token={props.token}
              origem={props.origem}
              comCodigo={false}
              rotulo="Reenviar ao tema"
            />
          </div>
        </Callout>
      ) : null}

      <AdicionarLojas
        rotaId={props.rotaId}
        vitrineId={props.vitrineId}
        disponiveis={props.disponiveis}
        aoMudar={aoMudar}
      />
    </div>
  );
}

function EditorLojas({
  rotaId,
  rotaLigada,
  estrategia: estrategiaSalva,
  lojas,
  aoMudar,
}: Props & { aoMudar: (tema: Tema) => void }) {
  const router = useRouter();
  const [atualizando, startTransition] = useTransition();
  const [rascunho, setRascunho] = useState(() => rascunhoInicial(lojas.filter((l) => !l.legacy)));
  const [limites, setLimites] = useState(() => limitesIniciais(lojas));
  const [estrategia, setEstrategia] = useState<Estrategia>(estrategiaSalva);
  const [salvando, setSalvando] = useState(false);
  const [erroSalvar, setErroSalvar] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [tirar, setTirar] = useState<LojaNaRota | null>(null);
  const [imagens, setImagens] = useState<LojaNaRota | null>(null);
  const [ajuste, setAjuste] = useState<LojaNaRota | null>(null);
  const idSoma = useId();

  const ligadas = lojas.filter((l) => l.enabled && !l.legacy);
  const editavel = ligadas.length > 1;
  const conferencia = conferirDivisao(rascunho);
  const mudouPercentual = lojas.some((l) => l.id in rascunho && rascunho[l.id] !== String(l.sharePercent));
  const mudouEstrategia = estrategia !== estrategiaSalva;
  const mudouLimite = lojas.some((l) => !l.legacy && (limites[l.id] ?? "") !== textoDoLimite(l.dailyLimit));
  const limitesOk = Object.values(limites).every(limiteValido);
  const sujo = mudouPercentual || mudouEstrategia || mudouLimite;
  // So a estrategia mudou: salva mesmo com a soma de hoje arredondada (33+33+33).
  const podeSalvar = sujo && (!mudouPercentual || conferencia.ok) && limitesOk;
  const erroSoma = mudouPercentual && !conferencia.ok;
  const estrategiaAtual = ESTRATEGIAS.find((e) => e.valor === estrategia) ?? ESTRATEGIAS[0];

  function atualizar() {
    startTransition(() => router.refresh());
  }

  async function salvar() {
    if (!podeSalvar) return;
    const mudancas = mudancasDaLista(lojas, mudouPercentual ? mudancasDaDivisao(lojas, rascunho) : [], limites);
    setSalvando(true);
    setErroSalvar(null);
    try {
      const tema = await patchAlvos(rotaId, {
        ...(mudouEstrategia ? { rotation: { strategy: estrategia } } : {}),
        ...(mudancas.length > 0 ? { targets: mudancas } : {}),
      });
      toast.success("Divisão salva.");
      aoMudar(tema);
      atualizar();
    } catch {
      setErroSalvar("Não deu para salvar a divisão. Nada mudou; tente de novo.");
    } finally {
      setSalvando(false);
    }
  }

  async function alternarLoja(l: LojaNaRota) {
    setOcupado(l.id);
    try {
      const tema = await patchAlvos(rotaId, { targets: [{ id: l.id, weight: l.weight, enabled: !l.enabled }] });
      toast.success(l.enabled ? `${l.nome} pausada na rota.` : `${l.nome} voltou para a rota.`);
      aoMudar(tema);
      atualizar();
    } catch {
      toast.error(`Não deu para ${l.enabled ? "pausar" : "retomar"} ${l.nome}. Nada mudou; tente de novo.`);
    } finally {
      setOcupado(null);
    }
  }

  async function confirmarTirar() {
    if (!tirar) return;
    const r = await fetch(`/api/checkout-routes/${rotaId}/targets?targetId=${tirar.id}`, { method: "DELETE" });
    if (!r.ok) throw new Error("delete");
    const d = (await r.json().catch(() => ({}))) as { tema?: Tema };
    toast.success(`${tirar.nome} saiu da rota.`);
    aoMudar(d.tema);
    atualizar();
  }

  return (
    <Section
      titulo="Lojas de checkout"
      descricao={
        editavel
          ? "Quanto vai para cada loja (a soma fecha 100%) e, se quiser, o teto de pedidos por dia: bateu, o resto vai para as outras. Serve para aquecer conta nova."
          : "As lojas que cobram o comprador desta rota."
      }
      acoes={
        editavel ? (
          <Button
            variant="link"
            size="sm"
            onClick={() => {
              const partes = dividirIgual(ligadas.map((l) => l.id));
              setRascunho((r) => {
                const proximo = { ...r };
                for (const [id, v] of Object.entries(partes)) proximo[id] = String(v);
                return proximo;
              });
            }}
          >
            Dividir igual
          </Button>
        ) : null
      }
    >
      {!rotaLigada ? (
        <p className="text-dense text-t2">A rota está pausada: nenhuma loja recebe comprador até você ligar de novo.</p>
      ) : null}

      <ul className="flex flex-col divide-y divide-border-subtle">
        {lojas.map((l) => {
          const selo = estadoDaLoja(rotaLigada, l);
          const campo = editavel && l.enabled && !l.legacy;
          const valor = rascunho[l.id] ?? "";
          const invalido = mudouPercentual && conferencia.invalidos.includes(l.id);
          const fatia = rotaLigada ? l.sharePercent : 0;
          return (
            <li key={l.id} className="flex flex-col gap-2 py-3 first:pt-0 last:pb-0">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                <div className="flex min-w-0 flex-1 basis-48 flex-col">
                  <span className="truncate text-dense font-medium text-ink">{l.nome}</span>
                  <span className="truncate text-label text-t2">
                    <span className="font-mono">{l.dominio || "—"}</span> ·{" "}
                    {l.mappedSkuCount === 1 ? "1 SKU ligado" : `${l.mappedSkuCount.toLocaleString("pt-BR")} SKUs ligados`}
                    {l.dailyLimit != null ? ` · ${l.orders24h}/${l.dailyLimit} pedidos hoje` : ""}
                    {textoDoCheckout(l.checkout)}
                  </span>
                </div>
                <StatusBadge tom={selo.tom} texto={selo.texto} />
                {campo ? (
                  <span className="flex items-center gap-1">
                    <Input
                      inputMode="numeric"
                      value={valor}
                      onChange={(e) => setRascunho((r) => ({ ...r, [l.id]: e.target.value }))}
                      aria-label={`Porcentagem do tráfego para ${l.nome}`}
                      aria-invalid={invalido || undefined}
                      aria-describedby={idSoma}
                      className="num h-ctl-sm w-16 text-right text-dense"
                    />
                    <span aria-hidden className="text-dense text-t2">
                      %
                    </span>
                  </span>
                ) : (
                  <span className="num w-12 text-right text-dense font-semibold text-ink">{fatia}%</span>
                )}
                {campo ? (
                  <span className="flex items-center gap-1">
                    <Input
                      inputMode="numeric"
                      value={limites[l.id] ?? ""}
                      onChange={(e) => setLimites((r) => ({ ...r, [l.id]: e.target.value }))}
                      aria-label={`Teto de pedidos por dia para ${l.nome}`}
                      aria-invalid={!limiteValido(limites[l.id] ?? "") || undefined}
                      placeholder="sem"
                      className="num h-ctl-sm w-16 text-right text-dense"
                    />
                    <span aria-hidden className="text-dense text-t2">
                      /dia
                    </span>
                  </span>
                ) : null}
                <div className="flex items-center gap-1">
                  {!l.legacy ? (
                    <Button
                      variant="secondary"
                      size="sm"
                      pending={ocupado === l.id}
                      disabled={Boolean(ocupado) && ocupado !== l.id}
                      onClick={() => alternarLoja(l)}
                    >
                      {l.enabled ? "Pausar" : "Retomar"}
                      <span className="sr-only"> {l.nome}</span>
                    </Button>
                  ) : null}
                  <DropdownMenu>
                    <DropdownMenuTrigger
                      render={<Button size="icon-sm" variant="ghost" aria-label={`Mais ações de ${l.nome}`} />}
                    >
                      <MoreHorizontalIcon aria-hidden />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-56">
                      <DropdownMenuItem disabled={l.legacy} onClick={() => setAjuste(l)}>
                        País e moeda do checkout…
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => setImagens(l)}>Refazer imagens sem marca…</DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        variant="destructive"
                        disabled={l.legacy || lojas.length <= 1}
                        onClick={() => setTirar(l)}
                      >
                        {lojas.length <= 1 ? "Tirar da rota (é a única loja)" : "Tirar da rota…"}
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </div>
              <div role="img" aria-label={`${fatia}% do tráfego hoje`} className="h-1.5 overflow-hidden rounded-full bg-track">
                <div
                  className={cn("h-full rounded-full", selo.tom === "ok" ? "bg-solid" : "bg-border-strong")}
                  style={{ width: `${fatia}%` }}
                />
              </div>
              {l.legacy ? (
                <p className="text-label text-t2">Loja de uma rota antiga: para mudar, crie a rota de novo pelo assistente.</p>
              ) : null}
            </li>
          );
        })}
      </ul>

      {editavel ? (
        <div className="flex flex-col gap-3 border-t border-border-subtle pt-3">
          <div className="flex flex-col gap-1.5">
            <span className="text-dense font-medium text-ink">Quando o comprador volta</span>
            <Segmented
              rotulo="Quando o comprador volta"
              valor={estrategia}
              onValorChange={setEstrategia}
              tamanho="md"
              opcoes={ESTRATEGIAS.map((e) => ({ valor: e.valor, rotulo: e.rotulo }))}
            />
            <span className="text-label text-t2">{estrategiaAtual.dica}</span>
          </div>

          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <Button pending={salvando} disabled={!podeSalvar || atualizando} onClick={salvar}>
              Salvar divisão
            </Button>
            {sujo ? (
              <Button
                variant="ghost"
                disabled={salvando}
                onClick={() => {
                  setRascunho(rascunhoInicial(lojas.filter((l) => !l.legacy)));
                  setLimites(limitesIniciais(lojas));
                  setEstrategia(estrategiaSalva);
                  setErroSalvar(null);
                }}
              >
                Desfazer
              </Button>
            ) : null}
            <span
              id={idSoma}
              aria-live="polite"
              className={cn("text-dense", erroSoma ? "font-medium text-err" : "text-t2")}
            >
              {erroSoma
                ? conferencia.motivo
                : conferencia.soma === 100 || mudouPercentual
                  ? `Soma: ${conferencia.soma}%`
                  : `Soma: ${conferencia.soma}% (arredondado)`}
            </span>
          </div>
          {erroSalvar ? (
            <p role="alert" className="text-dense font-medium text-err">
              {erroSalvar}
            </p>
          ) : null}
          <p className="text-label text-t2">
            Ao salvar, o xcart reenvia a nova divisão ao tema da vitrine.
          </p>
        </div>
      ) : null}

      <ConfirmDialog
        open={Boolean(tirar)}
        onOpenChange={(v) => !v && setTirar(null)}
        titulo={`Tirar ${tirar?.nome ?? "a loja"} da rota?`}
        descricao="Os compradores deixam de ir para esta loja e o mapa de produtos dela nesta rota some. Os produtos continuam na Shopify; para voltar, adicione a loja de novo e o xcart casa os SKUs outra vez."
        confirmar="Tirar da rota"
        mensagemErro="Não deu para tirar a loja. Ela continua na rota; tente de novo."
        onConfirmar={confirmarTirar}
      />
      {imagens ? (
        <SwapImagesDialog
          open
          onOpenChange={(v) => !v && setImagens(null)}
          storeId={imagens.storeId}
          storeLabel={imagens.nome}
        />
      ) : null}
      {ajuste ? (
        <CheckoutSettingsDialog
          open
          onOpenChange={(v) => !v && setAjuste(null)}
          rotaId={rotaId}
          destino={{
            id: ajuste.id,
            nome: ajuste.nome,
            dominioLoja: ajuste.dominio,
            idiomaDaLoja: ajuste.idiomaDaLoja,
            checkout: ajuste.checkout,
          }}
          onSaved={(tema) => {
            aoMudar(tema);
            atualizar();
          }}
        />
      ) : null}
    </Section>
  );
}

// ---------------------------------------------------------------------------

type Resultado = { nome: string; ok: boolean; entrou: boolean; texto: string };

/**
 * Adicionar lojas de checkout. Uma de cada vez no servidor de proposito: cada
 * loja precisa do catalogo inteiro casado por SKU contra a vitrine, e varias
 * em paralelo estouram o limite de chamadas da Shopify.
 */
function AdicionarLojas({
  rotaId,
  vitrineId,
  disponiveis,
  aoMudar,
}: {
  rotaId: string;
  vitrineId: string;
  disponiveis: { id: string; nome: string; dominio: string }[];
  aoMudar: (tema: Tema) => void;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [marcadas, setMarcadas] = useState<string[]>([]);
  const [progresso, setProgresso] = useState<{ feito: number; total: number; nome: string } | null>(null);
  const [resultados, setResultados] = useState<Resultado[]>([]);

  async function adicionar() {
    if (marcadas.length === 0 || progresso) return;
    const fila = disponiveis.filter((d) => marcadas.includes(d.id));
    const saida: Resultado[] = [];
    // So conta o reenvio ao tema da ultima loja que entrou: cada um leva o
    // config inteiro da rota.
    let ultimoTema: Tema | null = null;
    setResultados([]);
    for (const [i, loja] of fila.entries()) {
      setProgresso({ feito: i, total: fila.length, nome: loja.nome });
      try {
        const r = await fetch("/api/checkout-routes/connect-by-sku", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ routeId: rotaId, sourceStoreId: vitrineId, targetStoreId: loja.id, createRoute: false }),
        });
        const d = (await r.json().catch(() => ({}))) as {
          safeToEnable?: boolean;
          coveragePercent?: number;
          error?: string;
          code?: string;
          tema?: Tema;
        };
        if (r.ok) ultimoTema = d.tema;
        if (!r.ok && d.code === "limite_do_plano") {
          // Limite de lojas do plano: as proximas da fila tambem nao cabem.
          saida.push({ nome: loja.nome, ok: false, entrou: false, texto: `não entrou. ${d.error ?? ""}`.trim() });
          break;
        } else if (!r.ok && (r.status === 409 || r.status === 422) && d.error) {
          // Recusa com motivo: vitrine de outra rota, ou catalogo que nao e
          // copia desta vitrine.
          saida.push({ nome: loja.nome, ok: false, entrou: false, texto: `não entrou: ${d.error}` });
        } else if (!r.ok) {
          saida.push({ nome: loja.nome, ok: false, entrou: false, texto: "não entrou: a Shopify não respondeu ou nenhum SKU casou." });
        } else if (d.safeToEnable === false) {
          saida.push({
            nome: loja.nome,
            ok: false,
            entrou: true,
            texto: `entrou com 0%: só ${d.coveragePercent ?? 0}% dos produtos casaram. Teste e corrija antes de dar tráfego.`,
          });
        } else {
          saida.push({ nome: loja.nome, ok: true, entrou: true, texto: "entrou na rota." });
        }
      } catch {
        saida.push({ nome: loja.nome, ok: false, entrou: false, texto: "não entrou: a conexão caiu." });
      }
    }
    setProgresso(null);
    setMarcadas([]);
    setResultados(saida);
    if (saida.some((s) => s.entrou) && ultimoTema !== null) aoMudar(ultimoTema);
    startTransition(() => router.refresh());
  }

  return (
    <Section
      titulo="Adicionar loja de checkout"
      descricao="O xcart casa o catálogo de cada loja com a vitrine pelo SKU, uma de cada vez."
      acoes={<BotaoConectar variante="secondary">Conectar outra loja</BotaoConectar>}
    >
      {disponiveis.length === 0 ? (
        <p className="text-dense text-t2">
          Todas as suas lojas já estão nesta ou em outra rota. Uma loja de checkout nova precisa ser conectada e
          receber os produtos da vitrine antes de entrar.
        </p>
      ) : (
        <>
          <ul className="flex flex-col gap-1.5" aria-label="Lojas que podem entrar na rota">
            {disponiveis.map((d) => {
              const marcada = marcadas.includes(d.id);
              return (
                <li key={d.id}>
                  <button
                    type="button"
                    role="checkbox"
                    aria-checked={marcada}
                    disabled={Boolean(progresso)}
                    onClick={() =>
                      setMarcadas((m) => (m.includes(d.id) ? m.filter((x) => x !== d.id) : [...m, d.id]))
                    }
                    className={cn(
                      "flex min-h-11 w-full items-center gap-3 rounded-control border px-3 py-2 text-left transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus disabled:cursor-not-allowed",
                      marcada ? "border-ink bg-nav-active" : "border-border hover:bg-hover"
                    )}
                  >
                    <Caixa estado={marcada} />
                    <span className="flex min-w-0 flex-col">
                      <span className="truncate text-dense font-medium text-ink">{d.nome}</span>
                      <span className="truncate font-mono text-label text-t2">{d.dominio}</span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
          <div className="flex flex-wrap items-center gap-3">
            <Button disabled={marcadas.length === 0} pending={Boolean(progresso)} onClick={adicionar}>
              {marcadas.length > 1 ? `Adicionar ${marcadas.length} lojas` : "Adicionar loja"}
            </Button>
            <span aria-live="polite" className="text-dense text-t2">
              {progresso ? `Ligando os produtos de ${progresso.nome} (${progresso.feito + 1} de ${progresso.total})…` : ""}
            </span>
          </div>
        </>
      )}

      {resultados.length > 0 ? (
        <ul className="flex flex-col gap-1 text-dense" aria-label="Resultado">
          {resultados.map((r) => (
            <li key={r.nome} className={r.ok ? "text-ok" : "text-warn"}>
              <span className="font-semibold">{r.nome}</span> {r.texto}
            </li>
          ))}
        </ul>
      ) : null}
    </Section>
  );
}
