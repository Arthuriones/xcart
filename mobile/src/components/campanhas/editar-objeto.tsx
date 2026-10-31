import { useEffect, useState, type ReactNode } from "react";
import { Modal, ScrollView, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Botao, Campo, Carregando, Cartao, Divisor, EstadoErro, Texto } from "@/components/ui";
import { chamar, PRAZO_LONGO_MS } from "@/lib/api";
import { dinheiro, lerNumero } from "@/lib/formato";
import { ESPACO, useCores } from "@/lib/tema";
import type { LinhaCampanha, NivelEdicao, ObjetoAoVivo } from "@/lib/tipos";
import { confirmar } from "./confirmar";
import { AlvoInterruptor } from "./controles";
import {
  calcular,
  caminhoDoObjeto,
  camposDoObjeto,
  esperadoDe,
  formularioDe,
  fraseDoErro,
  motivoDoStatus,
  nivelEditavel,
  NOME_DO_NIVEL,
  objetoDoConflito,
  semLance,
  semOrcamento,
  textoDoCampo,
  type Formulario,
} from "./regras";

// ============================================================================
// Edicao basica de um objeto do Meta (campanha, conjunto, anuncio): ligar/
// pausar, orcamento diario OU total de quem o tem, lance e ROAS minimo --
// sempre DENTRO da estrategia que ja existe. Abre lendo o estado AO VIVO
// (/api/ads/meta/objeto), nunca o da lista (sync de 15 min), e salva tudo num
// POST so: o Meta aceita uma edicao por objeto a cada 30 s, e o segundo campo
// em outra chamada tomaria o erro.
// ============================================================================

type RespostaObjeto = { ok: true; objeto: ObjetoAoVivo };
type Carga = { fase: "carregando" } | { fase: "erro"; erro: string } | { fase: "pronto"; objeto: ObjetoAoVivo };

export function EditarObjeto({
  linha,
  aoFechar,
  aoSalvo,
}: {
  /** A linha a editar; null = fechado. */
  linha: LinhaCampanha | null;
  aoFechar: () => void;
  aoSalvo: (linha: LinhaCampanha, objeto: ObjetoAoVivo) => void;
}) {
  const c = useCores();
  // A linha fica na tela durante a animacao de saida (senao a folha desce vazia),
  // e cada abertura monta o painel de novo: le o Meta de novo.
  const [anterior, setAnterior] = useState<LinhaCampanha | null>(null);
  const [mostrada, setMostrada] = useState<LinhaCampanha | null>(null);
  const [abertura, setAbertura] = useState(0);
  const [preso, setPreso] = useState(false);
  if (linha !== anterior) {
    setAnterior(linha);
    if (linha) {
      setMostrada(linha);
      setAbertura((n) => n + 1);
    }
  }

  const nivel = mostrada ? nivelEditavel(mostrada) : null;
  // Salvando: o Voltar do Android e o arrastar do iOS nao fecham (o pedido ao Meta ja saiu).
  const fechar = () => {
    if (!preso) aoFechar();
  };

  return (
    <Modal
      visible={linha !== null && nivel !== null}
      animationType="slide"
      presentationStyle="pageSheet"
      allowSwipeDismissal={!preso}
      backdropColor={c.bg}
      onRequestClose={fechar}
    >
      {mostrada && nivel ? (
        <Painel
          key={abertura}
          linha={mostrada}
          nivel={nivel}
          aoPrender={setPreso}
          aoFechar={fechar}
          aoSalvo={(objeto) => {
            setPreso(false);
            aoSalvo(mostrada, objeto);
          }}
        />
      ) : null}
    </Modal>
  );
}

function Painel({
  linha,
  nivel,
  aoPrender,
  aoFechar,
  aoSalvo,
}: {
  linha: LinhaCampanha;
  nivel: NivelEdicao;
  aoPrender: (v: boolean) => void;
  aoFechar: () => void;
  aoSalvo: (objeto: ObjetoAoVivo) => void;
}) {
  const c = useCores();
  const [tentativa, setTentativa] = useState(0);
  const [carga, setCarga] = useState<Carga>({ fase: "carregando" });
  const [form, setForm] = useState<Formulario>({ ligado: false, valores: {} });
  const [tentouSalvar, setTentouSalvar] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [mudouNoMeta, setMudouNoMeta] = useState(false);

  useEffect(() => {
    let vivo = true;
    setCarga({ fase: "carregando" });
    chamar<RespostaObjeto>(caminhoDoObjeto(linha.contaId, nivel, linha.objetoId))
      .then((r) => {
        if (!vivo) return;
        setCarga({ fase: "pronto", objeto: r.objeto });
        setForm(formularioDe(r.objeto));
      })
      .catch((e: unknown) => {
        if (vivo) setCarga({ fase: "erro", erro: fraseDoErro(e, "Não deu para ler do Meta agora. Tente de novo.") });
      });
    return () => {
      vivo = false;
    };
  }, [linha.contaId, linha.objetoId, nivel, tentativa]);

  const objeto = carga.fase === "pronto" ? carga.objeto : null;

  const cabecalho = (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        gap: ESPACO[3],
        paddingHorizontal: ESPACO[4],
        paddingVertical: ESPACO[2],
        borderBottomWidth: 1,
        borderBottomColor: c.border,
      }}
    >
      <Texto variante="subtitulo">Editar {NOME_DO_NIVEL[nivel].toLowerCase()}</Texto>
      <Botao titulo="Fechar" tipo="texto" aoTocar={aoFechar} desativado={salvando} />
    </View>
  );

  const identidade = (
    <View style={{ gap: ESPACO[1] }}>
      <Texto variante="titulo" linhas={3}>
        {objeto?.nome || linha.nome}
      </Texto>
      <Texto variante="denso" cor={c.t2}>
        {NOME_DO_NIVEL[nivel]} · {linha.contaNome}. As mudanças vão direto para o Meta.
      </Texto>
    </View>
  );

  let corpo: ReactNode;
  if (carga.fase === "carregando") {
    corpo = <Carregando texto="Lendo o estado de agora no Meta…" />;
  } else if (carga.fase === "erro") {
    corpo = <EstadoErro mensagem={carga.erro} aoTentar={() => setTentativa((n) => n + 1)} />;
  } else if (carga.objeto.status === "ARCHIVED" || carga.objeto.status === "DELETED") {
    corpo = (
      <Cartao>
        <Texto variante="subtitulo">{carga.objeto.status === "ARCHIVED" ? "Arquivado no Meta" : "Excluído no Meta"}</Texto>
        <Texto variante="denso" cor={c.t1}>
          Não dá para editar pelo Panda Track.
        </Texto>
      </Cartao>
    );
  } else {
    corpo = (
      <CamposDaEdicao
        objeto={carga.objeto}
        form={form}
        tentouSalvar={tentouSalvar}
        salvando={salvando}
        erro={erro}
        mudouNoMeta={mudouNoMeta}
        aoMexer={(f) => {
          setForm(f);
          setMudouNoMeta(false);
          setErro(null);
        }}
        aoCancelar={aoFechar}
        aoSalvar={async () => {
          const o = carga.objeto;
          const { mudancas, erros } = calcular(o, form, lerNumero);
          setTentouSalvar(true);
          setErro(null);
          if (Object.keys(erros).length > 0 || mudancas.length === 0) return;

          const grandes = mudancas.filter((m) => m.grande);
          if (grandes.length > 0) {
            const lista = grandes
              .map((m) => {
                const antes = m.antes ?? 0;
                const depois = m.depois ?? 0;
                const pct = Math.round(((depois - antes) / (antes || 1)) * 100);
                return `${m.rotulo}: ${dinheiro(antes, o.moeda)} → ${dinheiro(depois, o.moeda)} (${pct > 0 ? "+" : ""}${pct}%)`;
              })
              .join("\n");
            const seguir = await confirmar(
              "Mudanças grandes podem reiniciar o aprendizado do Meta",
              `${lista}\n\nAcima de 20% de uma vez, o conjunto pode voltar à fase de aprendizado.`,
              "Salvar mesmo assim"
            );
            if (!seguir) return;
          }

          setSalvando(true);
          aoPrender(true);
          try {
            const r = await chamar<RespostaObjeto>("/api/ads/meta/alterar", {
              metodo: "POST",
              corpo: {
                conta: linha.contaId,
                nivel,
                id: linha.objetoId,
                mudancas: mudancas.map((m) => ({ campo: m.campo, valor: m.valor, esperado: esperadoDe(o, m.campo) })),
              },
              prazoMs: PRAZO_LONGO_MS,
            });
            setSalvando(false);
            aoSalvo(r.objeto);
          } catch (e) {
            const atual = objetoDoConflito(e);
            if (atual) {
              // Mudou no Meta desde que a tela abriu: mostra o de agora e nada vai.
              setCarga({ fase: "pronto", objeto: atual });
              setForm(formularioDe(atual));
              setMudouNoMeta(true);
              setTentouSalvar(false);
            } else {
              setErro(fraseDoErro(e));
            }
            setSalvando(false);
            aoPrender(false);
          }
        }}
      />
    );
  }

  return (
    <SafeAreaView edges={["top", "bottom"]} style={{ flex: 1, backgroundColor: c.bg }}>
      {cabecalho}
      <ScrollView
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
        automaticallyAdjustKeyboardInsets
        contentContainerStyle={{ padding: ESPACO[4], gap: ESPACO[4], paddingBottom: ESPACO[8] }}
      >
        {identidade}
        {corpo}
      </ScrollView>
    </SafeAreaView>
  );
}

function CamposDaEdicao({
  objeto: o,
  form,
  tentouSalvar,
  salvando,
  erro,
  mudouNoMeta,
  aoMexer,
  aoCancelar,
  aoSalvar,
}: {
  objeto: ObjetoAoVivo;
  form: Formulario;
  tentouSalvar: boolean;
  salvando: boolean;
  erro: string | null;
  mudouNoMeta: boolean;
  aoMexer: (f: Formulario) => void;
  aoCancelar: () => void;
  aoSalvar: () => void;
}) {
  const c = useCores();
  const defs = camposDoObjeto(o);
  const { mudancas, erros } = calcular(o, form, lerNumero);
  const temErro = Object.keys(erros).length > 0;
  const fraseOrcamento = semOrcamento(o);
  const fraseLance = semLance(o);
  // Ligado no proprio objeto, mas parado por outro nivel (campanha pausada, reprovado...).
  const motivo = o.status === "ACTIVE" && o.efetivo && o.efetivo !== "ACTIVE" ? motivoDoStatus(o.efetivo) : null;

  return (
    <View style={{ gap: ESPACO[4] }}>
      {mudouNoMeta ? (
        <Cartao estilo={{ backgroundColor: c.warnBg, borderColor: c.warn }}>
          <Texto variante="subtitulo" cor={c.warn}>
            O valor mudou no Meta
          </Texto>
          <Texto variante="denso" cor={c.t1}>
            Alguém mexeu neste item desde que a tela abriu. Os valores abaixo são os de agora: confira e salve de novo.
          </Texto>
        </Cartao>
      ) : null}

      <Cartao estilo={{ gap: ESPACO[4] }}>
        {/* A linha inteira liga/desliga: alvo grande, e o rotulo explica o que muda. */}
        <AlvoInterruptor
          rotulo="Ligado no Meta"
          valor={form.ligado}
          desativado={salvando}
          aoMudar={(v) => aoMexer({ ...form, ligado: v })}
        >
          <View style={{ flex: 1, gap: 2 }}>
            <Texto variante="denso" peso="seminegrito">
              Ligado no Meta
            </Texto>
            <Texto variante="rotulo" cor={motivo && form.ligado ? c.warn : c.t2}>
              {form.ligado ? (motivo ?? "Roda e gasta.") : "Pausado: não roda nem gasta."}
            </Texto>
          </View>
        </AlvoInterruptor>

        {defs.length > 0 || fraseOrcamento || fraseLance ? <Divisor /> : null}

        {defs.map((def) => (
          <Campo
            key={def.campo}
            rotulo={def.rotulo}
            sufixo={def.dinheiro ? o.moeda : "×"}
            inputMode="decimal"
            autoComplete="off"
            autoCorrect={false}
            editable={!salvando}
            value={form.valores[def.campo] ?? ""}
            onChangeText={(t) => aoMexer({ ...form, valores: { ...form.valores, [def.campo]: t } })}
            erro={tentouSalvar ? (erros[def.campo] ?? null) : null}
            ajuda={`Agora: ${def.dinheiro ? dinheiro(def.atual, o.moeda) : textoDoCampo(def.atual, def.casas)}${def.ajuda ? ` · ${def.ajuda}` : ""}`}
            accessibilityLabel={`${def.rotulo}${def.dinheiro ? ` em ${o.moeda}` : ""}`}
          />
        ))}

        {fraseOrcamento ? (
          <Texto variante="denso" cor={c.t2}>
            {fraseOrcamento}
          </Texto>
        ) : null}
        {fraseLance ? (
          <Texto variante="denso" cor={c.t2}>
            {fraseLance}
          </Texto>
        ) : null}
      </Cartao>

      {erro ? (
        <Texto variante="denso" peso="media" cor={c.err}>
          {erro}
        </Texto>
      ) : null}

      <View style={{ gap: ESPACO[2] }}>
        <Botao
          titulo="Salvar no Meta"
          carregando={salvando}
          desativado={!temErro && mudancas.length === 0}
          aoTocar={aoSalvar}
        />
        <Botao titulo="Cancelar" tipo="secundario" desativado={salvando} aoTocar={aoCancelar} />
      </View>
    </View>
  );
}
