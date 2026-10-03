import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { DataTable } from "@/components/ui/data-table";
import { EmptyState } from "@/components/ui/empty-state";
import { Section } from "@/components/ui/section";
import { StatusBadge } from "@/components/ui/status-badge";
import { FUSO_RELATORIO_PADRAO } from "@/lib/financeiro/tipos";
import type { LojaConexao } from "@/lib/leitura/integracoes";
import { estadoDaLoja, plural, semAcesso } from "../regras";

function Resumo({ titulo, valor, estado, detalhe }: { titulo: string; valor: string; estado: React.ReactNode; detalhe: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-2 rounded-card border border-border bg-surface p-4">
      <span className="text-label font-semibold text-t2">{titulo}</span>
      <strong className="text-section text-ink">{valor}</strong>
      {estado}
      <span className="text-label text-t1">{detalhe}</span>
    </div>
  );
}

/** O conteudo de Shopify com as lojas ja lidas (a page le; aqui so desenha). */
export function ConteudoShopify({ lojas, agoraMs }: { lojas: LojaConexao[]; agoraMs: number }) {
  const fuso = FUSO_RELATORIO_PADRAO;
  const fora = lojas.filter(semAcesso);
  const ativas = lojas.length - fora.length;
  const abrirLojas = (
    <Link href="/stores" className={buttonVariants({ variant: "secondary" })}>
      Abrir Lojas
    </Link>
  );

  const linhas = lojas.map((l) => {
    const e = estadoDaLoja(l, agoraMs, fuso);
    return {
      id: l.id,
      loja: (
        <span className="flex min-w-0 flex-col">
          <span className="max-w-64 truncate font-medium">{l.nome}</span>
          <span className="font-mono text-label font-normal text-t2">{l.dominio}</span>
        </span>
      ),
      lojaOrdem: l.nome.toLocaleLowerCase("pt-BR"),
      situacao: <StatusBadge tom={e.tom}>{e.texto}</StatusBadge>,
      situacaoOrdem: e.ordem,
      detalhe: <span className="line-clamp-2 max-w-80 whitespace-normal text-t1">{e.detalhe ?? "—"}</span>,
      detalheOrdem: e.detalhe ?? "",
    };
  });

  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex flex-col gap-1.5">
          <h2 className="text-overlay text-ink">Shopify</h2>
          <StatusBadge tom={lojas.length === 0 ? "neutral" : fora.length > 0 ? "warn" : "ok"}>
            {lojas.length === 0
              ? "Nenhuma loja"
              : fora.length > 0
                ? `${fora.length} sem acesso`
                : plural(lojas.length, "loja conectada", "lojas conectadas")}
          </StatusBadge>
        </div>
        {abrirLojas}
      </div>
      <p className="max-w-[62ch] text-dense text-t1 text-pretty">
        Cada loja usa o próprio app da loja. Conectar, reconectar e remover ficam em Lojas.
      </p>

      {lojas.length === 0 ? (
        <EmptyState
          titulo="Nenhuma loja conectada"
          descricao="Conecte uma loja Shopify para o xcart ler os pedidos e calcular o lucro."
          acao={
            <Link href="/stores" className={buttonVariants()}>
              Conectar loja
            </Link>
          }
        />
      ) : (
        <>
          <div className="grid gap-3 md:grid-cols-2">
            <Resumo
              titulo="Lojas"
              valor={plural(ativas, "ativa", "ativas")}
              estado={<StatusBadge tom={ativas > 0 ? "ok" : "neutral"}>{ativas > 0 ? "Conectadas" : "Nenhuma"}</StatusBadge>}
              detalhe="Os pedidos são lidos a cada 15 minutos."
            />
            <Resumo
              titulo="Sem acesso"
              valor={plural(fora.length, "loja", "lojas")}
              estado={
                <StatusBadge tom={fora.length > 0 ? "warn" : "neutral"}>
                  {fora.length > 0 ? "Fora dos totais" : "Nenhuma"}
                </StatusBadge>
              }
              detalhe={
                fora.length > 0
                  ? "A Shopify não deixa ler os pedidos delas. Reconecte ou remova em Lojas."
                  : "Todas as lojas deixam o xcart ler os pedidos."
              }
            />
          </div>
          <Section
            titulo="Conexão de cada loja"
            nivel={3}
            espaco="nenhum"
            descricao="Horas no horário de São Paulo."
          >
            <DataTable
              legenda="Lojas Shopify e a leitura de pedidos"
              linhas={linhas}
              colunas={[
                { chave: "loja", titulo: "Loja", ordenarPor: "lojaOrdem" },
                { chave: "situacao", titulo: "Situação", ordenarPor: "situacaoOrdem", direcaoInicial: "asc" },
                { chave: "detalhe", titulo: "Última leitura", ordenarPor: "detalheOrdem" },
              ]}
              ordenacaoInicial={[{ chave: "situacao", direcao: "asc" }]}
              densidade="confortavel"
            />
          </Section>
        </>
      )}
    </>
  );
}
