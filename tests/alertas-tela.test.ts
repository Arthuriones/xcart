import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { ROTULO_REGRA, type AlertaRow, type RegraAlerta } from "../src/lib/financeiro/tipos";
import {
  INTERVALO_VERIFICACAO_MIN,
  abaDe,
  ateQuando,
  dataHoraCurta,
  destinoDoAlerta,
  duracaoMs,
  duracaoTexto,
  erroDeSilenciar,
  erroDoTelegram,
  estaSilenciado,
  folgaDoFechamentoMin,
  formatarLimite,
  horaCurta,
  lerNumero,
  nomeDaLoja,
  ordenarAbertos,
  regrasNaTela,
  separarAbertos,
  textoAvisos,
  textoCicloDeVida,
  ultimaConfirmacao,
} from "../src/app/(dashboard)/alertas/apresentar";

const SP = "America/Sao_Paulo";
const RAIZ = path.resolve(__dirname, "..");
const REGRAS = Object.keys(ROTULO_REGRA) as RegraAlerta[];

type Linha = Pick<AlertaRow, "id" | "severidade" | "aberto_em" | "silenciado_ate">;

describe("abaDe", () => {
  it("aceita as quatro abas e cai em abertos com lixo", () => {
    expect(abaDe("resolvidos")).toBe("resolvidos");
    expect(abaDe("regras")).toBe("regras");
    expect(abaDe("canal")).toBe("canal");
    expect(abaDe(["canal", "regras"])).toBe("canal");
    expect(abaDe("xpto")).toBe("abertos");
    expect(abaDe(undefined)).toBe("abertos");
    expect(abaDe(null)).toBe("abertos");
  });
});

describe("duracaoTexto", () => {
  const MIN = 60_000;
  it("minutos, horas e dias", () => {
    expect(duracaoTexto(20_000)).toBe("menos de 1 min");
    expect(duracaoTexto(42 * MIN)).toBe("42 min");
    expect(duracaoTexto(60 * MIN)).toBe("1 h");
    expect(duracaoTexto(142 * MIN)).toBe("2 h 22 min");
    expect(duracaoTexto(65 * MIN)).toBe("1 h 05 min");
    expect(duracaoTexto(24 * 60 * MIN)).toBe("1 d");
    expect(duracaoTexto((3 * 24 + 4) * 60 * MIN + 30 * MIN)).toBe("3 d 4 h");
  });

  it("negativo (relogio adiantado) vira zero, nunca texto negativo", () => {
    expect(duracaoTexto(-5 * MIN)).toBe("menos de 1 min");
  });

  it("duracaoMs precisa das duas pontas", () => {
    expect(duracaoMs("2026-10-01T10:00:00Z", "2026-10-01T11:30:00Z")).toBe(90 * MIN);
    expect(duracaoMs("2026-10-01T10:00:00Z", null)).toBeNull();
    expect(duracaoMs("lixo", "2026-10-01T11:30:00Z")).toBeNull();
  });
});

describe("datas no fuso", () => {
  // 2026-10-01 23:15 UTC = 20:15 em Sao Paulo (UTC-3).
  const iso = "2026-10-01T23:15:00Z";

  it("dataHoraCurta e horaCurta montam por partes", () => {
    expect(dataHoraCurta(iso, SP)).toBe("01/10, 20:15");
    expect(horaCurta(iso, SP)).toBe("20:15");
    expect(dataHoraCurta(null, SP)).toBe("—");
    expect(dataHoraCurta("lixo", SP)).toBe("—");
  });

  it("meia-noite sai 00, nao 24", () => {
    expect(horaCurta("2026-10-02T03:00:00Z", SP)).toBe("00:00");
  });

  it("ateQuando diz hoje, amanha ou a data", () => {
    const agora = Date.parse("2026-10-02T17:00:00Z"); // 14:00 em SP, dia 02/10
    expect(ateQuando("2026-10-02T21:00:00Z", agora, SP)).toBe("hoje, 18:00");
    expect(ateQuando("2026-10-03T17:31:00Z", agora, SP)).toBe("amanhã, 14:31");
    expect(ateQuando("2026-10-05T17:31:00Z", agora, SP)).toBe("05/10, 14:31");
    // 01:00 UTC do dia 03 ainda e dia 02 em Sao Paulo.
    expect(ateQuando("2026-10-03T01:00:00Z", agora, SP)).toBe("hoje, 22:00");
  });
});

describe("abertos", () => {
  const agora = Date.parse("2026-10-02T12:00:00Z");
  const a = (id: string, severidade: "critico" | "aviso", aberto: string, sil: string | null = null): Linha => ({
    id,
    severidade,
    aberto_em: aberto,
    silenciado_ate: sil,
  });

  it("critico antes de aviso; dentro de cada um, o mais novo primeiro", () => {
    const lista = [
      a("1", "aviso", "2026-10-02T11:00:00Z"),
      a("2", "critico", "2026-10-02T08:00:00Z"),
      a("3", "aviso", "2026-10-02T11:30:00Z"),
      a("4", "critico", "2026-10-02T09:00:00Z"),
    ];
    expect(ordenarAbertos(lista).map((x) => x.id)).toEqual(["4", "2", "3", "1"]);
    // Nao muda a lista de entrada.
    expect(lista.map((x) => x.id)).toEqual(["1", "2", "3", "4"]);
  });

  it("silencio vencido nao conta", () => {
    expect(estaSilenciado("2026-10-02T13:00:00Z", agora)).toBe(true);
    expect(estaSilenciado("2026-10-02T11:00:00Z", agora)).toBe(false);
    expect(estaSilenciado(null, agora)).toBe(false);
    expect(estaSilenciado("lixo", agora)).toBe(false);
  });

  it("separa silenciados; o que o lojista fez na tela vence o servidor", () => {
    const lista = [
      a("1", "critico", "2026-10-02T10:00:00Z", "2026-10-03T10:00:00Z"),
      a("2", "aviso", "2026-10-02T10:00:00Z"),
      a("3", "critico", "2026-10-02T09:00:00Z"),
      a("4", "aviso", "2026-10-02T09:00:00Z", "2026-10-01T10:00:00Z"), // vencido
    ];
    const sem = separarAbertos(lista, {}, agora);
    expect(sem.ativos.map((x) => x.id)).toEqual(["3", "2", "4"]);
    expect(sem.silenciados.map((x) => x.id)).toEqual(["1"]);
    expect(sem.silenciados[0].ate).toBe("2026-10-03T10:00:00Z");

    // Silenciou o 3 agora e desfez o 1 (null = avisando).
    const com = separarAbertos(lista, { "3": "2026-10-03T12:00:00Z", "1": null }, agora);
    expect(com.ativos.map((x) => x.id)).toEqual(["1", "2", "4"]);
    expect(com.silenciados.map((x) => x.id)).toEqual(["3"]);
  });

  it("textoAvisos", () => {
    expect(textoAvisos(0)).toBe("ainda sem aviso no Telegram");
    expect(textoAvisos(null)).toBe("ainda sem aviso no Telegram");
    expect(textoAvisos(1)).toBe("avisado 1 vez no Telegram");
    expect(textoAvisos(3)).toBe("avisado 3 vezes no Telegram");
  });

  it("ultimaConfirmacao pega a mais recente e ignora lixo", () => {
    expect(
      ultimaConfirmacao([
        { confirmado_em: "2026-10-02T11:50:00Z" },
        { confirmado_em: "lixo" },
        { confirmado_em: "2026-10-02T11:40:00Z" },
      ])
    ).toBe("2026-10-02T11:50:00Z");
    expect(ultimaConfirmacao([])).toBeNull();
  });
});

describe("nomeDaLoja", () => {
  const lojas = [
    { id: "a", nome: "Lash Bestie", dominio: "qkgknv-w3.myshopify.com" },
    { id: "b", nome: "kphigm-76.myshopify.com", dominio: "kphigm-76.myshopify.com" },
  ];
  it("nome com o dominio, sem o .myshopify.com", () => {
    expect(nomeDaLoja("a", lojas)).toBe("Lash Bestie · qkgknv-w3");
    expect(nomeDaLoja("b", lojas)).toBe("kphigm-76");
  });
  it("conta inteira, loja removida e lojas que nao vieram", () => {
    expect(nomeDaLoja(null, lojas)).toBe("Todas as lojas");
    expect(nomeDaLoja("z", lojas)).toBe("Loja removida");
    expect(nomeDaLoja("z", [], true)).toBe("Loja");
  });
});

describe("Resolver leva a uma tela que existe", () => {
  it("toda regra tem destino com pagina no app", () => {
    for (const regra of REGRAS) {
      const d = destinoDoAlerta(regra);
      expect(d.tela.length, regra).toBeGreaterThan(0);
      const pagina = path.join(RAIZ, "src", "app", "(dashboard)", ...d.href.split("/").filter(Boolean), "page.tsx");
      expect(existsSync(pagina), `${regra} -> ${d.href}`).toBe(true);
    }
  });
  it("gasto do Google atrasado leva ao Google, onde a conta aparece", () => {
    expect(destinoDoAlerta("ads_sync_atrasado", "Gasto do Google sem atualizar: Conta X").href).toBe(
      "/integracoes/google"
    );
    expect(destinoDoAlerta("ads_sync_atrasado", "Gasto do Meta sem atualizar: Conta Y").href).toBe(
      "/integracoes/meta"
    );
  });
  it("rastreamento parado abre o detalhe da loja", () => {
    expect(destinoDoAlerta("rastreamento_parado", null, "a b").href).toBe("/tracking?loja=a%20b");
    expect(destinoDoAlerta("rastreamento_parado").href).toBe("/tracking");
  });
});

describe("as regras da tela batem com o cron", () => {
  const fonte = readFileSync(path.join(RAIZ, "src", "lib", "alertas", "avaliar.ts"), "utf8");
  // Cada condicoes.push do cron: a regra e a severidade que ele grava.
  const doCron = new Map<string, string>();
  for (const m of fonte.matchAll(/regra:\s*"(\w+)",[\s\S]*?severidade:\s*"(\w+)"/g)) {
    doCron.set(m[1], m[2]);
  }

  it("uma linha por regra, sem faltar nem sobrar", () => {
    const tela = regrasNaTela(30).map((r) => r.regra);
    expect([...tela].sort()).toEqual([...REGRAS].sort());
    expect(new Set(tela).size).toBe(tela.length);
  });

  it("mesma severidade que o cron grava", () => {
    expect(doCron.size).toBe(REGRAS.length);
    for (const r of regrasNaTela(30)) {
      expect(r.severidade, r.regra).toBe(doCron.get(r.regra));
    }
  });

  it("o limite do gastou sem vender vem da config", () => {
    const g = regrasNaTela(1234.5).find((r) => r.regra === "gastou_sem_vender");
    expect(g?.quando).toBe("A partir de 1.234,50 na moeda da conta");
  });

  it("o intervalo da tela e o do vercel.json", () => {
    const vercel = JSON.parse(readFileSync(path.join(RAIZ, "vercel.json"), "utf8")) as {
      crons: { path: string; schedule: string }[];
    };
    const cron = vercel.crons.find((c) => c.path === "/api/jobs/alertas");
    expect(cron?.schedule).toBe(`*/${INTERVALO_VERIFICACAO_MIN} * * * *`);
    expect(folgaDoFechamentoMin()).toBe(2 * INTERVALO_VERIFICACAO_MIN);
  });

  it("o ciclo de vida usa os numeros de regras.ts", () => {
    expect(textoCicloDeVida()).toContain("a cada 6 horas");
    expect(textoCicloDeVida()).toContain("duas verificações seguidas");
  });
});

describe("numero digitado", () => {
  it("pt-BR e ponto decimal", () => {
    expect(lerNumero("30")).toBe(30);
    expect(lerNumero("30,5")).toBe(30.5);
    expect(lerNumero(" 1.234,56 ")).toBe(1234.56);
    expect(lerNumero("30.5")).toBe(30.5);
    expect(lerNumero("1.000")).toBe(1000);
    expect(lerNumero("")).toBeNull();
    expect(lerNumero("abc")).toBeNull();
  });
  it("formatarLimite volta pelo lerNumero", () => {
    expect(formatarLimite(30)).toBe("30,00");
    expect(lerNumero(formatarLimite(1234.5))).toBe(1234.5);
  });
});

describe("erros em palavras humanas", () => {
  it("silenciar", () => {
    expect(erroDeSilenciar(401)).toMatch(/sessão expirou/);
    expect(erroDeSilenciar(404)).toMatch(/não existe mais/);
    expect(erroDeSilenciar(0)).toMatch(/Sem conexão/);
    expect(erroDeSilenciar(500, "relation alertas does not exist")).not.toMatch(/relation/);
    expect(erroDeSilenciar(400, "Silenciar: de 0 a 168 horas.")).toBe("Silenciar: de 0 a 168 horas.");
  });

  it("telegram", () => {
    expect(erroDoTelegram(200, "Telegram recusou: Bad Request: chat not found")).toMatch(/não achou esse chat/);
    expect(erroDoTelegram(200, "Telegram recusou: Unauthorized")).toMatch(/recusou o token/);
    expect(erroDoTelegram(200, "Telegram recusou: Forbidden: bot was blocked by the user")).toMatch(/\/start/);
    expect(erroDoTelegram(500, "Não foi possível salvar: duplicate key")).not.toMatch(/duplicate/);
    // Mensagem que a rota ja escreve para o lojista passa como esta.
    expect(erroDoTelegram(400, "Chat id inválido: use só números (grupo começa com -).")).toBe(
      "Chat id inválido: use só números (grupo começa com -)."
    );
  });
});
