import type { ComponentProps } from "react";
import { View } from "react-native";
import Feather from "@expo/vector-icons/Feather";
import { Texto } from "@/components/ui";
import { corDoTom, ESPACO, RAIO, useCores } from "@/lib/tema";
import type { PendenciaDoApp } from "@/lib/tipos";

// ============================================================================
// A faixa de pendencias do site (custo faltando, app desinstalado, gasto sem
// leitura...), na ordem que o servidor manda. A acao do site vira so texto:
// o app nao abre telas do site, e "Sincronizar" fica de fora no MVP.
// ============================================================================

type Icone = ComponentProps<typeof Feather>["name"];

function iconeDoTom(tom: string): Icone {
  if (tom === "err" || tom === "critico") return "alert-circle";
  if (tom === "warn" || tom === "aviso") return "alert-triangle";
  return "info";
}

export function ListaPendencias({ pendencias }: { pendencias: PendenciaDoApp[] }) {
  const c = useCores();
  if (pendencias.length === 0) return null;
  return (
    <View style={{ gap: ESPACO[2] }}>
      {pendencias.map((p) => {
        const t = corDoTom(c, p.tom);
        const noSite = p.acao && "href" in p.acao ? p.acao.rotulo : null;
        return (
          <View
            key={p.id}
            accessible
            style={{
              flexDirection: "row",
              gap: ESPACO[3],
              backgroundColor: t.fundo,
              borderRadius: RAIO.cartao,
              paddingVertical: ESPACO[3],
              paddingHorizontal: ESPACO[3],
            }}
          >
            <Feather name={iconeDoTom(p.tom)} size={18} color={t.texto} style={{ marginTop: 1 }} />
            <View style={{ flex: 1, gap: 2 }}>
              <Texto variante="denso" peso="seminegrito" cor={c.ink}>
                {p.titulo}
              </Texto>
              {p.detalhe ? (
                <Texto variante="denso" cor={c.t1}>
                  {p.detalhe}
                </Texto>
              ) : null}
              {noSite ? (
                <Texto variante="rotulo" cor={t.texto} estilo={{ marginTop: 2 }}>
                  {`Resolva no site: ${noSite}`}
                </Texto>
              ) : null}
            </View>
          </View>
        );
      })}
    </View>
  );
}
