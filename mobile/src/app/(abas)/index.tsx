import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Cartao, Carregando, EstadoErro, EstadoVazio, Tela, Texto } from "@/components/ui";
import { Destaque, GradeMetricas } from "@/components/dashboard/cartao-metrica";
import { GraficoLucro } from "@/components/dashboard/grafico-lucro";
import { ListaPendencias } from "@/components/dashboard/pendencias";
import { ListaPorLoja } from "@/components/dashboard/por-loja";
import { SeletorFiltro } from "@/components/dashboard/seletor-filtro";
import { chamar, ErroApi } from "@/lib/api";
import { useFiltro } from "@/lib/filtro";
import { useSessao } from "@/lib/sessao";
import { ESPACO, useCores } from "@/lib/tema";
import type { Dashboard, Filtro, Serie } from "@/lib/tipos";

// ============================================================================
// O Dashboard no celular: o mesmo painel do site (GET /api/app/v1/dashboard,
// textos prontos de painelDoApp) e o grafico do lucro por dia
// (/api/app/v1/dashboard/serie). As duas rotas leem o filtro dos cabecalhos
// x-xc-* e saem juntas a cada troca de filtro e no puxar para atualizar.
//
// Erro nunca vira zero: o painel que falha vira "Tentar de novo" no lugar dos
// numeros, e o grafico que falha sozinho vira o erro so no lugar dele.
// ============================================================================

type Busca<T> = { estado: "carregando" } | { estado: "ok"; dados: T } | { estado: "erro"; erro: string };

/**
 * Uma rota que depende do filtro. Refaz quando o filtro muda DE VALOR (o
 * objeto muda a cada escolha, mesmo igual); resposta de um filtro antigo que
 * chega depois da nova e descartada pelo numero do pedido.
 */
function useBusca<T>(caminho: string, filtro: Filtro | null, fraseDeErro: string) {
  const [busca, setBusca] = useState<Busca<T>>({ estado: "carregando" });
  const numero = useRef(0);
  const chave = filtro ? `${filtro.loja}|${filtro.periodo}|${filtro.moeda}|${filtro.comparar}` : null;
  // O filtro em vigor para o puxar para atualizar e o "Tentar de novo", sem
  // recriar `buscar` a cada objeto novo do mesmo filtro. Declarado antes do
  // efeito da busca: os efeitos rodam em ordem, e a busca ja le o novo.
  const filtroAtual = useRef(filtro);
  useEffect(() => {
    filtroAtual.current = filtro;
  }, [filtro]);

  const buscar = useCallback(
    async (manterNaTela: boolean) => {
      const f = filtroAtual.current;
      if (!f) return;
      const n = ++numero.current;
      // No puxar para atualizar os numeros ficam ate a resposta; na troca de
      // filtro, nao: seriam numeros de outra loja ou outro periodo.
      if (!manterNaTela) setBusca({ estado: "carregando" });
      try {
        const r = await chamar<T & { ok: true }>(caminho, { filtro: f });
        if (n === numero.current) setBusca({ estado: "ok", dados: r });
      } catch (e) {
        if (n === numero.current) setBusca({ estado: "erro", erro: e instanceof ErroApi ? e.message : fraseDeErro });
      }
    },
    [caminho, fraseDeErro]
  );

  useEffect(() => {
    if (chave) void buscar(false);
  }, [chave, buscar]);

  return { busca, buscar };
}

export default function TelaDashboard() {
  const c = useCores();
  const { eu, filtro, erro: erroDaConta, carregando: carregandoConta, recarregar: recarregarConta } = useFiltro();
  const { email } = useSessao();
  const painel = useBusca<Dashboard>("/api/app/v1/dashboard", filtro, "Não conseguimos carregar o Dashboard agora.");
  const serie = useBusca<Serie>("/api/app/v1/dashboard/serie", filtro, "O gráfico do lucro não carregou agora.");
  const [atualizando, setAtualizando] = useState(false);

  const buscarPainel = painel.buscar;
  const buscarSerie = serie.buscar;

  const atualizar = useCallback(async () => {
    // Sem a conta (/eu falhou) nao ha filtro: puxar tenta a conta de novo.
    if (!eu) {
      recarregarConta();
      return;
    }
    setAtualizando(true);
    await Promise.all([buscarPainel(true), buscarSerie(true)]);
    setAtualizando(false);
  }, [eu, recarregarConta, buscarPainel, buscarSerie]);

  const tentarDeNovo = useCallback(() => {
    void buscarPainel(false);
    void buscarSerie(false);
  }, [buscarPainel, buscarSerie]);

  const nome = eu?.usuario.nome ?? eu?.usuario.email ?? email;
  const p = painel.busca;
  const vazio = p.estado === "ok" && p.dados.vazio;

  let corpo: ReactNode;
  if (!eu) {
    corpo = carregandoConta ? (
      <Carregando texto="Abrindo sua conta…" />
    ) : (
      <EstadoErro mensagem={erroDaConta ?? "Não deu para abrir a sua conta agora."} aoTentar={recarregarConta} />
    );
  } else if (p.estado === "carregando") {
    corpo = <Carregando texto="Carregando o lucro…" />;
  } else if (p.estado === "erro") {
    corpo = <EstadoErro mensagem={p.erro} aoTentar={tentarDeNovo} />;
  } else if (p.dados.vazio) {
    corpo = (
      <EstadoVazio
        titulo="Conecte uma loja"
        texto="A conexão da loja Shopify ou do checkout é feita no site do Panda Track, pelo computador. Assim que ela terminar, puxe esta tela para baixo e os números aparecem aqui."
      />
    );
  } else {
    const d = p.dados;
    const s = serie.busca;
    const leitura = [d.leitura.rotulo, d.leitura.hora].filter(Boolean).join(" · ");
    corpo = (
      <>
        {leitura ? (
          <Texto variante="rotulo" cor={c.t3}>
            {leitura}
          </Texto>
        ) : null}

        <ListaPendencias pendencias={d.pendencias} />

        <Destaque cartao={d.principal} periodo={d.periodo.porExtenso} />

        {s.estado === "erro" ? (
          <EstadoErro mensagem={s.erro} aoTentar={() => void buscarSerie(false)} />
        ) : s.estado === "carregando" ? (
          <Cartao>
            <Texto variante="subtitulo">{`${d.grafico.lucro} por dia`}</Texto>
            <Carregando texto="Carregando o gráfico…" />
          </Cartao>
        ) : s.dados.vazio ? null : (
          <Cartao estilo={{ gap: ESPACO[1] }}>
            <Texto variante="subtitulo">{`${d.grafico.lucro} por dia`}</Texto>
            {s.dados.atual.length > 0 ? (
              <GraficoLucro pontos={s.dados.atual} moeda={s.dados.moeda} titulo={`${d.grafico.lucro} por dia`} />
            ) : (
              <Texto variante="denso" cor={c.t2}>
                Sem dias para mostrar neste período.
              </Texto>
            )}
          </Cartao>
        )}

        <GradeMetricas cartoes={d.cartoes} />

        <ListaPorLoja lojas={d.porLoja} />
      </>
    );
  }

  return (
    <Tela atualizando={atualizando} aoAtualizar={atualizar}>
      {nome ? (
        <Texto variante="denso" cor={c.t2} linhas={1}>
          {`Olá, ${nome}`}
        </Texto>
      ) : null}
      {/* Sem loja nem checkout nao ha o que filtrar. */}
      {eu && !vazio ? <SeletorFiltro /> : null}
      {corpo}
    </Tela>
  );
}
