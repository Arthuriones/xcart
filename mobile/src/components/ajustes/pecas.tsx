import type { ReactNode } from "react";
import { Pressable, View } from "react-native";
import Feather from "@expo/vector-icons/Feather";
import { Texto } from "@/components/ui";
import { ESPACO, useCores } from "@/lib/tema";

// ============================================================================
// Pecas da tela de Ajustes: o titulo de cada secao e a linha de link que abre
// uma pagina do site no navegador.
// ============================================================================

export function Secao({ titulo, children }: { titulo: string; children: ReactNode }) {
  const c = useCores();
  return (
    <View style={{ gap: ESPACO[2], marginTop: ESPACO[3] }}>
      <View accessible accessibilityRole="header" style={{ paddingHorizontal: ESPACO[1] }}>
        <Texto variante="rotulo" cor={c.t2}>
          {titulo}
        </Texto>
      </View>
      {children}
    </View>
  );
}

/** Linha inteira tocavel (48px), com o icone de "abre fora do app". */
export function LinhaLink({ rotulo, aoTocar }: { rotulo: string; aoTocar: () => void }) {
  const c = useCores();
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityHint="Abre no navegador"
      onPress={aoTocar}
      style={({ pressed }) => ({
        minHeight: 48,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        gap: ESPACO[3],
        opacity: pressed ? 0.6 : 1,
      })}
    >
      <Texto variante="denso">{rotulo}</Texto>
      <Feather name="external-link" size={18} color={c.t3} />
    </Pressable>
  );
}
