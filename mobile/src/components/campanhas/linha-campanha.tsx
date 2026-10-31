import { memo, type ReactNode } from "react";
import { Pressable, View } from "react-native";
import Feather from "@expo/vector-icons/Feather";
import { Botao, Cartao, Selo, Texto } from "@/components/ui";
import { dinheiro, inteiro, rotuloStatus, vezes } from "@/lib/formato";
import { ESPACO, useCores, type Cores } from "@/lib/tema";
import type { LinhaCampanha } from "@/lib/tipos";
import { AlvoInterruptor } from "./controles";
import { dinheiroCurto, motivoDoStatus, NOME_DA_PLATAFORMA, nivelEditavel, tomDoStatus, travado } from "./regras";

// ============================================================================
// Uma linha da aba Campanhas: nome, conta, status e os 4 numeros (gasto,
// lucro, ROAS, vendas), com CPA e IC menores. Na linha do Meta, o interruptor
// de ligar/pausar e o Editar. O interruptor fica FORA da area que abre os
// conjuntos: na web o clique nele subiria para o Pressable de fora.
// ============================================================================

export function corDoLucro(c: Cores, lucro: number): string {
  return lucro > 0 ? c.ok : lucro < 0 ? c.err : c.ink;
}

export function corDoRoas(c: Cores, tom: "ok" | "err" | null): string {
  return tom === "ok" ? c.ok : tom === "err" ? c.err : c.ink;
}

/** Area que abre os conjuntos da campanha; sem acao, so agrupa. */
function AreaToque({ aoTocar, rotulo, children }: { aoTocar?: () => void; rotulo: string; children: ReactNode }) {
  if (!aoTocar) return <View style={{ gap: ESPACO[1] }}>{children}</View>;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={rotulo}
      onPress={aoTocar}
      style={({ pressed }) => ({ gap: ESPACO[1], opacity: pressed ? 0.7 : 1 })}
    >
      {children}
    </Pressable>
  );
}

function Numero({ rotulo, valor, cor }: { rotulo: string; valor: string; cor?: string }) {
  const c = useCores();
  return (
    <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
      <Texto variante="rotulo" cor={c.t3} linhas={1}>
        {rotulo}
      </Texto>
      <Texto variante="denso" peso="seminegrito" numero cor={cor ?? c.ink} ajustar>
        {valor}
      </Texto>
    </View>
  );
}

export const LinhaCampanhaCartao = memo(function LinhaCampanhaCartao({
  linha,
  moeda,
  contraEntrega,
  status,
  pendente,
  aoAbrir,
  aoAlternar,
  aoEditar,
}: {
  linha: LinhaCampanha;
  moeda: string;
  contraEntrega: boolean;
  /** O status a mostrar (o que o Meta devolveu ate a lista nova chegar). */
  status: string | null;
  /** Status pedido ao Meta e ainda sem resposta. */
  pendente: string | null;
  aoAbrir?: (linha: LinhaCampanha) => void;
  aoAlternar: (linha: LinhaCampanha, ligar: boolean) => void;
  aoEditar: (linha: LinhaCampanha) => void;
}) {
  const c = useCores();
  const editavel = nivelEditavel(linha) !== null;
  const rotulo = rotuloStatus(status);
  const ligado = pendente ? pendente === "ACTIVE" : status === "ACTIVE";
  // ACTIVE e PAUSED falam por si; o resto (campanha pausada, reprovado...) ganha o motivo.
  const motivo = status && status !== "ACTIVE" && status !== "PAUSED" ? motivoDoStatus(status) : null;
  const abrir = aoAbrir ? () => aoAbrir(linha) : undefined;
  const extras = [
    linha.cpa !== null ? `CPA ${dinheiro(linha.cpa, moeda)}` : null,
    linha.ic !== null ? `IC ${inteiro(linha.ic)}` : null,
    linha.vendasPendentes > 0 ? `${inteiro(linha.vendasPendentes)} aguardando pagamento` : null,
  ].filter(Boolean);

  return (
    <Cartao estilo={{ gap: ESPACO[3] }}>
      <View style={{ flexDirection: "row", alignItems: "flex-start", gap: ESPACO[3] }}>
        <View style={{ flex: 1 }}>
          <AreaToque aoTocar={abrir} rotulo={`Ver os conjuntos de ${linha.nome}`}>
            <Texto variante="denso" peso="seminegrito" linhas={2}>
              {linha.nome}
            </Texto>
            <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: ESPACO[2] }}>
              <Texto variante="rotulo" cor={c.t3} linhas={1} estilo={{ flexShrink: 1 }}>
                {NOME_DA_PLATAFORMA[linha.plataforma] ?? linha.plataforma} · {linha.contaNome}
              </Texto>
              {pendente ? (
                <Selo texto="Mudando no Meta…" tom="info" />
              ) : status ? (
                <Selo texto={rotulo.texto} tom={tomDoStatus(status)} />
              ) : null}
            </View>
            {motivo && !pendente ? (
              <Texto variante="rotulo" cor={c.t2}>
                {motivo}
              </Texto>
            ) : null}
          </AreaToque>
        </View>
        {/* So com ACTIVE/PAUSED o efetivo e o configurado: no resto, e sem status, o Editar le o de agora no Meta. */}
        {editavel && (pendente || status === "ACTIVE" || status === "PAUSED") ? (
          <AlvoInterruptor
            rotulo={`Ligado no Meta: ${linha.nome}`}
            valor={ligado}
            desativado={Boolean(pendente) || travado(status)}
            ocupado={Boolean(pendente)}
            aoMudar={(v) => aoAlternar(linha, v)}
          />
        ) : null}
      </View>

      <AreaToque aoTocar={abrir} rotulo={`Ver os conjuntos de ${linha.nome}`}>
        <View style={{ flexDirection: "row", gap: ESPACO[2] }}>
          <Numero rotulo="Gasto" valor={dinheiroCurto(linha.gastos, moeda)} />
          <Numero rotulo="Lucro" valor={dinheiroCurto(linha.lucro, moeda)} cor={corDoLucro(c, linha.lucro)} />
          <Numero rotulo="ROAS" valor={vezes(linha.roas)} cor={corDoRoas(c, linha.roasTom)} />
          <Numero rotulo={contraEntrega ? "Pedidos" : "Vendas"} valor={inteiro(linha.vendas)} />
        </View>
        {extras.length > 0 ? (
          <Texto variante="rotulo" cor={c.t2} numero>
            {extras.join(" · ")}
          </Texto>
        ) : null}
      </AreaToque>

      {abrir || editavel ? (
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: abrir ? "space-between" : "flex-end", gap: ESPACO[2] }}>
          {abrir ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Ver os conjuntos de ${linha.nome}`}
              onPress={abrir}
              style={({ pressed }) => ({
                minHeight: 44,
                flexDirection: "row",
                alignItems: "center",
                gap: ESPACO[1],
                opacity: pressed ? 0.7 : 1,
              })}
            >
              <Texto variante="denso" peso="seminegrito" cor={c.brand}>
                Ver conjuntos
              </Texto>
              <Feather name="chevron-right" size={18} color={c.brand} />
            </Pressable>
          ) : null}
          {editavel ? <Botao titulo="Editar" tipo="secundario" aoTocar={() => aoEditar(linha)} /> : null}
        </View>
      ) : null}
    </Cartao>
  );
});
