"use client";

import { useId, useState, type FormEvent, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Segmented } from "@/components/ui/segmented";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ACOES_REGRA,
  INTERVALOS_REGRA,
  JANELAS_REGRA,
  METRICAS_REGRA,
  descreverRegra,
  erroDaRegra,
  type AcaoRegra,
  type MetricaRegra,
  type NivelEdicao,
  type OperadorRegra,
} from "@/lib/ads/gerenciar-regras";
import type { OpcaoEscopo, RegraEntrada, TipoEscopo } from "@/lib/ads/regras-tipos";
import {
  ROTULO_ACAO,
  ROTULO_JANELA,
  ROTULO_METRICA,
  ROTULO_NIVEL,
  ROTULO_OPERADOR,
  ROTULO_TIPO_ESCOPO,
  chaveEscopo,
  dinheiro,
  ehDeOrcamento,
  entradaDoForm,
  escopoDaChave,
  regraDoForm,
  rotuloIntervalo,
  type FormRegra,
} from "./apresentar";

// ============================================================================
// Criar / editar regra, num dialog. A validacao e a MESMA do servidor
// (erroDaRegra): o lojista ve o erro antes de mandar, e a rota recusa igual se
// alguem pular a tela. A frase de baixo (descreverRegra) e a que a lista mostra.
// ============================================================================

const ROTULO = "text-label font-medium text-t2";
const TIPOS: readonly TipoEscopo[] = ["loja", "checkout", "conta"];

interface Props {
  aberto: boolean;
  aoMudarAberto: (v: boolean) => void;
  /** null = regra nova. */
  regraId: string | null;
  inicial: FormRegra;
  /** Escopo gravado na regra (editando): vale mesmo se a operacao perdeu a conta do Meta. */
  escopoOriginal: { chave: string; nome: string; moeda: string | null } | null;
  escopos: readonly OpcaoEscopo[];
  /** Grava; devolve o erro do servidor (texto) ou null. */
  aoSalvar: (entrada: Omit<RegraEntrada, "ativa">) => Promise<string | null>;
}

/** Campo numerico com a unidade (USD, %) dentro, a direita. */
function CampoNumero({
  id,
  valor,
  aoMudar,
  unidade,
  placeholder,
  descritoPor,
}: {
  id: string;
  valor: string;
  aoMudar: (v: string) => void;
  unidade: string;
  placeholder?: string;
  descritoPor?: string;
}) {
  return (
    <div className="relative">
      <Input
        id={id}
        inputMode="decimal"
        autoComplete="off"
        value={valor}
        placeholder={placeholder}
        aria-describedby={descritoPor}
        onChange={(e) => aoMudar(e.target.value)}
        className="num pr-14 text-right"
      />
      <span
        aria-hidden
        className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-label font-medium text-t3"
      >
        {unidade}
      </span>
    </div>
  );
}

function Campo({ rotulo, htmlFor, dica, children }: { rotulo: string; htmlFor?: string; dica?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      {htmlFor ? (
        <Label htmlFor={htmlFor} className={ROTULO}>
          {rotulo}
        </Label>
      ) : (
        <span className={ROTULO}>{rotulo}</span>
      )}
      {children}
      {dica ? <p className="text-label text-t3">{dica}</p> : null}
    </div>
  );
}

export function FormularioRegra({ aberto, aoMudarAberto, regraId, inicial, escopoOriginal, escopos, aoSalvar }: Props) {
  const id = useId();
  const [f, setF] = useState<FormRegra>(inicial);
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);

  const muda = <K extends keyof FormRegra>(campo: K, valor: FormRegra[K]) => {
    setF((atual) => ({ ...atual, [campo]: valor }));
    setErro(null);
  };

  // Escopo da regra que saiu da lista (operacao removida): continua aparecendo
  // com o nome que veio, para o select nao mostrar o id cru.
  const chaveOriginal = escopoOriginal?.chave ?? null;
  const original = escopoOriginal ? escopoDaChave(escopoOriginal.chave) : null;
  const opcoes: readonly OpcaoEscopo[] =
    original && escopoOriginal && !escopos.some((o) => chaveEscopo(o) === escopoOriginal.chave)
      ? [...escopos, { ...original, nome: escopoOriginal.nome, contasMeta: 0, moeda: escopoOriginal.moeda }]
      : escopos;
  const escolhido = opcoes.find((o) => chaveEscopo(o) === f.escopo) ?? null;
  const moeda = escolhido?.moeda ?? null;
  const unidadeMoeda = moeda ?? "moeda";
  const orcamento = ehDeOrcamento(f.acao);
  const regra = regraDoForm(f);
  const previa =
    Number.isFinite(regra.valor) && (!orcamento || (regra.acaoPercentual ?? 0) > 0)
      ? descreverRegra(regra)
      : null;
  const conflitoNivel = orcamento && f.nivel === "anuncio";

  async function enviar(e: FormEvent) {
    e.preventDefault();
    if (salvando) return;
    if (!f.escopo) return setErro("Escolha onde a regra vale.");
    // Escopo sem conta do Meta: a regra nao teria onde agir. Editando sem trocar
    // o escopo, deixa salvar (renomear, mudar o valor) -- quem decide e a rota.
    if (escolhido && escolhido.contasMeta === 0 && f.escopo !== chaveOriginal) {
      return setErro("Esse lugar não tem conta do Meta ligada: a regra não teria onde agir.");
    }
    const motivo = erroDaRegra(regra);
    if (motivo) return setErro(motivo);
    const entrada = entradaDoForm(f);
    if (!entrada) return setErro("Escolha onde a regra vale.");
    setSalvando(true);
    const falha = await aoSalvar(entrada);
    setSalvando(false);
    if (falha) setErro(falha);
  }

  return (
    <Dialog open={aberto} onOpenChange={(v) => !salvando && aoMudarAberto(v)}>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>{regraId ? "Editar regra" : "Nova regra"}</DialogTitle>
          <DialogDescription>
            A regra olha o que cada {ROTULO_NIVEL[f.nivel].toLowerCase()} fez no período e age no Meta sozinha, no
            intervalo escolhido.
          </DialogDescription>
        </DialogHeader>

        <form id={`${id}-form`} onSubmit={enviar} className="flex flex-col gap-4" noValidate>
          <Campo rotulo="Nome" htmlFor={`${id}-nome`}>
            <Input
              id={`${id}-nome`}
              value={f.nome}
              maxLength={80}
              autoComplete="off"
              placeholder="Ex.: Pausar anúncio caro"
              onChange={(e) => muda("nome", e.target.value)}
            />
          </Campo>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Campo rotulo="Onde vale" htmlFor={`${id}-escopo`}>
              <Select value={f.escopo || null} onValueChange={(v) => v && muda("escopo", String(v))}>
                <SelectTrigger id={`${id}-escopo`}>
                  <SelectValue>
                    {(v: string | null) => {
                      const o = opcoes.find((x) => chaveEscopo(x) === v);
                      return o ? o.nome : "Escolha onde vale";
                    }}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {TIPOS.map((tipo) => {
                    const doTipo = opcoes.filter((o) => o.tipo === tipo);
                    if (doTipo.length === 0) return null;
                    return (
                      <SelectGroup key={tipo}>
                        <SelectLabel>{ROTULO_TIPO_ESCOPO[tipo]}</SelectLabel>
                        {doTipo.map((o) => (
                          <SelectItem
                            key={chaveEscopo(o)}
                            value={chaveEscopo(o)}
                            disabled={o.contasMeta === 0 && chaveEscopo(o) !== chaveOriginal}
                          >
                            {o.contasMeta === 0 ? `${o.nome} (sem conta do Meta)` : o.nome}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    );
                  })}
                </SelectContent>
              </Select>
            </Campo>

            <Campo rotulo="Nível">
              <Segmented<NivelEdicao>
                rotulo="Nível"
                tamanho="md"
                valor={f.nivel}
                onValorChange={(v) => muda("nivel", v)}
                opcoes={(["campanha", "grupo", "anuncio"] as const).map((n) => ({ valor: n, rotulo: ROTULO_NIVEL[n] }))}
              />
            </Campo>
          </div>

          <Campo
            rotulo="Só os que têm no nome (opcional)"
            htmlFor={`${id}-filtro`}
            dica="Vazio = todos do nível. Não diferencia maiúscula nem acento."
          >
            <Input
              id={`${id}-filtro`}
              value={f.filtroNome}
              maxLength={80}
              autoComplete="off"
              placeholder="Ex.: [TESTE]"
              onChange={(e) => muda("filtroNome", e.target.value)}
            />
          </Campo>

          <fieldset className="flex flex-col gap-2 rounded-card border border-border p-3">
            <legend className="px-1 text-dense font-medium text-ink">Condição</legend>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <Campo rotulo="Métrica" htmlFor={`${id}-metrica`}>
                <Select value={f.metrica} onValueChange={(v) => v && muda("metrica", v as MetricaRegra)}>
                  <SelectTrigger id={`${id}-metrica`}>
                    <SelectValue>{(v: string) => ROTULO_METRICA[v as MetricaRegra] ?? v}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {METRICAS_REGRA.map((m) => (
                      <SelectItem key={m} value={m}>
                        {ROTULO_METRICA[m]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Campo>
              <Campo rotulo="Se" htmlFor={`${id}-operador`}>
                <Select value={f.operador} onValueChange={(v) => v && muda("operador", v as OperadorRegra)}>
                  <SelectTrigger id={`${id}-operador`}>
                    <SelectValue>{(v: string) => ROTULO_OPERADOR[v as OperadorRegra] ?? v}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {(["maior", "menor"] as const).map((o) => (
                      <SelectItem key={o} value={o}>
                        {ROTULO_OPERADOR[o]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Campo>
              <Campo rotulo="Valor" htmlFor={`${id}-valor`}>
                <CampoNumero
                  id={`${id}-valor`}
                  valor={f.valor}
                  aoMudar={(v) => muda("valor", v)}
                  unidade={f.metrica === "ctr" ? "%" : unidadeMoeda}
                  placeholder={f.metrica === "ctr" ? "1,5" : "20"}
                />
              </Campo>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Campo rotulo="Período">
                <Segmented
                  rotulo="Período"
                  tamanho="md"
                  valor={f.janela}
                  onValorChange={(v) => muda("janela", v)}
                  opcoes={JANELAS_REGRA.map((j) => ({ valor: j, rotulo: ROTULO_JANELA[j] }))}
                />
              </Campo>
              <Campo
                rotulo="Gasto mínimo para julgar"
                htmlFor={`${id}-gasto`}
                dica="Abaixo disso no período, a regra não julga (evita pausar quem mal gastou)."
              >
                <CampoNumero
                  id={`${id}-gasto`}
                  valor={f.gastoMinimo}
                  aoMudar={(v) => muda("gastoMinimo", v)}
                  unidade={unidadeMoeda}
                  placeholder="0"
                />
              </Campo>
            </div>
          </fieldset>

          <fieldset className="flex flex-col gap-2 rounded-card border border-border p-3">
            <legend className="px-1 text-dense font-medium text-ink">Ação</legend>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <Campo rotulo="O que fazer" htmlFor={`${id}-acao`}>
                <Select value={f.acao} onValueChange={(v) => v && muda("acao", v as AcaoRegra)}>
                  <SelectTrigger id={`${id}-acao`} aria-invalid={conflitoNivel || undefined}>
                    <SelectValue>{(v: string) => ROTULO_ACAO[v as AcaoRegra] ?? v}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {ACOES_REGRA.map((a) => {
                      const semOrcamento = ehDeOrcamento(a) && f.nivel === "anuncio";
                      return (
                        <SelectItem key={a} value={a} disabled={semOrcamento}>
                          {semOrcamento ? `${ROTULO_ACAO[a]} (só conjunto ou campanha)` : ROTULO_ACAO[a]}
                        </SelectItem>
                      );
                    })}
                  </SelectContent>
                </Select>
              </Campo>
              {orcamento ? (
                <>
                  <Campo rotulo="Quanto" htmlFor={`${id}-percentual`}>
                    <CampoNumero
                      id={`${id}-percentual`}
                      valor={f.acaoPercentual}
                      aoMudar={(v) => muda("acaoPercentual", v)}
                      unidade="%"
                      placeholder="20"
                    />
                  </Campo>
                  <Campo
                    rotulo={f.acao === "diminuir_orcamento" ? "Não descer de (opcional)" : "Não passar de (opcional)"}
                    htmlFor={`${id}-limite`}
                  >
                    <CampoNumero
                      id={`${id}-limite`}
                      valor={f.orcamentoLimite}
                      aoMudar={(v) => muda("orcamentoLimite", v)}
                      unidade={unidadeMoeda}
                      placeholder={f.acao === "diminuir_orcamento" ? "10" : "200"}
                    />
                  </Campo>
                </>
              ) : null}
            </div>
            {conflitoNivel ? (
              <p className="text-label font-medium text-err">
                Anúncio não tem orçamento: use a regra no conjunto ou na campanha, ou escolha Pausar.
              </p>
            ) : orcamento ? (
              <p className="text-label text-t3">
                Muda o orçamento diário {f.nivel === "campanha" ? "da própria campanha (CBO)" : "do próprio conjunto (ABO)"};
                quem não tem orçamento próprio fica de fora e aparece no resultado.
              </p>
            ) : null}
          </fieldset>

          <Campo rotulo="Checar a cada" htmlFor={`${id}-intervalo`}>
            <Select
              value={String(f.intervaloMinutos)}
              onValueChange={(v) => v && muda("intervaloMinutos", Number(v))}
            >
              <SelectTrigger id={`${id}-intervalo`} className="sm:max-w-48">
                <SelectValue>{(v: string) => rotuloIntervalo(Number(v))}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {INTERVALOS_REGRA.map((m) => (
                  <SelectItem key={m} value={String(m)}>
                    {rotuloIntervalo(m)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Campo>

          <div className="flex flex-col gap-1 rounded-card border border-border-subtle bg-surface-2 px-3 py-2.5">
            <span className={ROTULO}>Resumo</span>
            <p className="text-dense text-ink text-pretty">
              {previa ?? "Preencha a condição e a ação para ver o resumo."}
            </p>
            {previa ? (
              <p className="text-label text-t2">
                {escolhido ? `Em ${escolhido.nome}` : "Sem lugar escolhido"} · checa a cada{" "}
                {rotuloIntervalo(f.intervaloMinutos)}
                {regra.gastoMinimo > 0 ? ` · só quem gastou ${dinheiro(regra.gastoMinimo, moeda)} ou mais` : ""}
                {moeda ? "" : " · valores na moeda de cada conta"}
              </p>
            ) : null}
          </div>

          {erro ? (
            <p role="alert" className="text-dense font-medium text-err">
              {erro}
            </p>
          ) : null}
        </form>

        <DialogFooter>
          <Button variant="secondary" disabled={salvando} onClick={() => aoMudarAberto(false)}>
            Cancelar
          </Button>
          <Button type="submit" form={`${id}-form`} pending={salvando}>
            {regraId ? "Salvar regra" : "Criar regra"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
