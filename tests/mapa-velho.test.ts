import { describe, expect, it } from "vitest";
import {
  HORAS_ATE_MAPA_VELHO,
  mapaVelho,
} from "@/components/routed-checkout/target-state";

/**
 * O mapa de SKU nao cresce sozinho: produto novo na vitrine so entra quando o
 * conserto roda. Enquanto nao roda, o carrinho com esse produto nao acha par no
 * checkout e o comprador sai pelo checkout da vitrine -- que nao cobra.
 *
 * Foi exatamente isso que aconteceu na conta: o cron horario nao rodava e
 * ninguem tinha como saber olhando a tela, porque a rota continuava "Ativa".
 */

const AGORA = Date.parse("2026-09-08T20:00:00Z");
const hAtras = (h: number) => new Date(AGORA - h * 3_600_000).toISOString();

describe("mapaVelho", () => {
  it("mapa conferido agora nao avisa", () => {
    expect(
      mapaVelho([{ enabled: true, lastHealedAt: hAtras(0.5) }], AGORA)
    ).toBeNull();
  });

  it("logo abaixo do limite ainda nao avisa", () => {
    const alvos = [{ enabled: true, lastHealedAt: hAtras(HORAS_ATE_MAPA_VELHO - 0.1) }];
    expect(mapaVelho(alvos, AGORA)).toBeNull();
  });

  it("no limite ja avisa", () => {
    const alvos = [{ enabled: true, lastHealedAt: hAtras(HORAS_ATE_MAPA_VELHO) }];
    expect(mapaVelho(alvos, AGORA)).toEqual({
      horas: HORAS_ATE_MAPA_VELHO,
      nunca: false,
    });
  });

  it("destino que nunca foi conferido avisa mesmo recem-criado", () => {
    // Este e o caso real: 7 dos 16 destinos da conta estavam com
    // last_healed_at nulo. Esperar 24 h para avisar seria esconder que o mapa
    // deles esta VAZIO desde sempre.
    expect(mapaVelho([{ enabled: true, lastHealedAt: null }], AGORA)).toEqual({
      horas: 0,
      nunca: true,
    });
  });

  it("olha o destino mais ANTIGO, nao o mais recente", () => {
    // Cada destino tem seu proprio mapa. Um recem-conferido nao salva o outro:
    // o rodizio manda parte dos carrinhos para o que esta podre.
    const alvos = [
      { enabled: true, lastHealedAt: hAtras(0.2) },
      { enabled: true, lastHealedAt: hAtras(72) },
    ];
    expect(mapaVelho(alvos, AGORA)).toEqual({ horas: 72, nunca: false });
  });

  it("destino desligado nao gera aviso: nenhum carrinho cai nele", () => {
    const alvos = [
      { enabled: true, lastHealedAt: hAtras(1) },
      { enabled: false, lastHealedAt: hAtras(500) },
      { enabled: false, lastHealedAt: null },
    ];
    expect(mapaVelho(alvos, AGORA)).toBeNull();
  });

  it("rota sem nenhum destino ligado nao avisa", () => {
    expect(mapaVelho([], AGORA)).toBeNull();
    expect(mapaVelho([{ enabled: false, lastHealedAt: null }], AGORA)).toBeNull();
  });

  it("nunca conferido ganha de conferido ha pouco", () => {
    const alvos = [
      { enabled: true, lastHealedAt: hAtras(1) },
      { enabled: true, lastHealedAt: null },
    ];
    expect(mapaVelho(alvos, AGORA)?.nunca).toBe(true);
  });
});
