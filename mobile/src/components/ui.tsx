import type { ReactNode, Ref } from "react";
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextInputInstance,
  type TextInputProps,
  type TextStyle,
  type ViewStyle,
} from "react-native";
import { SafeAreaView, type Edge } from "react-native-safe-area-context";
import { corDoTom, ESPACO, FONTE, RAIO, useCores } from "@/lib/tema";

// ============================================================================
// As pecas de tela do app, no visual do Panda Track (tokens de src/lib/tema).
// Toda tela usa estas; nada de cor ou fonte solta.
// ============================================================================

type Variante = "display" | "kpi" | "titulo" | "subtitulo" | "corpo" | "denso" | "rotulo";

const TAMANHO: Record<Variante, { fontSize: number; lineHeight: number; fonte: string }> = {
  display: { fontSize: 34, lineHeight: 40, fonte: FONTE.seminegrito },
  kpi: { fontSize: 22, lineHeight: 28, fonte: FONTE.seminegrito },
  titulo: { fontSize: 20, lineHeight: 26, fonte: FONTE.seminegrito },
  subtitulo: { fontSize: 16, lineHeight: 22, fonte: FONTE.seminegrito },
  corpo: { fontSize: 15, lineHeight: 21, fonte: FONTE.regular },
  denso: { fontSize: 14, lineHeight: 19, fonte: FONTE.regular },
  rotulo: { fontSize: 12, lineHeight: 16, fonte: FONTE.media },
};

export function Texto({
  children,
  variante = "corpo",
  cor,
  peso,
  numero,
  estilo,
  linhas,
  ajustar,
}: {
  children: ReactNode;
  variante?: Variante;
  cor?: string;
  peso?: "regular" | "media" | "seminegrito";
  /** Algarismos de largura fixa (valores em coluna). */
  numero?: boolean;
  estilo?: StyleProp<TextStyle>;
  linhas?: number;
  /** Uma linha, encolhendo ate 70% para caber (valor nunca cortado com "..."). */
  ajustar?: boolean;
}) {
  const c = useCores();
  const t = TAMANHO[variante];
  const fonte = peso ? FONTE[peso] : t.fonte;
  return (
    <Text
      numberOfLines={ajustar ? 1 : linhas}
      adjustsFontSizeToFit={ajustar}
      minimumFontScale={ajustar ? 0.7 : undefined}
      style={[
        { fontSize: t.fontSize, lineHeight: t.lineHeight, fontFamily: fonte, color: cor ?? c.ink },
        numero && { fontVariant: ["tabular-nums"] },
        estilo,
      ]}
    >
      {children}
    </Text>
  );
}

/** Fundo da tela + rolagem + puxar para atualizar. */
export function Tela({
  children,
  atualizando,
  aoAtualizar,
  bordas = ["top"],
  rolar = true,
  estilo,
}: {
  children: ReactNode;
  atualizando?: boolean;
  aoAtualizar?: () => void;
  bordas?: Edge[];
  rolar?: boolean;
  estilo?: StyleProp<ViewStyle>;
}) {
  const c = useCores();
  return (
    <SafeAreaView edges={bordas} style={{ flex: 1, backgroundColor: c.bg }}>
      {rolar ? (
        <ScrollView
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={[{ padding: ESPACO[4], gap: ESPACO[3], paddingBottom: ESPACO[8] }, estilo]}
          refreshControl={
            aoAtualizar ? (
              <RefreshControl refreshing={Boolean(atualizando)} onRefresh={aoAtualizar} tintColor={c.brand} colors={[c.brand]} />
            ) : undefined
          }
        >
          {children}
        </ScrollView>
      ) : (
        <View style={[{ flex: 1, padding: ESPACO[4], gap: ESPACO[3] }, estilo]}>{children}</View>
      )}
    </SafeAreaView>
  );
}

export function Cartao({ children, estilo }: { children: ReactNode; estilo?: StyleProp<ViewStyle> }) {
  const c = useCores();
  return (
    <View
      style={[
        { backgroundColor: c.surface, borderRadius: RAIO.cartao, borderWidth: StyleSheet.hairlineWidth, borderColor: c.border, padding: ESPACO[4], gap: ESPACO[2] },
        estilo,
      ]}
    >
      {children}
    </View>
  );
}

export function Botao({
  titulo,
  aoTocar,
  tipo = "primario",
  carregando,
  desativado,
  estilo,
}: {
  titulo: string;
  aoTocar: () => void;
  tipo?: "primario" | "secundario" | "perigo" | "texto";
  carregando?: boolean;
  desativado?: boolean;
  estilo?: StyleProp<ViewStyle>;
}) {
  const c = useCores();
  const fundo = tipo === "primario" ? c.brand : tipo === "perigo" ? c.errBg : tipo === "secundario" ? c.surface : "transparent";
  const texto = tipo === "primario" ? c.sobreBrand : tipo === "perigo" ? c.err : tipo === "texto" ? c.brand : c.ink;
  const borda = tipo === "secundario" ? c.borderStrong : "transparent";
  const off = desativado || carregando;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: Boolean(off), busy: Boolean(carregando) }}
      disabled={off}
      onPress={aoTocar}
      style={({ pressed }) => [
        {
          minHeight: 44,
          borderRadius: RAIO.controle,
          backgroundColor: fundo,
          borderWidth: 1,
          borderColor: borda,
          alignItems: "center",
          justifyContent: "center",
          paddingHorizontal: ESPACO[4],
          opacity: off ? 0.55 : pressed ? 0.8 : 1,
          flexDirection: "row",
          gap: ESPACO[2],
        },
        estilo,
      ]}
    >
      {carregando ? <ActivityIndicator size="small" color={texto} /> : null}
      <Texto variante="denso" peso="seminegrito" cor={texto}>
        {titulo}
      </Texto>
    </Pressable>
  );
}

export function Campo({
  rotulo,
  ajuda,
  erro,
  sufixo,
  ref,
  ...props
}: TextInputProps & { rotulo: string; ajuda?: string; erro?: string | null; sufixo?: string; ref?: Ref<TextInputInstance> }) {
  const c = useCores();
  return (
    <View style={{ gap: 6 }}>
      <Texto variante="rotulo" cor={c.t2}>
        {rotulo}
      </Texto>
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          minHeight: 44,
          borderRadius: RAIO.controle,
          borderWidth: 1,
          borderColor: erro ? c.err : c.borderStrong,
          backgroundColor: c.surface,
          paddingHorizontal: ESPACO[3],
        }}
      >
        <TextInput
          ref={ref}
          placeholderTextColor={c.t3}
          {...props}
          style={[{ flex: 1, fontFamily: FONTE.regular, fontSize: 15, color: c.ink, paddingVertical: 10 }, props.style]}
        />
        {sufixo ? (
          <Texto variante="denso" cor={c.t3}>
            {sufixo}
          </Texto>
        ) : null}
      </View>
      {erro ? (
        <Texto variante="rotulo" cor={c.err}>
          {erro}
        </Texto>
      ) : ajuda ? (
        <Texto variante="rotulo" cor={c.t3}>
          {ajuda}
        </Texto>
      ) : null}
    </View>
  );
}

export function Selo({ texto, tom }: { texto: string; tom: string }) {
  const c = useCores();
  const t = corDoTom(c, tom);
  return (
    <View style={{ alignSelf: "flex-start", backgroundColor: t.fundo, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2 }}>
      <Texto variante="rotulo" cor={t.texto}>
        {texto}
      </Texto>
    </View>
  );
}

export function Interruptor({
  valor,
  aoMudar,
  desativado,
  rotulo,
}: {
  valor: boolean;
  aoMudar: (v: boolean) => void;
  desativado?: boolean;
  rotulo: string;
}) {
  const c = useCores();
  return (
    <Switch
      accessibilityLabel={rotulo}
      value={valor}
      onValueChange={aoMudar}
      disabled={desativado}
      trackColor={{ false: c.borderStrong, true: c.brand }}
      thumbColor="#ffffff"
      ios_backgroundColor={c.borderStrong}
    />
  );
}

export function Carregando({ texto = "Carregando…" }: { texto?: string }) {
  const c = useCores();
  return (
    <View style={{ paddingVertical: ESPACO[8], alignItems: "center", gap: ESPACO[3] }}>
      <ActivityIndicator color={c.brand} />
      <Texto variante="denso" cor={c.t2}>
        {texto}
      </Texto>
    </View>
  );
}

export function EstadoErro({ mensagem, aoTentar }: { mensagem: string; aoTentar?: () => void }) {
  const c = useCores();
  return (
    <Cartao estilo={{ alignItems: "flex-start", gap: ESPACO[3] }}>
      <Texto variante="subtitulo">Algo não carregou</Texto>
      <Texto variante="denso" cor={c.t1}>
        {mensagem}
      </Texto>
      {aoTentar ? <Botao titulo="Tentar de novo" tipo="secundario" aoTocar={aoTentar} /> : null}
    </Cartao>
  );
}

export function EstadoVazio({ titulo, texto }: { titulo: string; texto: string }) {
  const c = useCores();
  return (
    <Cartao estilo={{ gap: ESPACO[2] }}>
      <Texto variante="subtitulo">{titulo}</Texto>
      <Texto variante="denso" cor={c.t1}>
        {texto}
      </Texto>
    </Cartao>
  );
}

export function Divisor() {
  const c = useCores();
  return <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: c.border }} />;
}

/** Linha "rotulo ......... valor" dos cartoes e da edicao. */
export function LinhaValor({ rotulo, valor, cor }: { rotulo: string; valor: string; cor?: string }) {
  const c = useCores();
  return (
    <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "baseline", gap: ESPACO[3] }}>
      <Texto variante="denso" cor={c.t2}>
        {rotulo}
      </Texto>
      <Texto variante="denso" peso="media" numero cor={cor ?? c.ink}>
        {valor}
      </Texto>
    </View>
  );
}
