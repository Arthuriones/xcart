"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { MoreHorizontalIcon, SearchIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { DataTable, type ColunaTabela } from "@/components/ui/data-table";
import { Dica } from "@/components/ui/dica";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Segmented } from "@/components/ui/segmented";
import { STATUS, StatusBadge } from "@/components/ui/status-badge";
import { cn } from "@/components/ui/cn";
import { ROTULO_PERIODO, rotuloIntervalo } from "@/components/layout/contexto";
import { formatarDinheiro } from "@/lib/financeiro/tipos";
import {
  ORDEM_CONEXAO,
  ROTULO_SUGESTAO,
  SELO_CONEXAO,
  diaDe,
  filtrarLojas,
  moedaIdioma,
  quandoFoi,
  rotuloPapel,
  type GrupoLojas,
} from "@/lib/leitura/lojas-estado";
import type { ResumoLoja, ResumoLojas } from "@/lib/leitura/resumo-lojas";
import type { Saude } from "@/app/(dashboard)/tracking/saude";
import { BotaoConectar, useConectarLoja } from "./conectar-loja";
import { RemoverLoja, type LojaParaRemover } from "./remover-loja";
import { useSincronizarLoja } from "./usar-sincronizar";

const SELO_SAUDE: Record<Saude, { tom: "ok" | "warn" | "err" | "neutral"; texto: string }> = {
  ok: STATUS.saude.tudoCerto,
  atencao: STATUS.saude.atencao,
  parado: STATUS.saude.parado,
  desligado: STATUS.saude.desligado,
};
const ORDEM_SAUDE: Record<Saude, number> = { parado: 0, atencao: 1, ok: 2, desligado: 3 };

const LINK_EXTERNO =
  "rounded-sm text-t2 underline-offset-2 hover:text-ink hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus";

type Linha = {
  id: string;
  nome: string;
  dominio: string;
  semAcesso: boolean;
  loja: ResumoLoja;
  papelTexto: string;
  conexaoOrdem: number;
  moedaIdioma: string;
  receitaValor: number | null;
  lucroValor: number | null;
  saudeOrdem: number | null;
  syncValor: number | null;
};

/** Sem acesso e sem nenhum pedido no periodo: "—" (nao se sabe), nao "R$ 0,00". */
function semNumero(l: ResumoLoja): boolean {
  return !l.financeiro || (l.conexao.semAcesso && l.financeiro.pedidos === 0 && l.financeiro.receita === 0);
}

function dinheiro(v: number, moeda: string): string {
  return formatarDinheiro(v, moeda, Math.abs(v) >= 10000 ? 0 : 2);
}

export function ListaLojas({ resumo }: { resumo: ResumoLojas }) {
  const router = useRouter();
  const { abrir } = useConectarLoja();
  const { sincronizar, emCurso } = useSincronizarLoja();
  // Removida aqui sai da lista NA HORA; o refresh do servidor confirma depois.
  const [removidas, setRemovidas] = React.useState<Set<string>>(() => new Set());
  const [remover, setRemover] = React.useState<LojaParaRemover | null>(null);
  const [removerAberto, setRemoverAberto] = React.useState(false);

  const vivas = React.useMemo(
    () => resumo.lojas.filter((l) => !removidas.has(l.id)),
    [resumo.lojas, removidas]
  );
  const nAtivas = vivas.filter((l) => !l.conexao.semAcesso).length;
  const nSemAcesso = vivas.length - nAtivas;

  const [grupo, setGrupo] = React.useState<GrupoLojas>(() =>
    resumo.lojas.some((l) => !l.conexao.semAcesso) ? "ativas" : "todas"
  );
  const [busca, setBusca] = React.useState("");

  const agora = React.useMemo(() => new Date(), []);
  const moeda = resumo.moeda;

  const linhas: Linha[] = React.useMemo(
    () =>
      filtrarLojas(
        vivas.map((l) => ({ ...l, semAcesso: l.conexao.semAcesso })),
        grupo,
        busca
      ).map((l) => ({
        id: l.id,
        nome: l.nome,
        dominio: l.dominio,
        semAcesso: l.semAcesso,
        loja: l,
        papelTexto: rotuloPapel(l.papel),
        conexaoOrdem: ORDEM_CONEXAO[l.conexao.chave],
        moedaIdioma: moedaIdioma(l.moeda, l.idioma),
        receitaValor: semNumero(l) ? null : l.financeiro!.receita,
        lucroValor: semNumero(l) ? null : l.financeiro!.lucro,
        saudeOrdem: l.rastreamento ? ORDEM_SAUDE[l.rastreamento.saude] : null,
        syncValor: l.ultimoSyncOk ? Date.parse(l.ultimoSyncOk) : null,
      })),
    [vivas, grupo, busca]
  );

  function abrirRemover(l: ResumoLoja) {
    setRemover({ id: l.id, nome: l.nome, dominio: l.dominio });
    setRemoverAberto(true);
  }

  function agirSugestao(l: ResumoLoja) {
    const s = l.conexao.sugestao;
    if (s === "reconectar") abrir({ dominio: l.dominio, reconectar: true });
    else if (s === "remover") abrirRemover(l);
    else if (s === "sincronizar") void sincronizar(l);
  }

  const colunas: ColunaTabela<Linha>[] = [
    {
      chave: "loja",
      titulo: "Loja",
      ordenarPor: "nome",
      className: "min-w-52",
      celula: (l) => (
        <span className="flex min-w-0 flex-col gap-0.5">
          <Link
            href={`/stores/${l.id}`}
            className="rounded-sm font-semibold text-ink hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
          >
            {l.nome}
          </Link>
          <span className="flex items-center gap-x-2.5 text-label font-normal">
            <span className="font-mono text-t2">{l.dominio.replace(/\.myshopify\.com$/i, "")}</span>
            <a
              href={`https://${l.dominio}`}
              target="_blank"
              rel="noopener noreferrer"
              className={LINK_EXTERNO}
              aria-label={`Abrir a loja ${l.nome} (outra aba)`}
            >
              Loja ↗
            </a>
            <a
              href={`https://${l.dominio}/admin`}
              target="_blank"
              rel="noopener noreferrer"
              className={LINK_EXTERNO}
              aria-label={`Abrir ${l.nome} no admin da Shopify (outra aba)`}
            >
              Admin ↗
            </a>
          </span>
        </span>
      ),
    },
    ...(resumo.temRota
      ? [
          {
            chave: "papelTexto",
            titulo: "Papel",
            ocultarNoCartao: true,
          } satisfies ColunaTabela<Linha>,
        ]
      : []),
    {
      chave: "conexao",
      titulo: "Conexão",
      ordenarPor: "conexaoOrdem",
      celula: (l) => (
        <span className="flex flex-col items-start gap-1">
          <StatusBadge {...SELO_CONEXAO[l.loja.conexao.chave]} />
          <span className="max-w-40 text-label whitespace-normal text-t2">{l.loja.conexao.detalhe}</span>
        </span>
      ),
    },
    // Abaixo de 1536 px a coluna sai (esta tambem no detalhe): com o menu ao
    // lado, a tabela inteira nao cabe sem rolar de lado.
    { chave: "moedaIdioma", titulo: "Moeda · idioma", ocultarNoCartao: true, className: "hidden 2xl:table-cell" },
    {
      chave: "faturamento",
      titulo: "Faturamento",
      alinhar: "direita",
      ordenarPor: "receitaValor",
      ocultarNoCartao: true,
      celula: (l) => (l.receitaValor === null ? "—" : dinheiro(l.receitaValor, moeda)),
    },
    {
      chave: "lucro",
      titulo: "Lucro estimado",
      alinhar: "direita",
      ordenarPor: "lucroValor",
      celula: (l) =>
        l.lucroValor === null ? (
          "—"
        ) : (
          <span className={cn("font-semibold", l.lucroValor < 0 ? "text-err" : "text-ink")}>
            {dinheiro(l.lucroValor, moeda)}
          </span>
        ),
    },
    {
      chave: "rastreamento",
      titulo: "Rastreamento",
      ordenarPor: "saudeOrdem",
      celula: (l) =>
        l.loja.rastreamento ? (
          <StatusBadge {...SELO_SAUDE[l.loja.rastreamento.saude]} />
        ) : (
          <span className="text-t2">
            —<span className="sr-only">não deu para ler</span>
          </span>
        ),
    },
    {
      chave: "sync",
      titulo: "Sincronização",
      ordenarPor: "syncValor",
      direcaoInicial: "desc",
      ocultarNoCartao: true,
      celula: (l) => {
        if (emCurso === l.id || l.loja.sincronizando) {
          return <StatusBadge tom="run">Sincronizando</StatusBadge>;
        }
        if (l.semAcesso) {
          const dia = diaDe(l.loja.conexao.desde ?? l.loja.ultimoSyncOk);
          return <span className="num text-t1">{dia ? `parou em ${dia}` : "—"}</span>;
        }
        return <span className="num text-t1">{quandoFoi(l.loja.ultimoSyncOk, agora) ?? "—"}</span>;
      },
    },
    {
      chave: "acoes",
      titulo: <span className="sr-only">Ações</span>,
      alinhar: "direita",
      ordenavel: false,
      celula: (l) => {
        // Na tabela, a acao sugerida aparece para quem esta sem acesso; a falha
        // de sincronizacao de uma loja ativa fica no menu e no detalhe.
        const s = l.semAcesso ? l.loja.conexao.sugestao : null;
        const desinstalada = l.loja.conexao.chave === "appDesinstalado";
        return (
          <span className="inline-flex items-center justify-end gap-2">
            {s ? (
              <Button
                size="sm"
                variant={s === "reconectar" ? "primary" : s === "remover" ? "destructive" : "secondary"}
                pending={s === "sincronizar" && emCurso === l.id}
                onClick={() => agirSugestao(l.loja)}
              >
                {ROTULO_SUGESTAO[s]}
                <span className="sr-only"> {l.nome}</span>
              </Button>
            ) : null}
            <DropdownMenu>
              <DropdownMenuTrigger
                render={<Button size="icon-sm" variant="ghost" aria-label={`Ações de ${l.nome}`} />}
              >
                <MoreHorizontalIcon aria-hidden />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-52">
                <DropdownMenuItem onClick={() => router.push(`/stores/${l.id}`)}>Abrir detalhe</DropdownMenuItem>
                <DropdownMenuItem onClick={() => abrir({ dominio: l.dominio, reconectar: true })}>
                  Reconectar
                </DropdownMenuItem>
                {!desinstalada ? (
                  <DropdownMenuItem disabled={Boolean(emCurso)} onClick={() => void sincronizar(l.loja)}>
                    Sincronizar agora
                  </DropdownMenuItem>
                ) : null}
                <DropdownMenuSeparator />
                <DropdownMenuItem variant="destructive" onClick={() => abrirRemover(l.loja)}>
                  Remover do xcart…
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </span>
        );
      },
    },
  ];

  const indisponivel = [
    resumo.financeiroIndisponivel ? "faturamento e lucro" : null,
    resumo.rastreamentoIndisponivel ? "rastreamento" : null,
  ].filter(Boolean);

  if (vivas.length === 0) {
    return (
      <EmptyState
        titulo="Nenhuma loja conectada"
        descricao="Conecte uma loja Shopify para ver lucro, rastreamento e alertas."
        acao={<BotaoConectar />}
        className="py-12"
      />
    );
  }

  const periodoTexto = `${ROTULO_PERIODO[resumo.periodo]} (${rotuloIntervalo(resumo.intervalo)}) · ${moeda}`;

  return (
    <div className="flex flex-col gap-4">
      {indisponivel.length > 0 ? (
        <Callout
          tom="warn"
          titulo={`Não deu para ler ${indisponivel.join(" e ")} agora`}
          acao={
            <Button size="sm" variant="secondary" onClick={() => router.refresh()}>
              Tentar de novo
            </Button>
          }
        >
          As lojas e a conexão estão certas. Onde falta o número aparece “—”, nunca zero.
        </Callout>
      ) : null}

      <section aria-label="Lojas conectadas" className="min-w-0 rounded-card border border-border bg-surface">
        <div className="flex flex-wrap items-center gap-3 border-b border-border-subtle px-4 py-3">
          <Segmented
            rotulo="Mostrar lojas"
            valor={grupo}
            onValorChange={setGrupo}
            tamanho="md"
            opcoes={[
              { valor: "ativas", rotulo: `Ativas (${nAtivas})` },
              { valor: "semAcesso", rotulo: `Sem acesso (${nSemAcesso})` },
              { valor: "todas", rotulo: `Todas (${vivas.length})` },
            ]}
          />
          <div className="relative min-w-48 flex-1 sm:max-w-72">
            <SearchIcon aria-hidden className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-t3" />
            <Input
              type="search"
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              aria-label="Buscar loja por nome ou domínio"
              placeholder="Buscar por nome ou domínio"
              className="h-ctl-md pl-8 text-dense"
            />
          </div>
          {busca ? (
            <Button variant="link" size="sm" onClick={() => setBusca("")}>
              Limpar busca
            </Button>
          ) : null}
          <span className="flex items-center gap-1 text-label text-t2 sm:ml-auto">
            Faturamento e lucro: {periodoTexto}
            <Dica rotulo="Como ler esta tabela" lado="bottom">
              O período e a moeda são os da tela Lucro. Lucro estimado = faturamento menos produto, frete, taxas
              e anúncio; não é contábil. Rastreamento olha os envios dos últimos 7 dias; o detalhe da loja confere
              também os pedidos e o tema na Shopify.
            </Dica>
          </span>
        </div>

        <DataTable
          legenda={
            grupo === "semAcesso" ? "Lojas sem acesso" : grupo === "ativas" ? "Lojas ativas" : "Todas as lojas"
          }
          colunas={colunas}
          linhas={linhas}
          densidade="confortavel"
          ordenacaoInicial={[{ chave: "faturamento", direcao: "desc" }]}
          className="[&>ul]:pt-3"
          vazio={
            busca ? (
              <EmptyState
                variante="simples"
                className="min-h-45"
                titulo={`Nenhuma loja com “${busca}”`}
                descricao="Busque pelo nome ou pelo domínio .myshopify.com."
                acao={
                  <Button variant="secondary" onClick={() => setBusca("")}>
                    Limpar busca
                  </Button>
                }
              />
            ) : grupo === "semAcesso" ? (
              <EmptyState
                variante="simples"
                className="min-h-45"
                titulo="Nenhuma loja sem acesso"
                descricao="Todas as lojas conectadas deixam o xcart ler os pedidos."
              />
            ) : (
              <EmptyState
                variante="simples"
                className="min-h-45"
                titulo="Nenhuma loja ativa"
                descricao="As lojas que você tem estão sem acesso: reconecte ou remova cada uma."
                acao={
                  <Button variant="secondary" onClick={() => setGrupo("semAcesso")}>
                    Ver as sem acesso
                  </Button>
                }
              />
            )
          }
        />

        <p className="border-t border-border-subtle px-4 py-2.5 text-label text-t2">
          {grupo === "semAcesso"
            ? "Lojas sem acesso não recebem pedidos novos. O que já foi sincronizado continua no Lucro."
            : nSemAcesso > 0 && grupo === "ativas"
              ? `${nSemAcesso === 1 ? "1 loja sem acesso fica" : `${nSemAcesso} lojas sem acesso ficam`} na aba “Sem acesso”.`
              : "Clique no título de uma coluna para ordenar."}
        </p>
      </section>

      <RemoverLoja
        loja={remover}
        aberto={removerAberto}
        aoMudar={setRemoverAberto}
        aoRemover={(id) => {
          setRemovidas((s) => new Set(s).add(id));
          router.refresh();
        }}
      />
    </div>
  );
}
