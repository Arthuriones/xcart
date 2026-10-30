"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { FlaskConical, Pencil, Plus, RefreshCw, Trash2, Zap } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Section } from "@/components/ui/section";
import { Switch } from "@/components/ui/switch";
import type { OpcaoEscopo, RegraEntrada, RegraTela, RespostaRegras, SimulacaoTela } from "@/lib/ads/regras-tipos";
import {
  ROTULO_NIVEL,
  chaveEscopo,
  formDaRegra,
  formEmBranco,
  formExemplo,
  relativo,
  resumoDaPassada,
  rotuloIntervalo,
  type FormRegra,
} from "./apresentar";
import { DESCRICAO_REGRAS, EsqueletoRegras, TITULO_REGRAS } from "./esqueleto";
import { FormularioRegra } from "./formulario-regra";
import { Historico } from "./historico";
import { ResultadoDaPassada } from "./resultado-passada";

// ============================================================================
// Regras automaticas + historico de alteracoes (plano-de-acao/03). Tudo pelas
// rotas de /api/ads/regras (contrato em src/lib/ads/regras-tipos.ts): a sessao
// so LE ad_regras; criar, mudar e apagar e pelo service role, que confere que
// a operacao e a conta sao do usuario.
// ============================================================================

type Estado =
  | { tipo: "carregando" }
  | { tipo: "erro"; texto: string }
  | { tipo: "ok"; dados: RespostaRegras };

interface EstadoFormulario {
  aberto: boolean;
  regraId: string | null;
  inicial: FormRegra;
  escopoOriginal: { chave: string; nome: string; moeda: string | null } | null;
  /** Remonta o formulario a cada abertura (o estado dele nasce do `inicial`). */
  vez: number;
}

/** fetch das rotas de regras: devolve o JSON com ok=true ou lanca com a frase do servidor. */
async function chamar<T>(url: string, init?: RequestInit): Promise<T> {
  let r: Response;
  try {
    r = await fetch(url, {
      cache: "no-store",
      ...init,
      headers: init?.body ? { "Content-Type": "application/json" } : undefined,
    });
  } catch {
    throw new Error("Sem conexão com o Panda Track. Tente de novo.");
  }
  const json: unknown = await r.json().catch(() => null);
  const corpo = json && typeof json === "object" ? (json as { ok?: unknown; erro?: unknown }) : null;
  if (!r.ok || !corpo || corpo.ok !== true) {
    const erro = corpo && typeof corpo.erro === "string" && corpo.erro ? corpo.erro : null;
    throw new Error(erro ?? `Não deu para concluir agora (erro ${r.status}). Tente de novo.`);
  }
  return json as T;
}

function mensagem(e: unknown): string {
  return e instanceof Error ? e.message : "Não deu para concluir agora. Tente de novo.";
}

async function lerRegras(): Promise<Estado> {
  try {
    return { tipo: "ok", dados: await chamar<RespostaRegras>("/api/ads/regras") };
  } catch (e) {
    return { tipo: "erro", texto: mensagem(e) };
  }
}

/** O relogio, lido so em handler e no fim da leitura -- nunca no render. */
function instanteAgora(): number {
  return Date.now();
}

export function TelaRegras() {
  const [estado, setEstado] = useState<Estado>({ tipo: "carregando" });
  const [agora, setAgora] = useState(0);
  const [form, setForm] = useState<EstadoFormulario | null>(null);
  const [simulacao, setSimulacao] = useState<{ regra: RegraTela; resultado: SimulacaoTela } | null>(null);
  const [simulando, setSimulando] = useState<string | null>(null);
  const [alternando, setAlternando] = useState<ReadonlySet<string>>(new Set());
  const [atualizando, setAtualizando] = useState(false);

  useEffect(() => {
    let vivo = true;
    void lerRegras().then((e) => {
      if (!vivo) return;
      setEstado(e);
      setAgora(instanteAgora());
    });
    return () => {
      vivo = false;
    };
  }, []);

  async function recarregar() {
    setAtualizando(true);
    const e = await lerRegras();
    // Falha ao ATUALIZAR nao apaga a lista que ja esta na tela.
    if (e.tipo === "erro" && estado.tipo === "ok") toast.error(e.texto);
    else setEstado(e);
    setAgora(instanteAgora());
    setAtualizando(false);
  }

  function mudarRegras(f: (regras: RegraTela[]) => RegraTela[]) {
    setEstado((atual) => (atual.tipo === "ok" ? { tipo: "ok", dados: { ...atual.dados, regras: f(atual.dados.regras) } } : atual));
  }

  const trocar = (r: RegraTela) => mudarRegras((lista) => lista.map((x) => (x.id === r.id ? r : x)));

  function abrirNova(inicial: FormRegra) {
    setForm((f) => ({ aberto: true, regraId: null, inicial, escopoOriginal: null, vez: (f?.vez ?? 0) + 1 }));
  }

  function abrirEdicao(r: RegraTela) {
    setForm((f) => ({
      aberto: true,
      regraId: r.id,
      inicial: formDaRegra(r),
      escopoOriginal: { chave: chaveEscopo(r.escopo), nome: r.escopoNome, moeda: r.moeda },
      vez: (f?.vez ?? 0) + 1,
    }));
  }

  async function salvar(entrada: Omit<RegraEntrada, "ativa">): Promise<string | null> {
    const id = form?.regraId ?? null;
    try {
      const j = await chamar<{ ok: true; regra: RegraTela }>(id ? `/api/ads/regras/${id}` : "/api/ads/regras", {
        method: id ? "PATCH" : "POST",
        body: JSON.stringify(id ? entrada : { ...entrada, ativa: true }),
      });
      if (id) trocar(j.regra);
      else mudarRegras((lista) => [j.regra, ...lista]);
      setAgora(instanteAgora());
      setForm((f) => (f ? { ...f, aberto: false } : f));
      toast.success(id ? "Regra salva" : "Regra criada e ligada");
      return null;
    } catch (e) {
      return mensagem(e);
    }
  }

  async function alternar(r: RegraTela, ativa: boolean) {
    setAlternando((s) => new Set(s).add(r.id));
    // Otimista: o interruptor muda na hora e volta se a rota recusar.
    trocar({ ...r, ativa });
    try {
      const j = await chamar<{ ok: true; regra: RegraTela }>(`/api/ads/regras/${r.id}`, {
        method: "PATCH",
        body: JSON.stringify({ ativa }),
      });
      trocar(j.regra);
      setAgora(instanteAgora());
      toast.success(ativa ? `"${r.nome}" ligada` : `"${r.nome}" desligada`);
    } catch (e) {
      trocar(r);
      toast.error(mensagem(e));
    } finally {
      setAlternando((s) => {
        const n = new Set(s);
        n.delete(r.id);
        return n;
      });
    }
  }

  async function simular(r: RegraTela) {
    setSimulando(r.id);
    try {
      const j = await chamar<{ ok: true; resultado: SimulacaoTela }>(`/api/ads/regras/${r.id}/simular`, { method: "POST" });
      setSimulacao({ regra: r, resultado: j.resultado });
    } catch (e) {
      toast.error(mensagem(e));
    } finally {
      setSimulando(null);
    }
  }

  async function apagar(r: RegraTela) {
    // Lanca na falha: o ConfirmDialog fica aberto e mostra o erro.
    await chamar<{ ok: true }>(`/api/ads/regras/${r.id}`, { method: "DELETE" });
    mudarRegras((lista) => lista.filter((x) => x.id !== r.id));
    toast.success("Regra apagada");
  }

  const dados = estado.tipo === "ok" ? estado.dados : null;
  const escopos: OpcaoEscopo[] = dados?.escopos ?? [];
  const temOndeAgir = escopos.some((e) => e.contasMeta > 0);
  const podeCriar = !!dados?.disponivel && temOndeAgir;

  return (
    <>
      <PageHeader title={TITULO_REGRAS} description={DESCRICAO_REGRAS}>
        {dados ? (
          <>
            <Button variant="ghost" onClick={recarregar} pending={atualizando}>
              {atualizando ? null : <RefreshCw aria-hidden />}
              Atualizar
            </Button>
            {dados.disponivel ? (
              <Button onClick={() => abrirNova(formEmBranco(escopos))} disabled={!podeCriar}>
                <Plus aria-hidden />
                Nova regra
              </Button>
            ) : null}
          </>
        ) : null}
      </PageHeader>

      {estado.tipo === "carregando" ? (
        <EsqueletoRegras />
      ) : estado.tipo === "erro" ? (
        <Callout
          tom="err"
          titulo="Não conseguimos abrir as regras agora"
          acao={
            <Button variant="secondary" size="sm" onClick={recarregar} pending={atualizando}>
              Tentar de novo
            </Button>
          }
        >
          {estado.texto}
        </Callout>
      ) : (
        <div className="flex flex-col gap-6">
          {!estado.dados.disponivel ? (
            <Callout tom="warn" titulo="As regras ficam disponíveis depois da atualização do banco.">
              Até lá, nada é criado nem checado.
            </Callout>
          ) : !temOndeAgir ? (
            <Callout
              tom="info"
              titulo="Nenhuma operação com conta do Meta ligada"
              acao={
                <Link href="/integracoes/meta" className={buttonVariants({ variant: "secondary", size: "sm" })}>
                  Ligar conta do Meta
                </Link>
              }
            >
              A regra age nas contas de anúncio do Meta de uma loja, de um checkout ou de uma conta. Ligue uma conta em
              Integrações para criar regras.
            </Callout>
          ) : null}

          {estado.dados.disponivel ? (
            <Section
              titulo="Suas regras"
              descricao="Cada regra checa sozinha, no intervalo dela, e só mexe no que estiver ativo no Meta."
            >
              {estado.dados.regras.length === 0 ? (
                <EmptyState
                  variante="tracejado"
                  icone={<Zap />}
                  titulo="Nenhuma regra ainda"
                  descricao="Exemplo: pausar anúncio com custo por IC acima de 20 hoje (gasto mínimo 20)."
                  acao={
                    <>
                      <Button onClick={() => abrirNova(formExemplo(escopos))} disabled={!podeCriar}>
                        Usar este exemplo
                      </Button>
                      <Button variant="secondary" onClick={() => abrirNova(formEmBranco(escopos))} disabled={!podeCriar}>
                        Criar do zero
                      </Button>
                    </>
                  }
                />
              ) : (
                <ul className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                  {estado.dados.regras.map((r) => (
                    <CartaoRegra
                      key={r.id}
                      regra={r}
                      agora={agora}
                      alternando={alternando.has(r.id)}
                      simulando={simulando === r.id}
                      aoAlternar={(v) => alternar(r, v)}
                      aoEditar={() => abrirEdicao(r)}
                      aoSimular={() => simular(r)}
                      aoApagar={() => apagar(r)}
                    />
                  ))}
                </ul>
              )}
            </Section>
          ) : null}

          <Section
            titulo="Histórico de alterações"
            descricao="O que o Panda Track mudou no Meta, à mão ou por regra. Falhas também ficam aqui."
            espaco="nenhum"
          >
            <Historico historico={estado.dados.historico} />
          </Section>
        </div>
      )}

      {form ? (
        <FormularioRegra
          key={form.vez}
          aberto={form.aberto}
          aoMudarAberto={(v) => setForm((f) => (f ? { ...f, aberto: v } : f))}
          regraId={form.regraId}
          inicial={form.inicial}
          escopoOriginal={form.escopoOriginal}
          escopos={escopos}
          aoSalvar={salvar}
        />
      ) : null}

      <Dialog open={!!simulacao} onOpenChange={(v) => !v && setSimulacao(null)}>
        {simulacao ? (
          <DialogContent size="md">
            <DialogHeader>
              <DialogTitle>Simulação: {simulacao.regra.nome}</DialogTitle>
              <DialogDescription>{simulacao.regra.descricao}</DialogDescription>
            </DialogHeader>
            <Callout tom="info" titulo="Nada foi alterado no Meta">
              É o que a regra faria agora, com os números de agora.{" "}
              {simulacao.regra.ativa
                ? `De verdade, ela age a cada ${rotuloIntervalo(simulacao.regra.intervaloMinutos)}.`
                : "Ela está desligada: só age depois de ligada."}
            </Callout>
            <p className="text-label text-t2">{resumoDaPassada(simulacao.resultado)}</p>
            <ResultadoDaPassada
              resultado={simulacao.resultado}
              metrica={simulacao.regra.metrica}
              moeda={simulacao.regra.moeda}
              simulacao
            />
            <DialogFooter showCloseButton />
          </DialogContent>
        ) : null}
      </Dialog>
    </>
  );
}

function CartaoRegra({
  regra: r,
  agora,
  alternando,
  simulando,
  aoAlternar,
  aoEditar,
  aoSimular,
  aoApagar,
}: {
  regra: RegraTela;
  agora: number;
  alternando: boolean;
  simulando: boolean;
  aoAlternar: (ativa: boolean) => void;
  aoEditar: () => void;
  aoSimular: () => void;
  aoApagar: () => Promise<void>;
}) {
  const ultimo = r.ultimoResultado;
  const proximaVencida = Date.parse(r.proximaExecucaoEm) <= agora;
  const proxima = proximaVencida ? "em instantes" : relativo(r.proximaExecucaoEm, agora);
  const temDetalhe =
    !!ultimo && (ultimo.acoes.length > 0 || ultimo.ignorados.length > 0 || ultimo.avisos.length > 0 || ultimo.cortados > 0);

  return (
    <li className="flex min-w-0 flex-col gap-3 rounded-card border border-border bg-surface p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-0.5">
          <div className="flex min-w-0 items-center gap-2">
            <h3 className="truncate text-section text-ink" title={r.nome}>
              {r.nome}
            </h3>
            {!r.ativa ? <Badge variant="neutral">Desligada</Badge> : null}
          </div>
          <p className="text-label text-t2">
            {r.escopoNome} · {ROTULO_NIVEL[r.nivel]} · a cada {rotuloIntervalo(r.intervaloMinutos)}
            {r.filtroNome ? ` · nome com "${r.filtroNome}"` : ""}
          </p>
        </div>
        <Switch
          checked={r.ativa}
          disabled={alternando}
          onCheckedChange={(v) => aoAlternar(v)}
          aria-label={`Regra ${r.nome} ligada`}
        />
      </div>

      <p className="text-dense text-t1 text-pretty">{r.descricao}</p>

      <div className="flex flex-col gap-1 text-label text-t2">
        {r.ultimaExecucaoEm ? (
          <p>
            Última checagem {relativo(r.ultimaExecucaoEm, agora)}
            {ultimo ? `: ${resumoDaPassada(ultimo)}` : ""}
            {r.ativa ? ` · próxima ${proxima}` : ""}
          </p>
        ) : (
          <p>{r.ativa ? `Ainda não rodou · primeira checagem ${proxima}` : "Ainda não rodou"}</p>
        )}
        {ultimo && ultimo.avisos.length > 0 ? (
          <p className="font-medium text-warn">
            {ultimo.avisos[0]}
            {ultimo.avisos.length > 1 ? ` (+${ultimo.avisos.length - 1})` : ""}
          </p>
        ) : null}
        {temDetalhe && ultimo ? (
          <details>
            <summary className="w-fit cursor-pointer text-brand hover:underline">Ver o que a última checagem fez</summary>
            <div className="mt-2 rounded-control border border-border-subtle bg-surface-2 px-3 py-1">
              <ResultadoDaPassada resultado={ultimo} metrica={r.metrica} moeda={r.moeda} simulacao={false} />
            </div>
          </details>
        ) : null}
      </div>

      <div className="mt-auto flex flex-wrap gap-2">
        <Button variant="secondary" size="sm" onClick={aoEditar}>
          <Pencil aria-hidden />
          Editar
        </Button>
        <Button variant="secondary" size="sm" onClick={aoSimular} pending={simulando}>
          {simulando ? null : <FlaskConical aria-hidden />}
          Simular agora
        </Button>
        <ConfirmDialog
          titulo={`Apagar a regra "${r.nome}"?`}
          descricao="Ela para de checar na hora. O que ela já mudou no Meta continua como está, e o histórico fica."
          confirmar="Apagar regra"
          mensagemErro="Não deu para apagar a regra agora. Tente de novo."
          onConfirmar={aoApagar}
          gatilho={
            <Button variant="destructive" size="sm">
              <Trash2 aria-hidden />
              Apagar
            </Button>
          }
        />
      </div>
    </li>
  );
}
