import type { ReactNode } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, View, useColorScheme, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Feather from "@expo/vector-icons/Feather";
import { Texto } from "@/components/ui";
import { ESPACO, RAIO, useCores } from "@/lib/tema";

// ============================================================================
// O painel que sobe de baixo (seletor do filtro, definicao de um cartao).
// Modal do RN com fundo proprio: `transparent` + uma camada escura que fecha
// ao tocar, porque o fundo do Modal "slide" desceria junto com o painel. O
// botao voltar do Android fecha (onRequestClose). Rola por dentro quando a
// lista passa de 85% da tela.
// ============================================================================

export function PainelInferior({
  visivel,
  titulo,
  aoFechar,
  children,
}: {
  visivel: boolean;
  titulo: string;
  aoFechar: () => void;
  children: ReactNode;
}) {
  const c = useCores();
  // O escurecido segue o tema: no escuro, o `ink` e claro e clarearia a tela.
  const escuro = useColorScheme() === "dark";
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();

  return (
    <Modal visible={visivel} transparent animationType="fade" onRequestClose={aoFechar}>
      <View style={{ flex: 1, justifyContent: "flex-end" }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Fechar"
          onPress={aoFechar}
          style={[StyleSheet.absoluteFill, { backgroundColor: escuro ? c.bg : c.ink, opacity: escuro ? 0.75 : 0.45 }]}
        />
        <View
          accessibilityViewIsModal
          style={{
            backgroundColor: c.surface,
            borderTopLeftRadius: RAIO.sobreposicao,
            borderTopRightRadius: RAIO.sobreposicao,
            maxHeight: height * 0.85,
            paddingBottom: Math.max(insets.bottom, ESPACO[2]),
          }}
        >
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              minHeight: 56,
              paddingLeft: ESPACO[4],
              paddingRight: ESPACO[1],
              borderBottomWidth: StyleSheet.hairlineWidth,
              borderBottomColor: c.border,
            }}
          >
            <Texto variante="subtitulo" estilo={{ flex: 1 }}>
              {titulo}
            </Texto>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Fechar"
              onPress={aoFechar}
              style={({ pressed }) => ({
                width: 48,
                height: 48,
                alignItems: "center",
                justifyContent: "center",
                opacity: pressed ? 0.6 : 1,
              })}
            >
              <Feather name="x" size={22} color={c.t2} />
            </Pressable>
          </View>
          <ScrollView contentContainerStyle={{ padding: ESPACO[4], gap: ESPACO[3] }}>{children}</ScrollView>
        </View>
      </View>
    </Modal>
  );
}

/** Uma opcao grande da lista do painel: texto, linha de apoio e o visto. */
export function OpcaoDoPainel({
  titulo,
  apoio,
  escolhida,
  aoTocar,
}: {
  titulo: string;
  apoio?: string | null;
  escolhida: boolean;
  aoTocar: () => void;
}) {
  const c = useCores();
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ checked: escolhida }}
      accessibilityLabel={apoio ? `${titulo}, ${apoio}` : titulo}
      onPress={aoTocar}
      style={({ pressed }) => ({
        minHeight: 52,
        flexDirection: "row",
        alignItems: "center",
        gap: ESPACO[3],
        paddingHorizontal: ESPACO[3],
        paddingVertical: ESPACO[2],
        borderRadius: RAIO.controle,
        borderWidth: 1,
        borderColor: escolhida ? c.brand : c.border,
        backgroundColor: pressed || escolhida ? c.hover : c.surface,
      })}
    >
      <View style={{ flex: 1, gap: 2 }}>
        <Texto variante="corpo" peso={escolhida ? "seminegrito" : "regular"}>
          {titulo}
        </Texto>
        {apoio ? (
          <Texto variante="rotulo" cor={c.t3} linhas={1}>
            {apoio}
          </Texto>
        ) : null}
      </View>
      {escolhida ? <Feather name="check" size={20} color={c.brand} /> : null}
    </Pressable>
  );
}
