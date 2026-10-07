import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeftIcon } from "lucide-react";
import { cn } from "@/components/ui/cn";
import { StatusBadge } from "@/components/ui/status-badge";
import { getRouteGraph, type GraphRoute, type RouteGraph } from "@/lib/checkout-routes/graph";
import { quandoFoi } from "@/lib/leitura/lojas-estado";
import { conferirLeituraDasRotas, lerUltimoSinalDoScript } from "@/lib/leitura/roteamento";
import { AbaDiagnostico } from "./aba-diagnostico";
import { AbaInstalacao } from "./aba-instalacao";
import { AbaLojas } from "./aba-lojas";
import { AbaVisao } from "./aba-visao";
import { AbasRota } from "./abas-rota";
import { AcoesRota } from "./acoes-rota";
import { ErroConsole, SemRotas } from "./estados";
import { ListaRotas, type ResumoRota } from "./lista-rotas";
import { SELO_ROTA, estadoDaRota, lojasRecebendo } from "./logica";

/** O relogio do servidor, lido fora do corpo do componente. */
function instante(): number {
  return Date.now();
}

/**
 * O console: lista de rotas a esquerda, detalhe com abas a direita. Tudo vem
 * do grafo que o servidor monta (o mesmo de sempre); depois de qualquer acao
 * a tela pede router.refresh() e o grafo volta novo -- e por isso a rota
 * recem-criada aparece sem recarregar.
 */
export async function Console({
  rotaParam,
  conferir,
  origem,
}: {
  rotaParam: string | null;
  conferir: boolean;
  origem: string;
}) {
  let grafo: RouteGraph;
  try {
    grafo = await getRouteGraph();
    // O grafo devolve vazio quando o banco falha: so confia no vazio depois
    // de conferir que a leitura funciona.
    if (grafo.routes.length === 0) await conferirLeituraDasRotas();
  } catch (erro) {
    console.error("[rotas] falha ao ler o grafo", erro);
    return <ErroConsole />;
  }

  if (grafo.routes.length === 0) return <SemRotas lojas={grafo.stores.length} />;

  const rota = rotaParam ? grafo.routes.find((r) => r.id === rotaParam) : grafo.routes[0];
  if (!rota) notFound();

  // O sinal do script (Visao e Instalacao) e lido sempre: e uma consulta com
  // limit 1, e as abas trocam no navegador, sem voltar ao servidor.
  let sinal = { em: null as string | null, erro: false };
  try {
    sinal = { em: await lerUltimoSinalDoScript(rota.id), erro: false };
  } catch (erro) {
    console.error("[rotas] sinal do script", erro);
    sinal = { em: null, erro: true };
  }

  return (
    <ConsoleView
      grafo={grafo}
      rota={rota}
      rotaParam={rotaParam}
      conferir={conferir}
      origem={origem}
      sinal={sinal}
      agora={instante()}
    />
  );
}

/** O desenho do console, so com dados: da para renderizar com qualquer estado. */
export function ConsoleView({
  grafo,
  rota,
  rotaParam,
  conferir,
  origem,
  sinal,
  agora,
}: {
  grafo: RouteGraph;
  rota: GraphRoute;
  rotaParam: string | null;
  conferir: boolean;
  origem: string;
  sinal: { em: string | null; erro: boolean };
  agora: number;
}) {
  const lojas = new Map(grafo.stores.map((s) => [s.id, s]));
  const vitrine = lojas.get(rota.sourceStoreId);

  const resumo: ResumoRota[] = grafo.routes.map((r) => ({
    id: r.id,
    nome: r.name,
    estado: estadoDaRota(r, agora),
    recebendo: lojasRecebendo(r),
    total: r.targets.length,
    carrinhos: r.routedCount30d,
  }));
  const estado = estadoDaRota(rota, agora);
  const recebendo = lojasRecebendo(rota);

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(240px,300px)_minmax(0,1fr)] lg:items-start">
      <ListaRotas rotas={resumo} selecionada={rota.id} esconderNoCelular={Boolean(rotaParam)} />

      <section
        aria-labelledby="rota-titulo"
        className={cn("flex min-w-0 flex-col gap-4", !rotaParam && "hidden lg:flex")}
      >
        <Link
          href="/clone/routed-checkout"
          className="inline-flex items-center gap-1 self-start rounded-sm text-dense font-medium text-brand underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus lg:hidden"
        >
          <ChevronLeftIcon aria-hidden className="size-4" />
          Todas as rotas
        </Link>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex min-w-0 flex-col gap-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <h2 id="rota-titulo" className="text-section break-words text-ink">
                {rota.name}
              </h2>
              <StatusBadge {...SELO_ROTA[estado]} />
            </div>
            <p className="text-dense text-t2">
              {vitrine?.name || "Vitrine removida"} → {recebendo} de{" "}
              {rota.targets.length === 1 ? "1 loja de checkout" : `${rota.targets.length} lojas de checkout`} recebendo
              comprador
            </p>
          </div>
          <AcoesRota id={rota.id} nome={rota.name} ligada={rota.enabled} />
        </div>

        <AbasRota
          rotaId={rota.id}
          conteudo={{
            visao: <AbaVisao rota={rota} lojas={lojas} sinal={sinal} origem={origem} agora={agora} />,
            lojas: (
              <AbaLojas
                rotaId={rota.id}
                rotaLigada={rota.enabled}
                vitrineId={rota.sourceStoreId}
                estrategia={rota.rotationStrategy}
                token={rota.publicToken}
                origem={origem}
                lojas={rota.targets.map((t) => ({
                  id: t.id,
                  storeId: t.storeId,
                  nome: lojas.get(t.storeId)?.name || "Loja removida",
                  dominio: lojas.get(t.storeId)?.shopDomain || "",
                  enabled: t.enabled,
                  weight: t.weight,
                  sharePercent: t.sharePercent,
                  mappedSkuCount: t.mappedSkuCount,
                  dailyLimit: t.dailyLimit,
                  orders24h: t.orders24h,
                  legacy: t.legacy,
                }))}
                disponiveis={grafo.stores
                  .filter((s) => s.id !== rota.sourceStoreId && !rota.targets.some((t) => t.storeId === s.id))
                  .map((s) => ({ id: s.id, nome: s.name || s.shopDomain, dominio: s.shopDomain }))}
              />
            ),
            diagnostico: (
              <AbaDiagnostico
                rotaId={rota.id}
                conferirAoAbrir={conferir}
                lojaCheckout={
                  rota.targets.length === 1
                    ? lojas.get(rota.targets[0].storeId)?.name || "a loja de checkout"
                    : "uma das lojas de checkout"
                }
                ultimaChecagem={
                  rota.lastHeal
                    ? {
                        quando: quandoFoi(rota.lastHeal.at, new Date(agora)),
                        ok: rota.lastHeal.ok,
                        mensagem: rota.lastHeal.message ?? null,
                      }
                    : null
                }
              />
            ),
            instalacao: <AbaInstalacao rota={rota} vitrine={vitrine} sinal={sinal} origem={origem} agora={agora} />,
          }}
        />
      </section>
    </div>
  );
}
