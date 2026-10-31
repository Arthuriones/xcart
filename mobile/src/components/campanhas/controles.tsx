import type { ReactNode } from "react";
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import Feather from "@expo/vector-icons/Feather";
import { Interruptor, Texto } from "@/components/ui";
import { ESPACO, RAIO, useCores } from "@/lib/tema";

// ============================================================================
// Controles do topo da aba Campanhas: o segmentado de nivel, as pilulas de
// status e o chip removivel da campanha aberta. Alvo de toque >= 44px (a
// pilula e menor no desenho e cresce pelo hitSlop).
// ============================================================================

/** O que falta para a pilula de 36px chegar a 44px de alvo. */
const FOLGA = { top: 4, bottom: 4, left: 2, right: 2 };

export function Segmentado<T extends string>({
  opcoes,
  valor,
  aoMudar,
  rotulo,
}: {
  opcoes: { id: T; rotulo: string }[];
  valor: T;
  aoMudar: (v: T) => void;
  rotulo: string;
}) {
  const c = useCores();
  return (
    <View
      accessibilityRole="tablist"
      accessibilityLabel={rotulo}
      style={{
        flexDirection: "row",
        backgroundColor: c.hover,
        borderRadius: RAIO.controle + 2,
        padding: ESPACO[1],
        gap: ESPACO[1],
      }}
    >
      {opcoes.map((o) => {
        const ativo = o.id === valor;
        return (
          <Pressable
            key={o.id}
            accessibilityRole="tab"
            accessibilityState={{ selected: ativo }}
            onPress={() => aoMudar(o.id)}
            style={({ pressed }) => ({
              flex: 1,
              minHeight: 44,
              borderRadius: RAIO.controle,
              alignItems: "center",
              justifyContent: "center",
              paddingHorizontal: ESPACO[2],
              backgroundColor: ativo ? c.surface : "transparent",
              borderWidth: StyleSheet.hairlineWidth,
              borderColor: ativo ? c.border : "transparent",
              opacity: pressed && !ativo ? 0.7 : 1,
            })}
          >
            <Texto variante="denso" peso={ativo ? "seminegrito" : "media"} cor={ativo ? c.ink : c.t2} linhas={1}>
              {o.rotulo}
            </Texto>
          </Pressable>
        );
      })}
    </View>
  );
}

export function Pilula({ texto, ativo, aoTocar }: { texto: string; ativo: boolean; aoTocar: () => void }) {
  const c = useCores();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: ativo }}
      hitSlop={FOLGA}
      onPress={aoTocar}
      style={({ pressed }) => ({
        minHeight: 36,
        paddingHorizontal: ESPACO[3],
        borderRadius: 999,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: ativo ? c.ink : c.surface,
        borderWidth: 1,
        borderColor: ativo ? c.ink : c.borderStrong,
        opacity: pressed ? 0.75 : 1,
      })}
    >
      <Texto variante="denso" peso="media" cor={ativo ? c.bg : c.t1}>
        {texto}
      </Texto>
    </Pressable>
  );
}

/** "Campanha: <nome>  x" -- tocar tira o filtro e volta para a lista de campanhas. */
export function ChipRemovivel({ rotulo, valor, aoRemover }: { rotulo: string; valor: string; aoRemover: () => void }) {
  const c = useCores();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Tirar o filtro ${rotulo} ${valor}`}
      hitSlop={FOLGA}
      onPress={aoRemover}
      style={({ pressed }) => ({
        alignSelf: "flex-start",
        maxWidth: "100%",
        minHeight: 36,
        flexDirection: "row",
        alignItems: "center",
        gap: ESPACO[2],
        paddingLeft: ESPACO[3],
        paddingRight: ESPACO[2],
        borderRadius: 999,
        backgroundColor: c.okBg,
        borderWidth: 1,
        borderColor: c.brand,
        opacity: pressed ? 0.75 : 1,
      })}
    >
      <View style={{ flexShrink: 1, flexDirection: "row" }}>
        <Texto variante="denso" cor={c.t2} linhas={1} estilo={{ flexShrink: 1 }}>
          {rotulo}:{" "}
          <Texto variante="denso" peso="seminegrito" cor={c.ink}>
            {valor}
          </Texto>
        </Texto>
      </View>
      <Feather name="x" size={16} color={c.brand} />
    </Pressable>
  );
}

/**
 * O Interruptor com alvo de 44px: o Switch nativo tem ~31px de altura, entao
 * quem recebe o toque e o Pressable em volta (com o rotulo, quando ha) e o
 * Switch so desenha. Na web isso tambem evita o clique subir duas vezes.
 */
export function AlvoInterruptor({
  valor,
  aoMudar,
  rotulo,
  desativado,
  ocupado,
  children,
  estilo,
}: {
  valor: boolean;
  aoMudar: (v: boolean) => void;
  rotulo: string;
  desativado?: boolean;
  ocupado?: boolean;
  children?: ReactNode;
  estilo?: StyleProp<ViewStyle>;
}) {
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityLabel={rotulo}
      accessibilityState={{ checked: valor, disabled: Boolean(desativado), busy: Boolean(ocupado) }}
      disabled={desativado}
      hitSlop={4}
      onPress={() => aoMudar(!valor)}
      style={[{ minHeight: 44, minWidth: 52, flexDirection: "row", alignItems: "center", justifyContent: "flex-end", gap: ESPACO[3] }, estilo]}
    >
      {children}
      <View style={{ pointerEvents: "none" }} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
        <Interruptor valor={valor} aoMudar={() => undefined} desativado={desativado} rotulo={rotulo} />
      </View>
    </Pressable>
  );
}
