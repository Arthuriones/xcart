import { useColorScheme } from "react-native";

// ============================================================================
// Os tokens do Panda Track (src/app/globals.css no site): verde #1f7a5a como
// acento (lucro, link, foco), fundo quente, cartoes brancos. O app segue o
// tema do celular (claro/escuro), como o site segue o do navegador.
// ============================================================================

export interface Cores {
  bg: string;
  surface: string;
  hover: string;
  border: string;
  borderStrong: string;
  ink: string;
  t1: string;
  t2: string;
  t3: string;
  brand: string;
  /** Texto sobre o botao verde. */
  sobreBrand: string;
  ok: string;
  okBg: string;
  warn: string;
  warnBg: string;
  err: string;
  errBg: string;
  info: string;
  chart1: string;
  chart2: string;
  chart3: string;
}

export const CLARO: Cores = {
  bg: "#f5f4f1",
  surface: "#ffffff",
  hover: "#f1efeb",
  border: "#e3e0da",
  borderStrong: "#cdc9c1",
  ink: "#141414",
  t1: "#3a3936",
  t2: "#56544f",
  t3: "#6b6964",
  brand: "#1f7a5a",
  sobreBrand: "#ffffff",
  ok: "#1f7a5a",
  okBg: "#e7f3ed",
  warn: "#7f5a0f",
  warnBg: "#fbf2df",
  err: "#b3261e",
  errBg: "#fcebea",
  info: "#2c5d8f",
  chart1: "#1f7a5a",
  chart2: "#3b6fa8",
  chart3: "#c0661f",
};

export const ESCURO: Cores = {
  bg: "#0e0e0d",
  surface: "#161615",
  hover: "#222220",
  border: "#2b2a28",
  borderStrong: "#3e3d3a",
  ink: "#f2f1ee",
  t1: "#d6d4cf",
  t2: "#b5b3ad",
  t3: "#97958f",
  brand: "#3fae84",
  sobreBrand: "#0e0e0d",
  ok: "#52c093",
  okBg: "#12271e",
  warn: "#e2b45c",
  warnBg: "#2a2112",
  err: "#f27d73",
  errBg: "#2c1513",
  info: "#8cb8e6",
  chart1: "#3fae84",
  chart2: "#78a6dc",
  chart3: "#e8955a",
};

/** Raios do site: controle 8, cartao 12, sobreposicao 14. */
export const RAIO = { controle: 8, cartao: 12, sobreposicao: 14 } as const;

/** Espacamento em multiplos de 4. */
export const ESPACO = { 1: 4, 2: 8, 3: 12, 4: 16, 5: 20, 6: 24, 8: 32 } as const;

/** Instrument Sans (carregada no _layout); sem ela, a do sistema. */
export const FONTE = {
  regular: "InstrumentSans_400Regular",
  media: "InstrumentSans_500Medium",
  seminegrito: "InstrumentSans_600SemiBold",
  negrito: "InstrumentSans_700Bold",
} as const;

export function useCores(): Cores {
  return useColorScheme() === "dark" ? ESCURO : CLARO;
}

/** Cor do tom que o servidor manda (selo, variacao, pendencia). */
export function corDoTom(c: Cores, tom: string): { texto: string; fundo: string } {
  switch (tom) {
    case "ok":
      return { texto: c.ok, fundo: c.okBg };
    case "err":
    case "critico":
      return { texto: c.err, fundo: c.errBg };
    case "warn":
    case "aviso":
      return { texto: c.warn, fundo: c.warnBg };
    case "info":
    case "run":
      return { texto: c.info, fundo: c.hover };
    default:
      return { texto: c.t2, fundo: c.hover };
  }
}
