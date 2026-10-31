import { useState, type ComponentProps } from "react";
import { Pressable, View, useWindowDimensions } from "react-native";
import Feather from "@expo/vector-icons/Feather";
import { Botao, Cartao, Selo, Texto } from "@/components/ui";
import { ESPACO, useCores, type Cores } from "@/lib/tema";
import type { CartaoDoApp, VariacaoDoApp } from "@/lib/tipos";
import { PainelInferior } from "./painel-inferior";

// ============================================================================
// Os numeros do Dashboard: o destaque (lucro) e a grade de cartoes. Texto,
// variacao, linha e selo ja vem prontos do servidor (painelDoApp, os mesmos
// do site); aqui so se desenha. Tocar num cartao abre a definicao e as notas
// -- no site isso e o tooltip, que no celular nao existe.
// ============================================================================

type Icone = ComponentProps<typeof Feather>["name"];

const SETA: Record<VariacaoDoApp["direcao"], Icone> = {
  sobe: "arrow-up-right",
  desce: "arrow-down-right",
  estavel: "minus",
};

const FALA: Record<VariacaoDoApp["direcao"], string> = {
  sobe: "subiu",
  desce: "caiu",
  estavel: "estável",
};

function corDaVariacao(c: Cores, tom: VariacaoDoApp["tom"]): string {
  return tom === "ok" ? c.ok : tom === "err" ? c.err : c.t2;
}

/** Seta + "12,3%" na cor do tom. null = sem base no anterior; ausente = sem comparacao. */
export function Variacao({ variacao, grande }: { variacao: VariacaoDoApp | null | undefined; grande?: boolean }) {
  const c = useCores();
  if (variacao === undefined) return null;
  if (variacao === null) {
    return (
      <Texto variante="rotulo" cor={c.t3}>
        sem base
      </Texto>
    );
  }
  const cor = corDaVariacao(c, variacao.tom);
  return (
    <View
      accessible
      accessibilityLabel={variacao.direcao === "estavel" ? "estável" : `${FALA[variacao.direcao]} ${variacao.texto}`}
      style={{ flexDirection: "row", alignItems: "center", gap: 2 }}
    >
      <Feather name={SETA[variacao.direcao]} size={grande ? 16 : 13} color={cor} />
      <Texto variante={grande ? "denso" : "rotulo"} peso="seminegrito" cor={cor} numero>
        {variacao.texto}
      </Texto>
    </View>
  );
}

/** O conteudo do painel da definicao: numero, variacao, linha, definicao e notas. */
function DetalheMetrica({ cartao }: { cartao: CartaoDoApp }) {
  const c = useCores();
  return (
    <>
      <View style={{ gap: ESPACO[1] }}>
        <Texto variante="kpi" numero cor={cartao.negativo ? c.err : c.ink}>
          {cartao.texto}
        </Texto>
        <View style={{ flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: ESPACO[2] }}>
          <Variacao variacao={cartao.variacao} />
          {cartao.linha ? (
            <Texto variante="denso" cor={c.t2}>
              {cartao.linha}
            </Texto>
          ) : null}
        </View>
        {cartao.detalhe ? (
          <Texto variante="denso" cor={c.t2}>
            {cartao.detalhe}
          </Texto>
        ) : null}
        {cartao.selo ? <Selo texto={cartao.selo.texto} tom={cartao.selo.tom} /> : null}
      </View>
      <Texto variante="corpo" cor={c.t1}>
        {cartao.definicao}
      </Texto>
      {cartao.notas?.length ? (
        <View style={{ gap: ESPACO[2] }}>
          {cartao.notas.map((nota, i) => (
            <View key={i} style={{ flexDirection: "row", gap: ESPACO[2] }}>
              <Feather name="info" size={15} color={c.info} style={{ marginTop: 3 }} />
              <Texto variante="denso" cor={c.t1} estilo={{ flex: 1 }}>
                {nota}
              </Texto>
            </View>
          ))}
        </View>
      ) : null}
    </>
  );
}

/**
 * `cartao` fica preenchido depois de fechar (so `visivel` muda): o painel some
 * com o fade, e sem isso o conteudo sumiria antes dele.
 */
function PainelDaMetrica({
  cartao,
  visivel,
  aoFechar,
}: {
  cartao: CartaoDoApp | null;
  visivel: boolean;
  aoFechar: () => void;
}) {
  return (
    <PainelInferior visivel={visivel && cartao !== null} titulo={cartao?.rotulo ?? ""} aoFechar={aoFechar}>
      {cartao ? <DetalheMetrica cartao={cartao} /> : null}
      <Botao titulo="Fechar" tipo="secundario" aoTocar={aoFechar} />
    </PainelInferior>
  );
}

/** O numero em destaque (Lucro estimado, ou o previsto em contra entrega). */
export function Destaque({ cartao, periodo }: { cartao: CartaoDoApp; periodo: string }) {
  const c = useCores();
  const [aberto, setAberto] = useState(false);
  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${cartao.rotulo}: ${cartao.texto}`}
        accessibilityHint="Mostra como o número é calculado"
        onPress={() => setAberto(true)}
        style={({ pressed }) => ({ opacity: pressed ? 0.85 : 1 })}
      >
        <Cartao estilo={{ gap: ESPACO[1] }}>
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: ESPACO[2] }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flexShrink: 1 }}>
              <Texto variante="denso" peso="media" cor={c.t2}>
                {cartao.rotulo}
              </Texto>
              <Feather name="info" size={14} color={c.t3} />
            </View>
            {cartao.selo ? <Selo texto={cartao.selo.texto} tom={cartao.selo.tom} /> : null}
          </View>
          <Texto variante="display" numero cor={cartao.negativo ? c.err : c.ink} ajustar>
            {cartao.texto}
          </Texto>
          <View style={{ flexDirection: "row", alignItems: "center", flexWrap: "wrap", columnGap: ESPACO[2], rowGap: 2 }}>
            <Variacao variacao={cartao.variacao} grande />
            {cartao.linha ? (
              <Texto variante="denso" cor={c.t2}>
                {cartao.linha}
              </Texto>
            ) : null}
          </View>
          <Texto variante="rotulo" cor={c.t3}>
            {periodo}
          </Texto>
        </Cartao>
      </Pressable>
      <PainelDaMetrica cartao={cartao} visivel={aberto} aoFechar={() => setAberto(false)} />
    </>
  );
}

/**
 * Um tamanho para a grade inteira, pelo texto mais comprido: "R$ 123.456,78"
 * no kpi (22 px) nao cabe em meia tela de celular e quebraria no meio do
 * numero. Largura do cartao = (tela - recuo da Tela - vao) / 2 - recuo do
 * cartao; cada algarismo ocupa ~0,58 do tamanho da fonte.
 */
function varianteDaGrade(cartoes: CartaoDoApp[], larguraTela: number): "kpi" | "titulo" | "subtitulo" {
  const util = (larguraTela - ESPACO[4] * 2 - ESPACO[3]) / 2 - ESPACO[3] * 2;
  const maior = Math.max(0, ...cartoes.map((x) => x.texto.length));
  if (maior * 22 * 0.58 <= util) return "kpi";
  if (maior * 20 * 0.58 <= util) return "titulo";
  return "subtitulo";
}

function CartaoDaGrade({
  cartao,
  variante,
  aoTocar,
}: {
  cartao: CartaoDoApp;
  variante: "kpi" | "titulo" | "subtitulo";
  aoTocar: () => void;
}) {
  const c = useCores();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${cartao.rotulo}: ${cartao.texto}`}
      accessibilityHint="Mostra a definição"
      onPress={aoTocar}
      style={({ pressed }) => ({ flex: 1, opacity: pressed ? 0.85 : 1 })}
    >
      <Cartao estilo={{ flex: 1, padding: ESPACO[3], gap: ESPACO[1] }}>
        <Texto variante="rotulo" cor={c.t2} linhas={2}>
          {cartao.rotulo}
        </Texto>
        <Texto variante={variante} numero cor={cartao.negativo ? c.err : c.ink}>
          {cartao.texto}
        </Texto>
        <Variacao variacao={cartao.variacao} />
        {cartao.linha ? (
          <Texto variante="rotulo" cor={c.t3} linhas={2}>
            {cartao.linha}
          </Texto>
        ) : null}
        {cartao.detalhe ? (
          <Texto variante="rotulo" cor={c.t3} linhas={2}>
            {cartao.detalhe}
          </Texto>
        ) : null}
        {cartao.selo ? <Selo texto={cartao.selo.texto} tom={cartao.selo.tom} /> : null}
      </Cartao>
    </Pressable>
  );
}

/** A faixa de KPIs do site, em duas colunas. */
export function GradeMetricas({ cartoes }: { cartoes: CartaoDoApp[] }) {
  const { width } = useWindowDimensions();
  const [escolhido, setEscolhido] = useState<CartaoDoApp | null>(null);
  const [visivel, setVisivel] = useState(false);
  const variante = varianteDaGrade(cartoes, width);

  // Em pares, e nao flexWrap: o ultimo cartao de uma lista impar fica com meia
  // largura, como os outros, em vez de esticar a linha toda.
  const linhas: CartaoDoApp[][] = [];
  for (let i = 0; i < cartoes.length; i += 2) linhas.push(cartoes.slice(i, i + 2));

  return (
    <View style={{ gap: ESPACO[3] }}>
      {linhas.map((par) => (
        <View key={par[0].id} style={{ flexDirection: "row", gap: ESPACO[3] }}>
          {par.map((cartao) => (
            <CartaoDaGrade
              key={cartao.id}
              cartao={cartao}
              variante={variante}
              aoTocar={() => {
                setEscolhido(cartao);
                setVisivel(true);
              }}
            />
          ))}
          {par.length === 1 ? <View style={{ flex: 1 }} /> : null}
        </View>
      ))}
      <PainelDaMetrica cartao={escolhido} visivel={visivel} aoFechar={() => setVisivel(false)} />
    </View>
  );
}
