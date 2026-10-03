import { cn } from "@/components/ui/cn";
import { buttonVariants } from "@/components/ui/button";
import { BarList } from "@/components/ui/bar-list";
import { DataTable } from "@/components/ui/data-table";
import { EmptyState } from "@/components/ui/empty-state";
import { KpiCard } from "@/components/ui/kpi-card";
import { Section } from "@/components/ui/section";
import { STATUS, StatusBadge } from "@/components/ui/status-badge";
import type { DestinoAdmin } from "@/lib/leitura/admin-rotas";
import {
  custoIa,
  dataCurta,
  dataHora,
  divisaoDestinos,
  inteiro,
  naMoeda,
  plural,
  rotuloAcao,
  rotuloPlano,
  seloAcesso,
  statusAssinatura,
} from "../../formato";
import type { DetalheUsuarioAdmin } from "../../tipos";
import { CartaoGerenciar } from "./cartao-gerenciar";
import { Trilha } from "./trilha";

// Link com cara de botao passa pelo cn: o cva sozinho deixa border-transparent junto.
const LINK_EXTERNO = cn(buttonVariants({ variant: "secondary", size: "sm" }));
const LINK_SHOPIFY = cn(buttonVariants({ variant: "ghost", size: "sm" }));

/** O detalhe pronto, so com dados (a leitura fica no page.tsx). */
export function Detalhe({
  d,
  destinos,
  travaLigada,
}: {
  d: DetalheUsuarioAdmin;
  destinos: Record<string, DestinoAdmin[]> | null;
  travaLigada: boolean;
}) {
  const p = d.profile;
  const gerenciavel = {
    id: p.id,
    email: p.email,
    plan: p.plan,
    aiCredits: p.ai_credits,
    accessGranted: p.access_granted === true,
    isAdmin: p.is_admin === true,
  };
  const selo = seloAcesso(gerenciavel);
  const status = statusAssinatura(p.subscription_status);
  const nomeLoja = new Map(d.stores.map((s) => [s.id, s.name || s.shop_domain]));

  const recargas = d.purchases.map((c, i) => ({
    id: `${c.created_at}-${i}`,
    quando: Date.parse(c.created_at),
    quandoTexto: dataCurta(c.created_at),
    creditos: c.credits,
    creditosTexto: `+${inteiro(c.credits)}`,
    valor: c.amount_cents / 100,
    valorTexto: naMoeda(c.amount_cents / 100, c.currency),
  }));

  const uso = d.usage.map((u, i) => ({
    id: `${u.created_at}-${i}`,
    acao: rotuloAcao(u.action),
    creditos: Number(u.credits_used) || 0,
    creditosTexto: inteiro(Number(u.credits_used) || 0),
    custo: Number(u.cost_usd) || 0,
    custoTexto: custoIa(Number(u.cost_usd)),
    quando: Date.parse(u.created_at),
    quandoTexto: dataHora(u.created_at),
  }));

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3">
        <Trilha atual={p.email} />
        <div className="flex min-w-0 flex-col gap-2">
          <h1 className="text-page font-semibold break-all text-ink">{p.email}</h1>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-label text-t1">
            {p.is_admin ? <StatusBadge tom="info" texto="Admin" ponto={false} /> : null}
            <StatusBadge tom={selo.tom} texto={selo.texto} />
            <span>{selo.motivo}</span>
            <span aria-hidden className="text-t3">
              ·
            </span>
            <span>Cadastro em {dataCurta(p.created_at)}</span>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <KpiCard
          rotulo="Plano"
          valor={rotuloPlano(p.plan)}
          detalhe={
            [status, p.current_period_end ? `vale até ${dataCurta(p.current_period_end)}` : null]
              .filter(Boolean)
              .join(" · ") || undefined
          }
        />
        <KpiCard rotulo="Créditos" valor={inteiro(p.ai_credits)} detalhe="Saldo atual" />
        <KpiCard rotulo="Lojas" valor={inteiro(d.totals.stores)} />
        <KpiCard rotulo="Produtos" valor={inteiro(d.totals.products)} detalhe="Somando as lojas" />
        <KpiCard rotulo="Rotas" valor={inteiro(d.totals.routes)} className="col-span-2 sm:col-span-1" />
      </div>

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
        <div className="flex min-w-0 flex-col gap-4">
          <Section titulo="Lojas" descricao={plural(d.stores.length, "loja conectada", "lojas conectadas")}>
            {d.stores.length === 0 ? (
              <EmptyState
                variante="simples"
                titulo="Nenhuma loja conectada"
                descricao="As lojas aparecem quando o cliente conectar a primeira."
              />
            ) : (
              <ul className="grid gap-3 sm:grid-cols-2">
                {d.stores.map((s) => (
                  <li key={s.id} className="flex min-w-0 flex-col gap-2 rounded-card border border-border p-3">
                    <div className="flex min-w-0 items-start justify-between gap-2">
                      <div className="flex min-w-0 flex-col">
                        <span className="truncate text-dense font-semibold text-ink">{s.name || s.shop_domain}</span>
                        <span className="truncate font-mono text-label text-t2">{s.shop_domain}</span>
                      </div>
                      <span className="num shrink-0 text-label text-t1">
                        {plural(s.productCount, "produto", "produtos")}
                      </span>
                    </div>
                    {s.niche || s.target_language ? (
                      <span className="text-label text-t2">
                        {[s.niche, s.target_language ? `idioma ${s.target_language}` : null].filter(Boolean).join(" · ")}
                      </span>
                    ) : null}
                    <div className="mt-auto flex flex-wrap gap-2">
                      <a
                        href={`https://${s.shop_domain}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={LINK_EXTERNO}
                        aria-label={`Abrir a loja ${s.name || s.shop_domain} (outra aba)`}
                      >
                        Abrir loja ↗
                      </a>
                      <a
                        href={`https://${s.shop_domain}/admin`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={LINK_SHOPIFY}
                        aria-label={`Abrir ${s.name || s.shop_domain} no admin da Shopify (outra aba)`}
                      >
                        Admin da Shopify ↗
                      </a>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <Section
            titulo="Rotas de checkout"
            descricao={
              d.routes.length === 0
                ? "Este cliente não usa roteamento"
                : "Vitrine, lojas de checkout e a parte de cada uma no rodízio"
            }
          >
            {d.routes.length === 0 ? (
              <EmptyState
                variante="simples"
                titulo="Nenhuma rota"
                descricao="Quem anuncia direto na loja de checkout não precisa de rota."
              />
            ) : (
              <ul className="flex flex-col gap-3">
                {d.routes.map((rota) => {
                  const lista = destinos?.[rota.id] ?? null;
                  const partes = lista ? divisaoDestinos(lista) : {};
                  return (
                    <li key={rota.id} className="flex flex-col gap-3 rounded-card border border-border p-3">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="flex min-w-0 flex-col">
                          <span className="text-dense font-semibold text-ink">{rota.name || "Rota sem nome"}</span>
                          <span className="text-label text-t2">
                            Vitrine:{" "}
                            {(rota.source_store_id && nomeLoja.get(rota.source_store_id)) || rota.sourceName}
                          </span>
                        </div>
                        <StatusBadge {...(rota.enabled === false ? STATUS.rota.pausada : STATUS.rota.ativa)} />
                      </div>
                      {lista && lista.length > 0 ? (
                        <BarList
                          rotulo={`Lojas de checkout da rota ${rota.name || ""}`.trim()}
                          maximo={100}
                          itens={lista.map((dest) => {
                            const parte = partes[dest.id] ?? null;
                            return {
                              id: dest.id,
                              rotulo: dest.nome,
                              valor: parte ?? 0,
                              valorTexto: parte === null ? "fora do rodízio" : `${parte}%`,
                              cor: parte === null ? "t4" : "chart-2",
                            };
                          })}
                        />
                      ) : (
                        <p className="text-dense text-t1">
                          Loja de checkout: {rota.targetName}
                          {lista === null ? (
                            <span className="block text-label text-t2">
                              Não deu para ler a divisão do rodízio agora.
                            </span>
                          ) : null}
                        </p>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </Section>
        </div>

        <CartaoGerenciar usuario={gerenciavel} travaLigada={travaLigada} />
      </div>

      <Section
        titulo="Recargas"
        descricao={
          recargas.length === 0
            ? "Pacotes de crédito comprados"
            : `As ${plural(recargas.length, "compra mais nova", "compras mais novas")} de pacote de crédito`
        }
        espaco="nenhum"
      >
        <DataTable
          legenda={`Recargas de ${p.email}`}
          colunas={[
            { chave: "quandoTexto", titulo: "Data", ordenarPor: "quando", direcaoInicial: "desc" },
            { chave: "creditosTexto", titulo: "Créditos", alinhar: "direita", ordenarPor: "creditos" },
            { chave: "valorTexto", titulo: "Valor pago", alinhar: "direita", ordenarPor: "valor" },
          ]}
          linhas={recargas}
          vazio={
            <EmptyState
              variante="simples"
              className="min-h-32"
              titulo="Nenhuma recarga"
              descricao="As compras de pacote aparecem aqui."
            />
          }
        />
      </Section>

      <Section
        titulo="Uso de IA"
        descricao="As últimas 50 ações · custo em dólar, a moeda em que a IA é cobrada"
        espaco="nenhum"
      >
        <DataTable
          legenda={`Uso de IA de ${p.email}`}
          colunas={[
            { chave: "acao", titulo: "Ação" },
            { chave: "creditosTexto", titulo: "Créditos", alinhar: "direita", ordenarPor: "creditos" },
            { chave: "custoTexto", titulo: "Custo", alinhar: "direita", ordenarPor: "custo" },
            { chave: "quandoTexto", titulo: "Quando", ordenarPor: "quando", direcaoInicial: "desc" },
          ]}
          linhas={uso}
          alturaMaxima={480}
          vazio={
            <EmptyState
              variante="simples"
              className="min-h-32"
              titulo="Sem uso de IA registrado"
              descricao="Cada imagem, texto ou tradução feita com IA aparece aqui."
            />
          }
        />
      </Section>

      <EmptyState
        variante="tracejado"
        selo="Em breve"
        titulo="Notas internas e linha do tempo do cliente"
        descricao="Depende de dado novo no servidor; ainda não existe."
      />
    </div>
  );
}
