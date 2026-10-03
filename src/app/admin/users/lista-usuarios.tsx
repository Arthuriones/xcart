"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { MoreHorizontalIcon, SearchIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { DataTable, type ColunaTabela } from "@/components/ui/data-table";
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
import { StatusBadge } from "@/components/ui/status-badge";
import {
  FILTROS_PADRAO,
  dataCurta,
  filtrarUsuarios,
  hora,
  inteiro,
  reais,
  rotuloPlano,
  seloAcesso,
  statusAssinatura,
  temAcesso,
  temFiltro,
  urlDosFiltros,
  type FiltroAcesso,
  type FiltroPlano,
  type FiltrosUsuarios,
} from "../formato";
import { DialogoPlanoCreditos, useAcessoUsuario, type Mudanca } from "../gerenciar";
import type { UsuarioAdmin, UsuarioGerenciavel } from "../tipos";

const LINK =
  "rounded-sm font-semibold text-ink underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus";
const LINK_EXTERNO =
  "min-w-0 truncate rounded-sm text-t1 underline-offset-2 hover:text-ink hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus";

type Linha = {
  id: string;
  u: UsuarioAdmin;
  email: string;
  acessoOrdem: number;
  plano: string;
  creditos: number | null;
  lojasQtd: number;
  custo: number;
  cadastro: number | null;
};

function gerenciavel(u: UsuarioAdmin): UsuarioGerenciavel {
  return {
    id: u.id,
    email: u.email,
    plan: u.plan,
    aiCredits: u.aiCredits,
    accessGranted: u.accessGranted,
    isAdmin: u.isAdmin,
  };
}

/**
 * A lista de clientes: busca, filtros de acesso e plano (na URL), ordenacao
 * por coluna e, por linha, liberar/revogar acesso e ajustar plano e creditos.
 * O que muda aparece na linha na hora; o servidor confirma em seguida.
 */
export function ListaUsuarios({
  usuarios,
  travaLigada,
  filtrosIniciais,
  lidoEm,
}: {
  usuarios: UsuarioAdmin[];
  travaLigada: boolean;
  filtrosIniciais: FiltrosUsuarios;
  lidoEm: number;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [filtros, setFiltros] = React.useState(filtrosIniciais);
  const [ajustes, setAjustes] = React.useState<Record<string, Mudanca>>({});
  const [editando, setEditando] = React.useState<UsuarioGerenciavel | null>(null);
  const [dialogo, setDialogo] = React.useState(false);

  function aplicar(id: string, m: Mudanca) {
    setAjustes((a) => ({ ...a, [id]: { ...a[id], ...m } }));
    router.refresh();
  }

  const acesso = useAcessoUsuario({ travaLigada, aoMudar: aplicar });

  // O que o servidor mandou + o que mudou aqui desde entao.
  const todos = React.useMemo(
    () =>
      usuarios.map((u) => {
        const m = ajustes[u.id];
        if (!m) return u;
        const junto = { ...u, ...m };
        return { ...junto, hasAccess: temAcesso(junto) };
      }),
    [usuarios, ajustes]
  );

  function mudarFiltros(f: Partial<FiltrosUsuarios>) {
    const novo = { ...filtros, ...f };
    setFiltros(novo);
    // A URL guarda o filtro (para mandar o link) sem buscar a lista de novo.
    window.history.replaceState(null, "", `${pathname}${urlDosFiltros(novo)}`);
  }

  const contagem = React.useMemo(() => {
    const com = todos.filter((u) => temAcesso(u)).length;
    const pro = todos.filter((u) => u.plan === "pro").length;
    return { com, sem: todos.length - com, pro, free: todos.length - pro };
  }, [todos]);

  const linhas: Linha[] = React.useMemo(
    () =>
      filtrarUsuarios(todos, filtros).map((u) => ({
        id: u.id,
        u,
        email: u.email,
        acessoOrdem: seloAcesso(u).ordem,
        plano: rotuloPlano(u.plan),
        creditos: u.aiCredits,
        lojasQtd: u.stores.length,
        custo: u.usageThisMonth.costBrl,
        cadastro: u.createdAt ? Date.parse(u.createdAt) : null,
      })),
    [todos, filtros]
  );

  function abrirPlano(u: UsuarioAdmin) {
    setEditando(gerenciavel(u));
    setDialogo(true);
  }

  const colunas: ColunaTabela<Linha>[] = [
    {
      chave: "usuario",
      titulo: "Usuário",
      ordenarPor: "email",
      className: "min-w-56",
      celula: (l) => (
        <span className="flex min-w-0 items-center gap-2">
          <Link href={`/admin/users/${l.id}`} className={`${LINK} min-w-0 max-w-60 truncate`}>
            {l.email}
          </Link>
          {l.u.isAdmin ? <StatusBadge tom="info" texto="Admin" ponto={false} /> : null}
        </span>
      ),
    },
    {
      chave: "acesso",
      titulo: "Acesso",
      ordenarPor: "acessoOrdem",
      celula: (l) => {
        const s = seloAcesso(l.u);
        return (
          <span className="flex flex-col items-start gap-1">
            <StatusBadge tom={s.tom} texto={s.texto} />
            <span className="text-label text-t2">{s.motivo}</span>
          </span>
        );
      },
    },
    {
      chave: "planoCelula",
      titulo: "Plano",
      ordenarPor: "plano",
      celula: (l) => {
        const status = statusAssinatura(l.u.subscriptionStatus);
        return (
          <span className="flex flex-col">
            <span className={l.u.plan === "pro" ? "font-semibold text-ink" : "text-ink"}>{l.plano}</span>
            {status ? <span className="text-label text-t2">{status}</span> : null}
          </span>
        );
      },
    },
    {
      chave: "creditosTexto",
      titulo: "Créditos",
      alinhar: "direita",
      ordenarPor: "creditos",
      celula: (l) => inteiro(l.creditos),
    },
    {
      chave: "lojas",
      titulo: "Lojas",
      ordenarPor: "lojasQtd",
      direcaoInicial: "desc",
      // Abaixo de 1536 px a coluna sai (as lojas estao no detalhe): com o menu
      // ao lado, a tabela inteira nao cabe sem rolar de lado.
      className: "hidden max-w-56 2xl:table-cell",
      celula: (l) =>
        l.u.stores.length === 0 ? (
          <span className="text-t2">
            —<span className="sr-only">nenhuma loja</span>
          </span>
        ) : (
          <span className="flex min-w-0 flex-col gap-0.5 text-label">
            {l.u.stores.slice(0, 2).map((s) => (
              <a
                key={s.domain}
                href={`https://${s.domain}`}
                target="_blank"
                rel="noopener noreferrer"
                className={LINK_EXTERNO}
                aria-label={`Abrir a loja ${s.name} (outra aba)`}
              >
                {s.name} ↗
              </a>
            ))}
            {l.u.stores.length > 2 ? (
              <Link href={`/admin/users/${l.id}`} className="w-fit rounded-sm text-t2 hover:text-ink hover:underline">
                e mais {l.u.stores.length - 2}
              </Link>
            ) : null}
          </span>
        ),
    },
    {
      chave: "custoTexto",
      titulo: "Custo de IA",
      alinhar: "direita",
      ordenarPor: "custo",
      celula: (l) => reais(l.custo),
    },
    {
      chave: "cadastroTexto",
      titulo: "Cadastro",
      ordenarPor: "cadastro",
      direcaoInicial: "desc",
      celula: (l) => <span className="num text-t1">{dataCurta(l.u.createdAt)}</span>,
    },
    {
      chave: "acoes",
      titulo: <span className="sr-only">Ações</span>,
      alinhar: "direita",
      ordenavel: false,
      celula: (l) => {
        const u = l.u;
        const g = gerenciavel(u);
        const semAcesso = !u.isAdmin && !temAcesso(u);
        return (
          <span className="inline-flex items-center justify-end gap-2">
            {semAcesso ? (
              <Button
                size="sm"
                variant="secondary"
                className="max-sm:h-ctl-lg max-sm:px-4"
                pending={acesso.pendente === u.id}
                onClick={() => void acesso.liberar(g)}
              >
                Liberar
                <span className="sr-only"> o acesso de {u.email}</span>
              </Button>
            ) : null}
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button size="icon-sm" variant="ghost" className="max-sm:size-ctl-lg" aria-label={`Ações de ${u.email}`} />
                }
              >
                <MoreHorizontalIcon aria-hidden />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-60">
                <DropdownMenuItem onClick={() => router.push(`/admin/users/${u.id}`)}>Abrir detalhe</DropdownMenuItem>
                <DropdownMenuItem onClick={() => abrirPlano(u)}>Plano e créditos…</DropdownMenuItem>
                <DropdownMenuSeparator />
                {u.isAdmin ? (
                  <DropdownMenuItem disabled>Administrador sempre tem acesso</DropdownMenuItem>
                ) : u.accessGranted ? (
                  <DropdownMenuItem variant="destructive" onClick={() => acesso.pedirRevogar(g)}>
                    Revogar acesso…
                  </DropdownMenuItem>
                ) : (
                  <DropdownMenuItem onClick={() => void acesso.liberar(g)}>Liberar acesso</DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </span>
        );
      },
    },
  ];

  if (usuarios.length === 0) {
    return (
      <EmptyState
        titulo="Nenhum usuário ainda"
        descricao="Os clientes aparecem aqui assim que criarem a conta."
        className="py-12"
      />
    );
  }

  const filtrando = temFiltro(filtros);

  return (
    <div className="flex flex-col gap-4">
      {!travaLigada ? (
        <Callout tom="info" titulo="A trava de acesso está desligada">
          Hoje todo mundo entra no painel, com ou sem liberação. O que você liberar ou revogar aqui passa a valer quando a
          trava for ligada.
        </Callout>
      ) : null}

      <section aria-label="Usuários do xcart" className="min-w-0 rounded-card border border-border bg-surface">
        <div className="flex flex-wrap items-center gap-3 border-b border-border-subtle px-4 py-3">
          <Segmented<FiltroAcesso>
            rotulo="Filtrar por acesso"
            valor={filtros.acesso}
            onValorChange={(acesso) => mudarFiltros({ acesso })}
            tamanho="md"
            opcoes={[
              { valor: "todos", rotulo: `Todos (${todos.length})` },
              { valor: "com", rotulo: `Com acesso (${contagem.com})` },
              { valor: "sem", rotulo: `Sem acesso (${contagem.sem})` },
            ]}
          />
          <Segmented<FiltroPlano>
            rotulo="Filtrar por plano"
            valor={filtros.plano}
            onValorChange={(plano) => mudarFiltros({ plano })}
            tamanho="md"
            opcoes={[
              { valor: "todos", rotulo: "Todo plano" },
              { valor: "pro", rotulo: `Pro (${contagem.pro})` },
              { valor: "free", rotulo: `Free (${contagem.free})` },
            ]}
          />
          <div className="relative min-w-48 flex-1 sm:max-w-72">
            <SearchIcon
              aria-hidden
              className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-t3"
            />
            <Input
              type="search"
              value={filtros.busca}
              onChange={(e) => mudarFiltros({ busca: e.target.value })}
              aria-label="Buscar por e-mail ou loja"
              placeholder="Buscar por e-mail ou loja"
              className="h-ctl-md pl-8 text-dense"
            />
          </div>
          {filtrando ? (
            <Button variant="link" size="sm" onClick={() => mudarFiltros(FILTROS_PADRAO)}>
              Limpar filtros
            </Button>
          ) : null}
        </div>

        <DataTable
          legenda={filtrando ? "Usuários filtrados" : "Todos os usuários"}
          colunas={colunas}
          linhas={linhas}
          densidade="confortavel"
          ordenacaoInicial={[{ chave: "cadastroTexto", direcao: "desc" }]}
          className="[&>ul]:pt-3"
          vazio={
            <EmptyState
              variante="simples"
              className="min-h-45"
              titulo="Nenhum usuário com esses filtros"
              descricao="Busque por outro e-mail ou mostre todos."
              acao={
                <Button variant="secondary" onClick={() => mudarFiltros(FILTROS_PADRAO)}>
                  Limpar filtros
                </Button>
              }
            />
          }
        />

        <p className="num border-t border-border-subtle px-4 py-2.5 text-label text-t2">
          {filtrando ? `${inteiro(linhas.length)} de ${inteiro(todos.length)} usuários · ` : ""}
          Custo de IA do mês corrente, em reais pelo câmbio de relatório · atualizado às {hora(lidoEm)}
        </p>
      </section>

      <DialogoPlanoCreditos usuario={editando} aberto={dialogo} aoMudarAberto={setDialogo} aoMudar={aplicar} />
      {acesso.dialogo}
    </div>
  );
}
