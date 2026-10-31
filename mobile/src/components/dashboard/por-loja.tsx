import { Fragment } from "react";
import { View } from "react-native";
import { Cartao, Divisor, Selo, Texto } from "@/components/ui";
import { ESPACO, useCores } from "@/lib/tema";
import type { LojaDoApp } from "@/lib/tipos";

// ============================================================================
// A aba "Loja" do Detalhar por do site: cada loja com a situacao (o semaforo),
// o lucro, os pedidos e o ROAS. O servidor so manda linhas com "Todas as
// lojas" e 2 ou mais lojas, ja na ordem do lucro (maior primeiro).
// ============================================================================

export function ListaPorLoja({ lojas }: { lojas: LojaDoApp[] }) {
  const c = useCores();
  if (lojas.length === 0) return null;
  return (
    <Cartao estilo={{ gap: 0 }}>
      <Texto variante="subtitulo" estilo={{ marginBottom: ESPACO[2] }}>
        Por loja
      </Texto>
      {lojas.map((l, i) => (
        <Fragment key={l.id}>
          {i > 0 ? <Divisor /> : null}
          <View
            accessible
            accessibilityLabel={`${l.nome}, ${l.situacao.texto}. Lucro ${l.lucro}, ${l.pedidos} ${l.pedidos === "1" ? "pedido" : "pedidos"}, ROAS ${l.roas}`}
            style={{ paddingVertical: ESPACO[3], gap: 6 }}
          >
            <View style={{ flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", gap: ESPACO[3] }}>
              <Texto variante="denso" peso="seminegrito" linhas={1} estilo={{ flex: 1 }}>
                {l.nome}
              </Texto>
              <Texto variante="denso" peso="seminegrito" numero cor={l.lucroNegativo ? c.err : c.ok}>
                {l.lucro}
              </Texto>
            </View>
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: ESPACO[3] }}>
              <Selo texto={l.situacao.texto} tom={l.situacao.tom} />
              <Texto variante="rotulo" cor={c.t2} numero>
                {`${l.pedidos} ${l.pedidos === "1" ? "pedido" : "pedidos"} · ROAS ${l.roas}`}
              </Texto>
            </View>
          </View>
        </Fragment>
      ))}
    </Cartao>
  );
}
