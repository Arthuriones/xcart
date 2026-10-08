import Link from "next/link";
import { Section } from "@/components/ui/section";
import { StatusBadge } from "@/components/ui/status-badge";
import { quandoFoi } from "@/lib/leitura/lojas-estado";
import type { GraphRoute, GraphStore } from "@/lib/checkout-routes/graph";
import { Instalador } from "./instalar";
import { estadoDoTema, estadoInstalacao, hrefRota } from "./logica";

/** Aba Instalacao: o estado do script na vitrine, instalar automatico e o codigo manual. */
export function AbaInstalacao({
  rota,
  vitrine,
  sinal,
  origem,
  agora,
}: {
  rota: GraphRoute;
  vitrine: GraphStore | undefined;
  sinal: { em: string | null; erro: boolean };
  origem: string;
  agora: number;
}) {
  const estado = estadoInstalacao(sinal.em, sinal.erro);
  const quando = quandoFoi(sinal.em, new Date(agora));
  const tema = estadoDoTema(rota.themeSync);
  const quandoTema = rota.themeSync ? quandoFoi(rota.themeSync.at, new Date(agora)) : null;

  return (
    <div className="flex flex-col gap-4">
      <Section
        titulo="Script na vitrine"
        descricao={`O xcart escreve o script no tema de ${vitrine?.name || "sua vitrine"}. Depois disso, a divisão, as lojas e o mapa de produtos vão para o tema sozinhos sempre que mudam.`}
      >
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <StatusBadge tom={estado.tom} texto={estado.texto} tamanho="md" />
          <span className="text-dense text-t1">
            {sinal.erro
              ? "Não deu para ler o sinal do script agora."
              : quando
                ? `Último sinal da vitrine: ${quando}.`
                : "Nenhum sinal nos últimos 30 dias."}
          </span>
        </div>
        {tema ? (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <StatusBadge
              tom={tema.tom}
              texto={tema.tom === "ok" ? "Tema em dia" : "Tema desatualizado"}
              tamanho="md"
            />
            <span className="text-dense text-t1">
              {tema.texto}
              {quandoTema ? ` Última conferência: ${quandoTema}.` : ""}
            </span>
          </div>
        ) : null}
        {!sinal.erro && !quando ? (
          <p className="text-dense text-t2 text-pretty">
            O sinal chega quando alguém abre um produto ou o carrinho da vitrine. Sem sinal, ou o script não
            está no tema, ou a vitrine não teve visita nesse tempo.
          </p>
        ) : null}
        <Instalador
          rotaId={rota.id}
          token={rota.publicToken}
          origem={origem}
          rotulo={sinal.em ? "Reinstalar na vitrine" : "Instalar na vitrine"}
        />
      </Section>

      <Section titulo="Depois de instalar" descricao="Confira com um carrinho de verdade antes de mandar tráfego.">
        <p className="text-dense text-t1 text-pretty">
          Abra a vitrine, ponha um produto no carrinho e finalize: você deve cair no checkout da loja de
          checkout. Se cair no checkout da própria vitrine, rode o teste da rota.
        </p>
        <Link
          href={hrefRota(rota.id, "diagnostico")}
          scroll={false}
          className="self-start rounded-sm text-dense font-medium text-brand underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
        >
          Ir para o diagnóstico
        </Link>
      </Section>
    </div>
  );
}
