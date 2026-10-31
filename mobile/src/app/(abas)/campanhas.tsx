import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { BackHandler, FlatList, RefreshControl, View } from "react-native";
import { useFocusEffect } from "expo-router";
import { Cartao, Carregando, Campo, EstadoErro, EstadoVazio, Tela, Texto } from "@/components/ui";
import { SeletorFiltro } from "@/components/dashboard/seletor-filtro";
import { avisar, confirmar } from "@/components/campanhas/confirmar";
import { ChipRemovivel, Pilula, Segmentado } from "@/components/campanhas/controles";
import { EditarObjeto } from "@/components/campanhas/editar-objeto";
import { LinhaCampanhaCartao } from "@/components/campanhas/linha-campanha";
import {
  caminhoDaLista,
  contasSemDetalhe,
  fraseDoErro,
  idParaAbrir,
  nivelEditavel,
  type NivelLista,
  type StatusLista,
} from "@/components/campanhas/regras";
import { TotalCampanhas } from "@/components/campanhas/total-campanhas";
import { chamar, ErroApi, PRAZO_LONGO_MS } from "@/lib/api";
import { useFiltro } from "@/lib/filtro";
import { ESPACO, useCores } from "@/lib/tema";
import type { Campanhas, LinhaCampanha, ObjetoAoVivo } from "@/lib/tipos";

// ============================================================================
// Aba Campanhas: a mesma leitura da tela do site (/api/app/v1/campanhas, com
// loja/periodo/moeda do filtro do topo) em lista de cartoes, com a edicao
// basica do Meta -- ligar/pausar na linha e o Editar (orcamento, lance, ROAS
// minimo). Tocar numa campanha abre os conjuntos dela; o chip volta.
// ============================================================================

const NIVEIS: { id: NivelLista; rotulo: string }[] = [
  { id: "campanha", rotulo: "Campanhas" },
  { id: "grupo", rotulo: "Conjuntos" },
  { id: "anuncio", rotulo: "Anúncios" },
];

const STATUS: { id: StatusLista; rotulo: string }[] = [
  { id: "qualquer", rotulo: "Todas" },
  { id: "ativa", rotulo: "Ativas" },
  { id: "pausada", rotulo: "Pausadas" },
];

const VAZIO: Record<NivelLista, string> = {
  campanha: "Nenhuma campanha",
  grupo: "Nenhum conjunto",
  anuncio: "Nenhum anúncio",
};

/** Busca espera o lojista parar de digitar: cada pedido refaz a leitura inteira no servidor. */
const ESPERA_DA_BUSCA_MS = 450;

type Resposta = Campanhas & { ok: true };

export default function TelaCampanhas() {
  const c = useCores();
  const { filtro, erro: erroFiltro, recarregar: recarregarFiltro } = useFiltro();

  const [nivel, setNivel] = useState<NivelLista>("campanha");
  const [status, setStatus] = useState<StatusLista>("qualquer");
  const [texto, setTexto] = useState("");
  const [busca, setBusca] = useState("");
  const [campanha, setCampanha] = useState<{ id: string; nome: string } | null>(null);

  // Os dados e o erro guardam a chave do pedido: trocar de nivel nao mostra a
  // lista do nivel anterior enquanto a nova chega.
  const [dados, setDados] = useState<{ chave: string; r: Resposta } | null>(null);
  const [erro, setErro] = useState<{ chave: string; mensagem: string } | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [atualizando, setAtualizando] = useState(false);
  const [volta, setVolta] = useState(0);

  const [editando, setEditando] = useState<LinhaCampanha | null>(null);
  // Status pedido ao Meta e ainda sem resposta, por linha.
  const [pendentes, setPendentes] = useState<Record<string, string>>({});
  // O status que o Meta devolveu, ate a lista nova trazer a linha mudada. Preso
  // ao status de ANTES: se o periodo nao inclui hoje, o retrato que o servidor
  // corrige nao e o que a linha mostra, e a recarga traria o velho.
  const [feitos, setFeitos] = useState<Record<string, { de: string | null; para: string }>>({});

  const lista = useRef<FlatList<LinhaCampanha>>(null);

  useEffect(() => {
    const t = setTimeout(() => setBusca(texto.trim()), ESPERA_DA_BUSCA_MS);
    return () => clearTimeout(t);
  }, [texto]);

  const caminho = caminhoDaLista({ nivel, status, busca, campanhaId: campanha?.id ?? null });
  const chave = filtro ? `${caminho}|${filtro.loja}|${filtro.periodo}|${filtro.moeda}|${filtro.comparar}` : null;

  useEffect(() => {
    if (!filtro || !chave) return;
    let vivo = true;
    setCarregando(true);
    chamar<Resposta>(caminho, { filtro })
      .then((r) => {
        if (!vivo) return;
        setDados({ chave, r });
        setErro(null);
      })
      .catch((e: unknown) => {
        if (vivo) setErro({ chave, mensagem: e instanceof ErroApi ? e.message : "Não conseguimos abrir as campanhas agora. Tente de novo." });
      })
      .finally(() => {
        if (!vivo) return;
        setCarregando(false);
        setAtualizando(false);
      });
    return () => {
      vivo = false;
    };
    // `chave` ja carrega o caminho e o filtro inteiro: mudar o filtro recarrega.
  }, [chave, volta]);

  const recarregar = useCallback(() => setVolta((v) => v + 1), []);
  const puxar = useCallback(() => {
    // Sem filtro (a conta nao abriu), quem tem o que recarregar e o filtro.
    if (!filtro) {
      recarregarFiltro();
      return;
    }
    setAtualizando(true);
    setVolta((v) => v + 1);
  }, [filtro, recarregarFiltro]);

  const voltarParaCampanhas = useCallback(() => {
    setCampanha(null);
    setNivel("campanha");
  }, []);

  // Voltar do Android com a campanha aberta tira o filtro, em vez de sair do app.
  useFocusEffect(
    useCallback(() => {
      if (!campanha) return;
      const s = BackHandler.addEventListener("hardwareBackPress", () => {
        voltarParaCampanhas();
        return true;
      });
      return () => s.remove();
    }, [campanha, voltarParaCampanhas])
  );

  const abrir = useCallback((linha: LinhaCampanha) => {
    const id = idParaAbrir(linha);
    if (!id) return;
    setCampanha({ id, nome: linha.nome });
    setNivel("grupo");
    lista.current?.scrollToOffset({ offset: 0, animated: false });
  }, []);

  const alternar = useCallback(
    async (linha: LinhaCampanha, ligar: boolean) => {
      const nivelEd = nivelEditavel(linha);
      if (!nivelEd) return;
      const verbo = ligar ? "Ativar" : "Pausar";
      const seguir = await confirmar(
        `${verbo} ${linha.nome} no Meta?`,
        ligar ? "Volta a rodar e a gastar." : "Para de rodar e de gastar até ser ativado de novo.",
        verbo
      );
      if (!seguir) return;
      const valor = ligar ? "ACTIVE" : "PAUSED";
      setPendentes((p) => ({ ...p, [linha.id]: valor }));
      try {
        const r = await chamar<{ ok: true; objeto: ObjetoAoVivo }>("/api/ads/meta/alterar", {
          metodo: "POST",
          corpo: { conta: linha.contaId, nivel: nivelEd, id: linha.objetoId, campo: "status", valor, esperado: null },
          prazoMs: PRAZO_LONGO_MS,
        });
        setFeitos((f) => ({ ...f, [linha.id]: { de: linha.status, para: r.objeto.efetivo || r.objeto.status } }));
        recarregar();
      } catch (e) {
        avisar(ligar ? "Não deu para ativar" : "Não deu para pausar", fraseDoErro(e));
        // Demorou ou caiu no meio: a mudanca pode ter entrado no Meta.
        recarregar();
      } finally {
        setPendentes((p) => {
          const resto = { ...p };
          delete resto[linha.id];
          return resto;
        });
      }
    },
    [recarregar]
  );

  const aoSalvo = useCallback(
    (linha: LinhaCampanha, objeto: ObjetoAoVivo) => {
      setEditando(null);
      const para = objeto.efetivo || objeto.status;
      if (para && para !== linha.status) setFeitos((f) => ({ ...f, [linha.id]: { de: linha.status, para } }));
      recarregar();
    },
    [recarregar]
  );

  const atual = dados && dados.chave === chave ? dados.r : null;
  const erroAtual = erro && erro.chave === chave ? erro.mensagem : null;
  const mostrarErro = Boolean(erroAtual) && !carregando;
  const linhas = atual && !mostrarErro ? atual.linhas : [];
  const contraEntrega = atual?.avisos.contraEntrega ?? false;
  const moeda = atual?.moeda ?? filtro?.moeda ?? "BRL";
  const podeAbrir = nivel === "campanha";

  const statusDe = useCallback(
    (linha: LinhaCampanha) => {
      const f = feitos[linha.id];
      return f && f.de === linha.status ? f.para : linha.status;
    },
    [feitos]
  );

  const renderItem = useCallback(
    ({ item }: { item: LinhaCampanha }) => (
      <LinhaCampanhaCartao
        linha={item}
        moeda={moeda}
        contraEntrega={contraEntrega}
        status={statusDe(item)}
        pendente={pendentes[item.id] ?? null}
        aoAbrir={podeAbrir && idParaAbrir(item) ? abrir : undefined}
        aoAlternar={alternar}
        aoEditar={setEditando}
      />
    ),
    [moeda, contraEntrega, statusDe, pendentes, podeAbrir, abrir, alternar]
  );

  const semDetalhe = atual && !mostrarErro ? contasSemDetalhe(atual.avisos.semDetalhe) : [];
  const extra = useMemo(() => ({ pendentes, feitos }), [pendentes, feitos]);

  const cabecalho = (
    <View style={{ gap: ESPACO[3], marginBottom: ESPACO[3] }}>
      <Texto variante="titulo">Campanhas</Texto>
      <SeletorFiltro />
      <Segmentado
        rotulo="Nível"
        opcoes={NIVEIS}
        valor={nivel}
        aoMudar={(v) => {
          if (v !== nivel) setNivel(v);
        }}
      />
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: ESPACO[2] }}>
        {STATUS.map((s) => (
          <Pilula key={s.id} texto={s.rotulo} ativo={status === s.id} aoTocar={() => setStatus(s.id)} />
        ))}
      </View>
      <Campo
        rotulo="Buscar"
        placeholder="Nome, conta ou ID"
        value={texto}
        onChangeText={setTexto}
        onSubmitEditing={() => setBusca(texto.trim())}
        returnKeyType="search"
        autoCapitalize="none"
        autoCorrect={false}
        clearButtonMode="while-editing"
        accessibilityLabel="Buscar por nome, conta ou ID"
      />
      {campanha ? <ChipRemovivel rotulo="Campanha" valor={campanha.nome} aoRemover={voltarParaCampanhas} /> : null}

      {atual && !mostrarErro && atual.avisos.moedasSemCotacao.length > 0 ? (
        <Cartao estilo={{ backgroundColor: c.warnBg, borderColor: c.warn, padding: ESPACO[3] }}>
          <Texto variante="rotulo" cor={c.warn}>
            Sem cotação para {atual.avisos.moedasSemCotacao.join(", ")}: os valores nessas moedas ficaram de fora.
          </Texto>
        </Cartao>
      ) : null}
      {semDetalhe.length > 0 ? (
        <Cartao estilo={{ padding: ESPACO[3] }}>
          <Texto variante="rotulo" cor={c.t2}>
            Conjuntos e anúncios só aparecem nos dias com detalhe sincronizado. Sem detalhe no período:{" "}
            {semDetalhe
              .map((s) => (atual?.avisos.diasNoPeriodo ? `${s.contaNome} (${s.dias} de ${atual.avisos.diasNoPeriodo} dias)` : s.contaNome))
              .join(", ")}
            . Nesses dias o gasto e as vendas contam só na campanha.
          </Texto>
        </Cartao>
      ) : null}

      {atual && !mostrarErro && atual.total && atual.linhas.length > 0 ? (
        <TotalCampanhas
          total={atual.total}
          nivel={nivel}
          moeda={moeda}
          periodo={atual.periodo}
          contraEntrega={contraEntrega}
          sincronizadoEm={atual.avisos.sincronizadoEm}
        />
      ) : null}
    </View>
  );

  let vazio: ReactNode;
  if (!filtro) {
    vazio = erroFiltro ? <EstadoErro mensagem={erroFiltro} aoTentar={recarregarFiltro} /> : <Carregando />;
  } else if (mostrarErro && erroAtual) {
    vazio = <EstadoErro mensagem={erroAtual} aoTentar={recarregar} />;
  } else if (!atual) {
    vazio = <Carregando texto="Lendo as campanhas…" />;
  } else if (atual.contas.length === 0) {
    vazio = (
      <EstadoVazio
        titulo="Nenhuma conta de anúncio"
        texto="Conecte o Meta, o Google ou o TikTok em Integrações no site do Panda Track para ver as campanhas aqui."
      />
    );
  } else {
    const filtrando = Boolean(busca) || status !== "qualquer" || Boolean(campanha);
    vazio = (
      <EstadoVazio
        titulo={VAZIO[nivel]}
        texto={
          filtrando
            ? "Nada bate com este filtro no período. Mude a busca, o status ou o período."
            : "Nada com gasto ou venda neste período. Escolha outro período no topo."
        }
      />
    );
  }

  return (
    <Tela rolar={false} estilo={{ padding: 0, gap: 0 }}>
      <FlatList
        ref={lista}
        data={linhas}
        keyExtractor={(l) => l.id}
        renderItem={renderItem}
        extraData={extra}
        ListHeaderComponent={cabecalho}
        ListEmptyComponent={vazio}
        ItemSeparatorComponent={Separador}
        contentContainerStyle={{ padding: ESPACO[4], paddingBottom: ESPACO[8] }}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        initialNumToRender={8}
        windowSize={7}
        refreshControl={<RefreshControl refreshing={atualizando} onRefresh={puxar} tintColor={c.brand} colors={[c.brand]} />}
      />
      <EditarObjeto linha={editando} aoFechar={() => setEditando(null)} aoSalvo={aoSalvo} />
    </Tela>
  );
}

function Separador() {
  return <View style={{ height: ESPACO[3] }} />;
}
