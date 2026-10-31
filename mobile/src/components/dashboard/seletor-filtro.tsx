import { useState, type ComponentProps } from "react";
import { Pressable, ScrollView, View } from "react-native";
import Feather from "@expo/vector-icons/Feather";
import { Texto } from "@/components/ui";
import { nomeDoFiltro, useFiltro } from "@/lib/filtro";
import { ESPACO, useCores } from "@/lib/tema";
import type { Eu, Filtro } from "@/lib/tipos";
import { OpcaoDoPainel, PainelInferior } from "./painel-inferior";

// ============================================================================
// O seletor do topo do site, no celular: uma linha de "chips" (loja, periodo,
// moeda, comparacao) e, ao tocar num deles, o painel com as opcoes daquele
// grupo. Autocontido: le e grava pelo useFiltro, entao Dashboard e Campanhas
// mudam juntos e cada tela recarrega pelo proprio efeito.
//
// Personalizado (datas) fica fora no MVP: se a escolha guardada for um
// intervalo, o chip mostra as datas e o painel so oferece os presets.
// ============================================================================

type Grupo = "loja" | "periodo" | "moeda" | "comparar";
type Icone = ComponentProps<typeof Feather>["name"];

const TITULO: Record<Grupo, string> = {
  loja: "Loja",
  periodo: "Período",
  moeda: "Moeda do relatório",
  comparar: "Comparar com",
};

const ICONE: Record<Grupo, Icone> = {
  loja: "shopping-bag",
  periodo: "calendar",
  moeda: "dollar-sign",
  comparar: "repeat",
};

/** Nome por extenso das moedas do relatorio; a que nao estiver aqui vai so com o codigo. */
const NOME_MOEDA: Record<string, string> = {
  BRL: "Real brasileiro",
  USD: "Dólar americano",
  EUR: "Euro",
};

/** "2026-10-10_2026-10-14" -> "10/10–14/10" (o personalizado guardado de antes). */
function rotuloDatas(periodo: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})_(\d{4})-(\d{2})-(\d{2})$/.exec(periodo);
  if (!m) return periodo;
  const desde = `${m[3]}/${m[2]}`;
  const ate = `${m[6]}/${m[5]}`;
  return desde === ate ? desde : `${desde}–${ate}`;
}

function rotuloDoChip(eu: Eu, filtro: Filtro, grupo: Grupo): string {
  switch (grupo) {
    case "loja":
      return nomeDoFiltro(eu, filtro);
    case "periodo":
      return eu.periodos.find((p) => p.id === filtro.periodo)?.curto ?? rotuloDatas(filtro.periodo);
    case "moeda":
      return filtro.moeda;
    case "comparar": {
      const r = eu.comparacoes.find((x) => x.id === filtro.comparar)?.rotulo ?? filtro.comparar;
      // "Periodo anterior" sozinho no chip se confunde com o chip do periodo.
      return filtro.comparar === "nenhum" ? r : `vs. ${r.charAt(0).toLowerCase()}${r.slice(1)}`;
    }
  }
}

function Chip({ grupo, texto, aoTocar }: { grupo: Grupo; texto: string; aoTocar: () => void }) {
  const c = useCores();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${TITULO[grupo]}: ${texto}`}
      accessibilityHint="Abre as opções"
      onPress={aoTocar}
      style={({ pressed }) => ({
        minHeight: 44,
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
        paddingHorizontal: ESPACO[3],
        borderRadius: 999,
        borderWidth: 1,
        borderColor: c.border,
        backgroundColor: pressed ? c.hover : c.surface,
      })}
    >
      <Feather name={ICONE[grupo]} size={15} color={c.t2} />
      <Texto variante="denso" peso="media" linhas={1} estilo={{ maxWidth: 180 }}>
        {texto}
      </Texto>
      <Feather name="chevron-down" size={15} color={c.t3} />
    </Pressable>
  );
}

function Secao({ titulo }: { titulo: string }) {
  const c = useCores();
  return (
    <Texto variante="rotulo" cor={c.t2} estilo={{ marginTop: ESPACO[2] }}>
      {titulo.toUpperCase()}
    </Texto>
  );
}

/**
 * `sangria`: quanto a linha avanca sobre o recuo da tela, para os chips
 * rolarem ate a borda do celular em vez de sumirem no recuo. O padrao e o
 * recuo da <Tela> (ESPACO[4]); quem usar fora dela passa 0.
 */
export function SeletorFiltro({ sangria = ESPACO[4] }: { sangria?: number }) {
  const { eu, filtro, mudar } = useFiltro();
  // O grupo fica depois de fechar (so `visivel` muda): as opcoes somem junto
  // com o fade do painel, nao antes dele.
  const [aberto, setAberto] = useState<Grupo | null>(null);
  const [visivel, setVisivel] = useState(false);
  if (!eu || !filtro) return null;

  const grupos: Grupo[] = ["loja", "periodo", "moeda", "comparar"];

  function escolher(parte: Partial<Filtro>) {
    // Mesma opcao de novo nao muda nada: sem recarga a toa.
    const muda = (Object.keys(parte) as (keyof Filtro)[]).some((k) => parte[k] !== filtro?.[k]);
    if (muda) mudar(parte);
    setVisivel(false);
  }

  return (
    <View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={{ marginHorizontal: -sangria }}
        contentContainerStyle={{ paddingHorizontal: sangria, gap: ESPACO[2] }}
      >
        {grupos.map((g) => (
          <Chip
            key={g}
            grupo={g}
            texto={rotuloDoChip(eu, filtro, g)}
            aoTocar={() => {
              setAberto(g);
              setVisivel(true);
            }}
          />
        ))}
      </ScrollView>

      <PainelInferior
        visivel={visivel && aberto !== null}
        titulo={aberto ? TITULO[aberto] : ""}
        aoFechar={() => setVisivel(false)}
      >
        {aberto === "loja" ? (
          <>
            <OpcaoDoPainel
              titulo="Todas as lojas"
              apoio="Soma das lojas e checkouts"
              escolhida={filtro.loja === "todas"}
              aoTocar={() => escolher({ loja: "todas" })}
            />
            {eu.lojas.length > 0 ? <Secao titulo="Lojas" /> : null}
            {eu.lojas.map((l) => (
              <OpcaoDoPainel
                key={l.id}
                titulo={l.nome}
                apoio={l.dominio}
                escolhida={filtro.loja === l.id}
                aoTocar={() => escolher({ loja: l.id })}
              />
            ))}
            {eu.checkouts.length > 0 ? <Secao titulo="Checkouts" /> : null}
            {eu.checkouts.map((ck) => (
              <OpcaoDoPainel
                key={ck.id}
                titulo={ck.nome}
                apoio={ck.plataforma}
                escolhida={filtro.loja === ck.id}
                aoTocar={() => escolher({ loja: ck.id })}
              />
            ))}
          </>
        ) : null}

        {aberto === "periodo"
          ? eu.periodos.map((p) => (
              <OpcaoDoPainel
                key={p.id}
                titulo={p.rotulo}
                escolhida={filtro.periodo === p.id}
                aoTocar={() => escolher({ periodo: p.id })}
              />
            ))
          : null}

        {aberto === "moeda"
          ? eu.moedas.map((m) => (
              <OpcaoDoPainel
                key={m.id}
                titulo={m.rotulo}
                apoio={NOME_MOEDA[m.id] ?? null}
                escolhida={filtro.moeda === m.id}
                aoTocar={() => escolher({ moeda: m.id })}
              />
            ))
          : null}

        {aberto === "comparar"
          ? eu.comparacoes.map((x) => (
              <OpcaoDoPainel
                key={x.id}
                titulo={x.rotulo}
                apoio={x.id === "nenhum" ? "Só os números do período" : "Mostra quanto cada número subiu ou caiu"}
                escolhida={filtro.comparar === x.id}
                aoTocar={() => escolher({ comparar: x.id })}
              />
            ))
          : null}
      </PainelInferior>
    </View>
  );
}
