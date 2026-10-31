import { useEffect, useId, useState } from "react";
import { StyleSheet, View, type GestureResponderEvent } from "react-native";
import Svg, { Defs, Line, Path, Pattern, Rect } from "react-native-svg";
import { Texto } from "@/components/ui";
import { dinheiro, inteiro } from "@/lib/formato";
import { useCores } from "@/lib/tema";
import type { PontoDia } from "@/lib/tipos";

// ============================================================================
// O grafico do Dashboard no celular: uma barra por dia com o lucro do dia
// (o `lucro` que o servidor ja calcula, mesma formula do site), verde acima de
// zero e vermelha abaixo, o dia de hoje hachurado porque ainda corre. Tocar
// ou arrastar o dedo escolhe o dia e as outras barras esmaecem -- como o
// grafico do site, sem depender de hover.
//
// Uma camada vazia por cima do SVG recebe o toque: o locationX dela e a
// posicao no grafico. No proprio SVG o toque cairia no retangulo da barra e o
// locationX viria relativo a ela.
// ============================================================================

const ALTURA = 150;
const RESPIRO = 6;
const DIAS_DA_SEMANA = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];

/** "2026-10-30" -> "30/10". */
function diaCurto(dia: string): string {
  return `${dia.slice(8, 10)}/${dia.slice(5, 7)}`;
}

/** "2026-10-30" -> "qui, 30/10". UTC de proposito: o dia ja vem no fuso da loja. */
function diaComSemana(dia: string): string {
  const [a, m, d] = dia.split("-").map(Number);
  const semana = Number.isFinite(a) ? DIAS_DA_SEMANA[new Date(Date.UTC(a, m - 1, d)).getUTCDay()] : null;
  return semana ? `${semana}, ${diaCurto(dia)}` : diaCurto(dia);
}

/** Primeiro, do meio e ultimo, sem repetir quando a serie e curta. */
function indicesDoEixo(n: number): number[] {
  if (n <= 0) return [];
  if (n <= 2) return Array.from({ length: n }, (_, i) => i);
  return [0, Math.floor((n - 1) / 2), n - 1];
}

export function GraficoLucro({ pontos, moeda, titulo }: { pontos: PontoDia[]; moeda: string; titulo: string }) {
  const c = useCores();
  const [largura, setLargura] = useState(0);
  const [escolhido, setEscolhido] = useState<number | null>(null);
  // O id do padrao e global no SVG da web: um por grafico, sem ":" (quebra o url(#...)).
  const id = `h${useId().replace(/[^A-Za-z0-9]/g, "")}`;

  // Serie nova (filtro trocado, puxar para atualizar): o dia escolhido pode nem existir.
  useEffect(() => {
    setEscolhido(null);
  }, [pontos]);

  const n = pontos.length;
  const valores = pontos.map((p) => (Number.isFinite(p.lucro) ? p.lucro : 0));
  const maximo = Math.max(0, ...valores);
  const minimo = Math.min(0, ...valores);
  const faixa = maximo - minimo || 1;
  const util = ALTURA - RESPIRO * 2;
  const zeroY = RESPIRO + (maximo / faixa) * util;
  const passo = n > 0 ? largura / n : 0;
  const barra = Math.max(2, Math.min(28, passo * 0.68));

  function escolherPelaPosicao(e: GestureResponderEvent) {
    if (n === 0 || passo <= 0) return;
    const i = Math.floor(e.nativeEvent.locationX / passo);
    setEscolhido(Math.min(n - 1, Math.max(0, i)));
  }

  const ponto = escolhido !== null ? pontos[escolhido] : undefined;
  const textoDoPonto = ponto
    ? `${diaComSemana(ponto.dia)}${ponto.parcial ? " (até agora)" : ""}: ${dinheiro(ponto.lucro, moeda)}, ${inteiro(ponto.pedidos)} ${ponto.pedidos === 1 ? "pedido" : "pedidos"}`
    : "nenhum dia escolhido";

  return (
    <View style={{ gap: 8 }}>
      {/* Altura fixa: escolher um dia nao empurra o grafico. */}
      <View style={{ minHeight: 40, justifyContent: "center" }}>
        {ponto ? (
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
            <View style={{ flexShrink: 1 }}>
              <Texto variante="denso" peso="media">
                {diaComSemana(ponto.dia)}
                {ponto.parcial ? " · até agora" : ""}
              </Texto>
              <Texto variante="rotulo" cor={c.t3} numero>
                {inteiro(ponto.pedidos)} {ponto.pedidos === 1 ? "pedido" : "pedidos"}
              </Texto>
            </View>
            <Texto variante="subtitulo" numero cor={ponto.lucro < 0 ? c.err : c.ink}>
              {dinheiro(ponto.lucro, moeda)}
            </Texto>
          </View>
        ) : (
          <Texto variante="rotulo" cor={c.t3}>
            Toque numa barra para ver o dia.
          </Texto>
        )}
      </View>

      <View style={{ height: ALTURA }} onLayout={(e) => setLargura(e.nativeEvent.layout.width)}>
        {largura > 0 ? (
          <Svg width={largura} height={ALTURA}>
            <Defs>
              {/* Hachura sem rotacao: diagonais que se emendam no ladrilho de 6 px. */}
              <Pattern id={`${id}p`} patternUnits="userSpaceOnUse" width={6} height={6}>
                <Path d="M0,6 L6,0 M-1.5,1.5 L1.5,-1.5 M4.5,7.5 L7.5,4.5" stroke={c.chart1} strokeWidth={1.6} />
              </Pattern>
              <Pattern id={`${id}n`} patternUnits="userSpaceOnUse" width={6} height={6}>
                <Path d="M0,6 L6,0 M-1.5,1.5 L1.5,-1.5 M4.5,7.5 L7.5,4.5" stroke={c.err} strokeWidth={1.6} />
              </Pattern>
            </Defs>
            <Line x1={0} x2={largura} y1={zeroY} y2={zeroY} stroke={c.borderStrong} strokeWidth={1} />
            {pontos.map((p, i) => {
              const v = valores[i];
              const negativo = v < 0;
              // Dia com lucro minimo ainda aparece (1,5 px); zero e so a linha.
              const h = v === 0 ? 0 : Math.max(1.5, (Math.abs(v) / faixa) * util);
              const y = negativo ? zeroY : zeroY - h;
              const x = i * passo + (passo - barra) / 2;
              const cor = negativo ? c.err : c.chart1;
              const opacidade = escolhido !== null && escolhido !== i ? 0.3 : 1;
              return (
                <Rect
                  key={p.dia}
                  x={x}
                  y={y}
                  width={barra}
                  height={h}
                  rx={Math.min(2, barra / 4)}
                  fill={p.parcial ? `url(#${id}${negativo ? "n" : "p"})` : cor}
                  stroke={p.parcial ? cor : undefined}
                  strokeWidth={p.parcial ? 1 : 0}
                  opacity={opacidade}
                />
              );
            })}
          </Svg>
        ) : null}
        <View
          style={StyleSheet.absoluteFill}
          onStartShouldSetResponder={() => true}
          onResponderGrant={escolherPelaPosicao}
          onResponderMove={escolherPelaPosicao}
          // Arrasto vertical e rolagem da tela: o ScrollView leva.
          onResponderTerminationRequest={() => true}
          accessible
          accessibilityRole="adjustable"
          accessibilityLabel={`${titulo}, ${n} ${n === 1 ? "dia" : "dias"}`}
          accessibilityHint="Deslize para cima ou para baixo para passar pelos dias"
          accessibilityValue={{ text: textoDoPonto }}
          accessibilityActions={[{ name: "increment" }, { name: "decrement" }]}
          onAccessibilityAction={(e) => {
            if (n === 0) return;
            const passoDoLeitor = e.nativeEvent.actionName === "increment" ? 1 : e.nativeEvent.actionName === "decrement" ? -1 : 0;
            if (passoDoLeitor === 0) return;
            setEscolhido((atual) => {
              if (atual === null) return passoDoLeitor > 0 ? 0 : n - 1;
              return Math.min(n - 1, Math.max(0, atual + passoDoLeitor));
            });
          }}
        />
      </View>

      <View style={{ flexDirection: "row", justifyContent: n === 1 ? "center" : "space-between" }}>
        {indicesDoEixo(n).map((i) => (
          <Texto key={i} variante="rotulo" cor={c.t3} numero>
            {diaCurto(pontos[i].dia)}
          </Texto>
        ))}
      </View>
    </View>
  );
}
