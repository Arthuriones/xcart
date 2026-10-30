"use client";

import { useEffect, useId, useState, useTransition, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { arredondar, formatarDinheiro } from "@/lib/financeiro/tipos";
import { MOEDAS_SEM_CENTAVOS } from "@/lib/ads/meta-granular";
import {
  ESTRATEGIAS_COM_LANCE,
  ESTRATEGIA_ROAS_MINIMO,
  type CampoEdicao,
  type NivelEdicao,
  type ObjetoAoVivo,
} from "@/lib/ads/gerenciar-regras";
import type { LinhaCampanha } from "./tipos";

// ============================================================================
// Edicao basica de campanha, conjunto e anuncio do Meta pela aba Campanhas:
// ligar/pausar, orcamento (diario OU total, de quem o tem), lance e ROAS
// minimo, sempre DENTRO da estrategia que ja existe. Quem confere e aplica e
// o servidor (/api/ads/meta/objeto e /api/ads/meta/alterar, gerenciar.ts):
// aqui so se le o estado AO VIVO, se monta o pedido e se traduz a resposta.
// Google e TikTok ficam de fora: so o Meta tem a edicao.
// ============================================================================

/** Mudanca de orcamento acima disso pede confirmacao: o Meta pode reiniciar o aprendizado. */
const LIMITE_APRENDIZADO = 0.2;

/** Os mesmos formatos que as rotas aceitam: id do objeto no Meta e ad_accounts.id. */
const RE_OBJETO = /^[0-9]{5,25}$/;
const RE_CONTA = /^[0-9a-f-]{36}$/i;

/**
 * O nivel da linha, se ela se edita pelo Panda Track. linha.contaId e o
 * ad_accounts.id (montar.ts: `contaId: conta.id`). Linha da conta, do Google
 * ou do TikTok, e id que nao e do Meta (campanha que so veio do pedido) nao.
 */
export function nivelEditavel(linha: LinhaCampanha): NivelEdicao | null {
  if (linha.plataforma !== "meta") return null;
  if (linha.nivel !== "campanha" && linha.nivel !== "grupo" && linha.nivel !== "anuncio") return null;
  if (!RE_OBJETO.test(linha.objetoId) || !RE_CONTA.test(linha.contaId)) return null;
  return linha.nivel;
}

/** effective_status que nao e ACTIVE nem PAUSED -> o motivo de nao rodar, em palavras. */
export function motivoDoStatus(efetivo: string): string | null {
  switch (efetivo.toUpperCase()) {
    case "CAMPAIGN_PAUSED":
      return "A campanha está pausada: ligue a campanha para este item rodar.";
    case "ADSET_PAUSED":
      return "O conjunto está pausado: ligue o conjunto para este anúncio rodar.";
    case "DISAPPROVED":
      return "Reprovado pelo Meta: corrija no Gerenciador de Anúncios.";
    case "PENDING_REVIEW":
    case "IN_PROCESS":
      return "Em análise no Meta: roda quando for aprovado.";
    case "WITH_ISSUES":
      return "Com problema no Meta: confira no Gerenciador de Anúncios.";
    case "PENDING_BILLING_INFO":
      return "Falta a forma de pagamento na conta de anúncio.";
    case "ARCHIVED":
      return "Arquivado no Meta: não dá para ligar pelo Panda Track.";
    case "DELETED":
      return "Excluído no Meta: não dá para ligar pelo Panda Track.";
    default:
      return null;
  }
}

/**
 * A acao que resolve o erro do servidor: permissao de edicao (o perfil foi
 * conectado so com ads_read) ou token recusado levam a Integracoes.
 */
export function linkDoErro(erro: string): ReactNode {
  const permissao = /permiss/i.test(erro);
  if (!permissao && !/integra/i.test(erro)) return null;
  return (
    <Link
      href="/integracoes/meta"
      className="font-medium text-brand underline underline-offset-4 hover:text-ink"
    >
      {permissao ? "Permitir editar" : "Abrir Integrações"}
    </Link>
  );
}

type RespostaApi =
  | { ok: true; objeto: ObjetoAoVivo }
  | { ok: false; erro: string; status: number; objeto: ObjetoAoVivo | null };

/** fetch da propria API. Nao usa o chamar() de Integracoes: ele descarta o objeto do 409. */
async function pedirApi(url: string, init?: RequestInit): Promise<RespostaApi> {
  try {
    const r = await fetch(url, {
      ...init,
      headers: { "Content-Type": "application/json", ...(init?.headers || {}) },
    });
    const corpo = (await r.json().catch(() => ({}))) as { ok?: boolean; erro?: string; objeto?: ObjetoAoVivo | null };
    if (r.ok && corpo.ok === true && corpo.objeto) return { ok: true, objeto: corpo.objeto };
    return {
      ok: false,
      status: r.status,
      objeto: corpo.objeto ?? null,
      erro:
        corpo.erro ||
        (r.status === 401 ? "Sua sessão expirou. Entre de novo." : "O servidor não respondeu como esperado. Tente de novo."),
    };
  } catch {
    return { ok: false, status: 0, objeto: null, erro: "Sem conexão com o servidor. Confira a internet e tente de novo." };
  }
}

export function pedirAlteracao(corpo: {
  conta: string;
  nivel: NivelEdicao;
  id: string;
  campo: CampoEdicao;
  valor: string | number;
  /** O valor que a tela mostrava; null = nao confere (o interruptor so tem o efetivo). */
  esperado: string | null;
}): Promise<RespostaApi> {
  return pedirApi("/api/ads/meta/alterar", { method: "POST", body: JSON.stringify(corpo) });
}

/** Varias mudancas do mesmo objeto, num POST so (tudo ou nada). */
function pedirAlteracoes(corpo: {
  conta: string;
  nivel: NivelEdicao;
  id: string;
  mudancas: { campo: CampoEdicao; valor: string | number; esperado: string | null }[];
}): Promise<RespostaApi> {
  return pedirApi("/api/ads/meta/alterar", { method: "POST", body: JSON.stringify(corpo) });
}

function lerObjeto(conta: string, nivel: NivelEdicao, id: string): Promise<RespostaApi> {
  const q = new URLSearchParams({ conta, nivel, id });
  return pedirApi(`/api/ads/meta/objeto?${q.toString()}`);
}

// ----------------------------------------------------------------------------
// Campos do formulario
// ----------------------------------------------------------------------------

type CampoNumero = Exclude<CampoEdicao, "status">;

interface DefCampo {
  campo: CampoNumero;
  rotulo: string;
  ajuda: string | null;
  atual: number;
  dinheiro: boolean;
  casas: number;
}

interface Formulario {
  ligado: boolean;
  valores: Partial<Record<CampoNumero, string>>;
}

interface Mudanca {
  campo: CampoEdicao;
  rotulo: string;
  valor: string | number;
  /** So nos campos de numero: a linha da confirmacao. */
  antes: number | null;
  depois: number | null;
  grande: boolean;
}

function casasDaMoeda(moeda: string): number {
  return MOEDAS_SEM_CENTAVOS.has(moeda) ? 0 : 2;
}

function dinheiro(v: number, moeda: string): string {
  return formatarDinheiro(v, moeda, casasDaMoeda(moeda));
}

/** Numero no campo do jeito que o lojista digita (virgula decimal, sem milhar). */
function paraCampo(v: number, casas: number): string {
  return v.toLocaleString("pt-BR", { useGrouping: false, maximumFractionDigits: casas });
}

/**
 * Texto do campo -> numero. Com virgula e o formato brasileiro (o ponto e
 * milhar); sem virgula, o ponto e decimal. Simbolo de moeda nao entra: o
 * campo ja diz a moeda.
 */
function lerNumero(texto: string): number | null {
  const t = texto.replace(/\s/g, "");
  if (!t) return null;
  const normal = t.includes(",") ? t.replace(/\./g, "").replace(",", ".") : t;
  if (!/^\d+(\.\d+)?$/.test(normal)) return null;
  const n = Number(normal);
  return Number.isFinite(n) ? n : null;
}

/** Os campos de numero que ESTE objeto tem para editar (o que for null nao aparece). */
function camposDoObjeto(o: ObjetoAoVivo): DefCampo[] {
  const lista: DefCampo[] = [];
  const casas = casasDaMoeda(o.moeda);
  if (o.nivel !== "anuncio") {
    if (o.diario !== null) {
      lista.push({ campo: "orcamento_diario", rotulo: "Orçamento diário", ajuda: null, atual: o.diario, dinheiro: true, casas });
    }
    if (o.total !== null) {
      lista.push({
        campo: "orcamento_total",
        rotulo: "Orçamento total",
        ajuda: "O que a campanha gasta do início ao fim.",
        atual: o.total,
        dinheiro: true,
        casas,
      });
    }
  }
  if (o.nivel === "grupo" && o.estrategia) {
    if (ESTRATEGIAS_COM_LANCE.has(o.estrategia) && o.lance !== null) {
      lista.push({
        campo: "lance",
        rotulo: "Lance",
        ajuda: o.estrategia === "COST_CAP" ? "Limite de custo por resultado." : "Limite de lance por leilão.",
        atual: o.lance,
        dinheiro: true,
        casas,
      });
    }
    if (o.estrategia === ESTRATEGIA_ROAS_MINIMO && o.roasMinimo !== null) {
      lista.push({
        campo: "roas_minimo",
        rotulo: "ROAS mínimo",
        ajuda: "1,5 = o Meta busca compras de 1,5 vez o gasto.",
        atual: o.roasMinimo,
        dinheiro: false,
        casas: 4,
      });
    }
  }
  return lista;
}

/** Frase de quando o orcamento nao se edita aqui (null = tem campo de orcamento). */
function semOrcamento(o: ObjetoAoVivo): string | null {
  if (o.nivel === "anuncio") return "Anúncio não tem orçamento: ele usa o do conjunto ou o da campanha.";
  if (o.diario !== null || o.total !== null) return null;
  return o.nivel === "grupo" ? "O orçamento fica na campanha (CBO)." : "O orçamento fica nos conjuntos (ABO).";
}

/** Frase de quando o conjunto nao tem lance para editar (null = tem, ou nao e conjunto). */
function semLance(o: ObjetoAoVivo): string | null {
  if (o.nivel !== "grupo") return null;
  if (o.estrategia && ESTRATEGIAS_COM_LANCE.has(o.estrategia)) {
    return o.lance === null ? "O Meta não informou o lance deste conjunto." : null;
  }
  if (o.estrategia === ESTRATEGIA_ROAS_MINIMO) {
    return o.roasMinimo === null ? "O Meta não informou o ROAS mínimo deste conjunto." : null;
  }
  return "Estratégia sem lance para editar (menor custo).";
}

function formularioDe(o: ObjetoAoVivo): Formulario {
  const valores: Formulario["valores"] = {};
  for (const def of camposDoObjeto(o)) valores[def.campo] = paraCampo(def.atual, def.casas);
  return { ligado: o.status === "ACTIVE", valores };
}

/** O valor de agora como o servidor compara (valorDoCampo em gerenciar.ts). */
function esperadoDe(o: ObjetoAoVivo, campo: CampoEdicao): string {
  switch (campo) {
    case "status":
      return String(o.status);
    case "orcamento_diario":
      return String(o.diario);
    case "orcamento_total":
      return String(o.total);
    case "lance":
      return String(o.lance);
    case "roas_minimo":
      return String(o.roasMinimo);
  }
}

function calcular(o: ObjetoAoVivo, f: Formulario): { mudancas: Mudanca[]; erros: Partial<Record<CampoNumero, string>> } {
  const mudancas: Mudanca[] = [];
  const erros: Partial<Record<CampoNumero, string>> = {};
  for (const def of camposDoObjeto(o)) {
    const n = lerNumero(f.valores[def.campo] ?? "");
    if (n === null || n <= 0) {
      erros[def.campo] = "Informe um valor maior que zero.";
      continue;
    }
    const novo = arredondar(n, def.casas);
    if (novo === def.atual) continue;
    const variacao = Math.abs(novo - def.atual) / def.atual;
    mudancas.push({
      campo: def.campo,
      rotulo: def.rotulo,
      valor: novo,
      antes: def.atual,
      depois: novo,
      grande: (def.campo === "orcamento_diario" || def.campo === "orcamento_total") && variacao > LIMITE_APRENDIZADO,
    });
  }
  // Status por ultimo: ligar ja com o orcamento novo.
  if (f.ligado !== (o.status === "ACTIVE")) {
    mudancas.push({ campo: "status", rotulo: "Status", valor: f.ligado ? "ACTIVE" : "PAUSED", antes: null, depois: null, grande: false });
  }
  return { mudancas, erros };
}

const NOME_DO_NIVEL: Record<NivelEdicao, string> = { campanha: "Campanha", grupo: "Conjunto", anuncio: "Anúncio" };

// ----------------------------------------------------------------------------
// Botao + painel
// ----------------------------------------------------------------------------

export function BotaoEditarAnuncio({ linha }: { linha: LinhaCampanha }) {
  const [aberto, setAberto] = useState(false);
  // Salvando: Esc, o X e o fundo nao fecham (o pedido ao Meta ja saiu).
  const [preso, setPreso] = useState(false);
  const nivel = nivelEditavel(linha);
  if (!nivel) return null;

  return (
    <Dialog
      open={aberto}
      onOpenChange={(v) => {
        if (!preso) setAberto(v);
      }}
    >
      <DialogTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={`Editar ${linha.nome}`}
            className="text-t3 hover:text-ink"
          />
        }
      >
        <Pencil aria-hidden />
      </DialogTrigger>
      <DialogContent>
        {/* O conteudo so monta com o dialog aberto: cada abertura le o Meta de novo. */}
        <PainelEdicao
          linha={linha}
          nivel={nivel}
          aoPrender={setPreso}
          aoConcluir={() => {
            setPreso(false);
            setAberto(false);
          }}
        />
      </DialogContent>
    </Dialog>
  );
}

type Carga = { fase: "carregando" } | { fase: "erro"; erro: string } | { fase: "pronto"; objeto: ObjetoAoVivo };

function PainelEdicao({
  linha,
  nivel,
  aoPrender,
  aoConcluir,
}: {
  linha: LinhaCampanha;
  nivel: NivelEdicao;
  aoPrender: (v: boolean) => void;
  aoConcluir: () => void;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const id = useId();
  const [tentativa, setTentativa] = useState(0);
  const [carga, setCarga] = useState<Carga>({ fase: "carregando" });
  const [form, setForm] = useState<Formulario>({ ligado: false, valores: {} });
  const [tentouSalvar, setTentouSalvar] = useState(false);
  const [confirmando, setConfirmando] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [mudouNoMeta, setMudouNoMeta] = useState(false);

  useEffect(() => {
    let vivo = true;
    lerObjeto(linha.contaId, nivel, linha.objetoId).then((r) => {
      if (!vivo) return;
      if (r.ok) {
        setCarga({ fase: "pronto", objeto: r.objeto });
        setForm(formularioDe(r.objeto));
      } else {
        setCarga({ fase: "erro", erro: r.erro });
      }
    });
    return () => {
      vivo = false;
    };
  }, [linha.contaId, linha.objetoId, nivel, tentativa]);

  const objeto = carga.fase === "pronto" ? carga.objeto : null;
  const titulo = objeto?.nome || linha.nome;
  const cabecalho = (
    <DialogHeader>
      <DialogTitle className="truncate">{titulo}</DialogTitle>
      <DialogDescription>
        {NOME_DO_NIVEL[nivel]} · {linha.contaNome}. As mudanças vão direto para o Meta.
      </DialogDescription>
    </DialogHeader>
  );

  if (carga.fase === "carregando") {
    return (
      <>
        {cabecalho}
        <div className="flex items-center gap-2 py-6 text-t2">
          <Spinner size={14} />
          <span>Lendo o estado de agora no Meta…</span>
        </div>
      </>
    );
  }

  if (carga.fase === "erro") {
    return (
      <>
        {cabecalho}
        <Callout tom="err" titulo="Não deu para ler do Meta" acao={linkDoErro(carga.erro)}>
          {carga.erro}
        </Callout>
        <DialogFooter showCloseButton>
          <Button
            type="button"
            onClick={() => {
              setCarga({ fase: "carregando" });
              setTentativa((n) => n + 1);
            }}
          >
            Tentar de novo
          </Button>
        </DialogFooter>
      </>
    );
  }

  const o = carga.objeto;
  if (o.status === "ARCHIVED" || o.status === "DELETED") {
    return (
      <>
        {cabecalho}
        <Callout tom="info" titulo={o.status === "ARCHIVED" ? "Arquivado no Meta" : "Excluído no Meta"}>
          Não dá para editar pelo Panda Track.
        </Callout>
        <DialogFooter showCloseButton />
      </>
    );
  }

  const defs = camposDoObjeto(o);
  const { mudancas, erros } = calcular(o, form);
  const temErro = Object.keys(erros).length > 0;
  const grandes = mudancas.filter((m) => m.grande);
  const fraseOrcamento = semOrcamento(o);
  const fraseLance = semLance(o);
  const motivo = o.status === "ACTIVE" && o.efetivo && o.efetivo !== "ACTIVE" ? motivoDoStatus(o.efetivo) : null;

  function mexer(f: Formulario) {
    setForm(f);
    setConfirmando(false);
    setMudouNoMeta(false);
  }

  async function salvar(confirmado: boolean) {
    setTentouSalvar(true);
    setErro(null);
    if (temErro || mudancas.length === 0) return;
    if (!confirmado && grandes.length > 0) {
      setConfirmando(true);
      return;
    }
    setConfirmando(false);
    setSalvando(true);
    aoPrender(true);

    // Tudo num POST so: o Meta aceita uma edicao por objeto a cada 30 s, e o
    // segundo campo em outra chamada tomaria o erro. Tudo ou nada.
    const r = await pedirAlteracoes({
      conta: linha.contaId,
      nivel,
      id: linha.objetoId,
      mudancas: mudancas.map((m) => ({ campo: m.campo, valor: m.valor, esperado: esperadoDe(o, m.campo) })),
    });
    if (!r.ok) {
      if (r.status === 409 && r.objeto) {
        // Mudou no Meta desde que o painel abriu: mostra o de agora e nada vai.
        setCarga({ fase: "pronto", objeto: r.objeto });
        setForm(formularioDe(r.objeto));
        setMudouNoMeta(true);
        setTentouSalvar(false);
      } else {
        setErro(r.erro);
      }
      setSalvando(false);
      aoPrender(false);
      return;
    }

    setSalvando(false);
    aoConcluir();
    startTransition(() => router.refresh());
  }

  return (
    <>
      {cabecalho}

      {mudouNoMeta ? (
        <Callout tom="warn" titulo="O valor mudou no Meta">
          Alguém mexeu neste item desde que o painel abriu. Os valores abaixo são os de agora: confira e salve de novo.
        </Callout>
      ) : null}

      <div className="flex flex-col gap-4">
        <Switch
          rotulo="Ligado no Meta"
          descricao={form.ligado ? (motivo ?? "Roda e gasta.") : "Pausado: não roda nem gasta."}
          checked={form.ligado}
          disabled={salvando}
          onCheckedChange={(v) => mexer({ ...form, ligado: v })}
        />

        {defs.map((def) => {
          const idCampo = `${id}-${def.campo}`;
          const erroCampo = tentouSalvar ? erros[def.campo] : undefined;
          return (
            <div key={def.campo} className="flex flex-col gap-1.5">
              <Label htmlFor={idCampo}>
                {def.rotulo}
                {def.dinheiro ? <span className="font-normal text-t3">({o.moeda})</span> : null}
              </Label>
              <Input
                id={idCampo}
                inputMode="decimal"
                autoComplete="off"
                className="num text-right"
                value={form.valores[def.campo] ?? ""}
                disabled={salvando}
                aria-invalid={erroCampo ? true : undefined}
                aria-describedby={`${idCampo}-ajuda${erroCampo ? ` ${idCampo}-erro` : ""}`}
                onChange={(e) => mexer({ ...form, valores: { ...form.valores, [def.campo]: e.target.value } })}
              />
              <p id={`${idCampo}-ajuda`} className="text-label text-t2">
                Agora: {def.dinheiro ? dinheiro(def.atual, o.moeda) : paraCampo(def.atual, def.casas)}
                {def.ajuda ? ` · ${def.ajuda}` : ""}
              </p>
              {erroCampo ? (
                <p id={`${idCampo}-erro`} className="text-label font-medium text-err">
                  {erroCampo}
                </p>
              ) : null}
            </div>
          );
        })}

        {fraseOrcamento ? <p className="text-label text-t2">{fraseOrcamento}</p> : null}
        {fraseLance ? <p className="text-label text-t2">{fraseLance}</p> : null}
      </div>

      {confirmando && grandes.length > 0 ? (
        <Callout tom="warn" titulo="Mudanças grandes podem reiniciar o aprendizado do Meta">
          <ul className="flex flex-col gap-0.5">
            {grandes.map((m) => {
              const pct = Math.round((((m.depois ?? 0) - (m.antes ?? 0)) / (m.antes || 1)) * 100);
              return (
                <li key={m.campo} className="num">
                  {m.rotulo}: {dinheiro(m.antes ?? 0, o.moeda)} → {dinheiro(m.depois ?? 0, o.moeda)} ({pct > 0 ? "+" : ""}
                  {pct}%)
                </li>
              );
            })}
          </ul>
          <p className="mt-1">Acima de 20% de uma vez, o conjunto pode voltar à fase de aprendizado.</p>
        </Callout>
      ) : null}

      {erro ? (
        <p role="alert" className="text-dense font-medium text-err text-pretty">
          {erro} {linkDoErro(erro)}
        </p>
      ) : null}

      <DialogFooter>
        {confirmando ? (
          <>
            <Button type="button" variant="secondary" onClick={() => setConfirmando(false)}>
              Voltar
            </Button>
            <Button type="button" pending={salvando} onClick={() => salvar(true)}>
              Salvar mesmo assim
            </Button>
          </>
        ) : (
          <>
            <DialogClose render={<Button type="button" variant="secondary" disabled={salvando} />}>Cancelar</DialogClose>
            <Button
              type="button"
              pending={salvando}
              disabled={!temErro && mudancas.length === 0}
              onClick={() => salvar(false)}
            >
              Salvar
            </Button>
          </>
        )}
      </DialogFooter>
    </>
  );
}
