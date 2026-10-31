import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, Linking, Pressable, View } from "react-native";
import Feather from "@expo/vector-icons/Feather";
import { Botao, Carregando, Cartao, Divisor, EstadoErro, Interruptor, Texto } from "@/components/ui";
import { chamar, ErroApi } from "@/lib/api";
import { fraseDoPush, registrarAparelho, type SituacaoPush } from "@/lib/push";
import { ESPACO, useCores } from "@/lib/tema";

// ============================================================================
// Notificacoes da tela de Ajustes, em duas partes que nao se confundem:
//
// - "Aviso de cada venda" e da CONTA (alerta_config.notificar_vendas, a mesma
//   chave do liga/desliga do site): desligar aqui para o push de todos os
//   celulares E os webhooks de celular do site.
// - "Este celular" e do APARELHO: se a permissao foi dada e o token registrou.
//   A conta pode estar ligada e este celular bloqueado, ou o contrario.
// ============================================================================

type RespostaNotificacoes = { ok: true; vendas: boolean };

function fraseDoErro(e: unknown, padrao: string): string {
  return e instanceof ErroApi ? e.message : padrao;
}

export interface AvisoDeVenda {
  /** null = ainda nao leu (ou a leitura falhou: ver `erro`). */
  vendas: boolean | null;
  erro: string | null;
  salvando: boolean;
  erroAoSalvar: string | null;
  recarregar: () => Promise<void>;
  mudar: (novo: boolean) => void;
}

export function useAvisoDeVenda(): AvisoDeVenda {
  const [vendas, setVendas] = useState<boolean | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [erroAoSalvar, setErroAoSalvar] = useState<string | null>(null);
  const vivo = useRef(true);

  useEffect(() => {
    vivo.current = true;
    return () => {
      vivo.current = false;
    };
  }, []);

  const recarregar = useCallback(async () => {
    setErro(null);
    try {
      // Sem filtro: a preferencia e da conta, vale para todas as lojas.
      const r = await chamar<RespostaNotificacoes>("/api/app/v1/notificacoes");
      if (vivo.current) setVendas(r.vendas);
    } catch (e) {
      if (vivo.current) setErro(fraseDoErro(e, "Não deu para ler as notificações agora."));
    }
  }, []);

  useEffect(() => {
    void recarregar();
  }, [recarregar]);

  const mudar = useCallback(
    (novo: boolean) => {
      if (salvando || vendas === null) return;
      const antes = vendas;
      // Otimista: o interruptor responde ao toque; se o servidor recusar, volta.
      setVendas(novo);
      setSalvando(true);
      setErroAoSalvar(null);
      chamar<RespostaNotificacoes>("/api/app/v1/notificacoes", { metodo: "PATCH", corpo: { vendas: novo } })
        .then((r) => {
          if (vivo.current) setVendas(r.vendas);
        })
        .catch((e: unknown) => {
          if (!vivo.current) return;
          setVendas(antes);
          setErroAoSalvar(fraseDoErro(e, "Não deu para salvar agora. Tente de novo."));
        })
        .finally(() => {
          if (vivo.current) setSalvando(false);
        });
    },
    [salvando, vendas]
  );

  return { vendas, erro, salvando, erroAoSalvar, recarregar, mudar };
}

export interface SituacaoDoCelular {
  /** null = conferindo. */
  situacao: SituacaoPush | null;
  conferir: () => Promise<void>;
  abrirAjustesDoCelular: () => void;
}

export function useSituacaoDoCelular(): SituacaoDoCelular {
  const [situacao, setSituacao] = useState<SituacaoPush | null>(null);
  const vivo = useRef(true);
  // So reconfere ao voltar para o app se a pessoa foi aos ajustes por aqui:
  // reconferir em toda volta faria o Android pedir a permissao de novo a cada troca de app.
  const foiAosAjustes = useRef(false);

  useEffect(() => {
    vivo.current = true;
    return () => {
      vivo.current = false;
    };
  }, []);

  const conferir = useCallback(async () => {
    let s: SituacaoPush;
    try {
      // Registrar de novo e o que renova o prazo de 30 dias do aparelho no servidor.
      s = await registrarAparelho();
    } catch (e) {
      s = { ok: false, motivo: "falhou", detalhe: e instanceof Error ? e.message : undefined };
    }
    if (vivo.current) setSituacao(s);
  }, []);

  useEffect(() => {
    void conferir();
  }, [conferir]);

  useEffect(() => {
    const sub = AppState.addEventListener("change", (estado) => {
      if (estado === "active" && foiAosAjustes.current) {
        foiAosAjustes.current = false;
        void conferir();
      }
    });
    return () => sub.remove();
  }, [conferir]);

  const abrirAjustesDoCelular = useCallback(() => {
    foiAosAjustes.current = true;
    Linking.openSettings().catch(() => {
      foiAosAjustes.current = false;
    });
  }, []);

  return { situacao, conferir, abrirAjustesDoCelular };
}

/**
 * Linha inteira tocavel: o Switch sozinho tem ~31px de altura, abaixo dos 44
 * do alvo de toque. O Switch fica so de desenho (pointerEvents none) para o
 * toque nao ser tratado duas vezes -- no navegador o clique subiria ate a linha.
 */
function LinhaInterruptor({
  titulo,
  descricao,
  valor,
  aoMudar,
  desativado,
}: {
  titulo: string;
  descricao: string;
  valor: boolean;
  aoMudar: (v: boolean) => void;
  desativado: boolean;
}) {
  const c = useCores();
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityLabel={titulo}
      accessibilityHint={descricao}
      accessibilityState={{ checked: valor, disabled: desativado }}
      disabled={desativado}
      onPress={() => aoMudar(!valor)}
      style={{ minHeight: 48, flexDirection: "row", alignItems: "center", gap: ESPACO[3] }}
    >
      <View style={{ flex: 1, gap: 2 }}>
        <Texto variante="denso" peso="media">
          {titulo}
        </Texto>
        <Texto variante="rotulo" cor={c.t2}>
          {descricao}
        </Texto>
      </View>
      <View pointerEvents="none" importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
        <Interruptor valor={valor} aoMudar={aoMudar} desativado={desativado} rotulo={titulo} />
      </View>
    </Pressable>
  );
}

function iconeDoCelular(s: SituacaoPush | null): "bell" | "bell-off" | "smartphone" {
  if (!s) return "smartphone";
  if (s.ok) return "bell";
  return s.motivo === "negado" || s.motivo === "falhou" ? "bell-off" : "smartphone";
}

export function SecaoNotificacoes({ aviso, celular }: { aviso: AvisoDeVenda; celular: SituacaoDoCelular }) {
  const c = useCores();
  const s = celular.situacao;
  const corIcone = !s ? c.t3 : s.ok ? c.ok : s.motivo === "negado" || s.motivo === "falhou" ? c.warn : c.t3;

  return (
    <>
      {aviso.vendas === null && aviso.erro ? (
        <EstadoErro mensagem={aviso.erro} aoTentar={() => void aviso.recarregar()} />
      ) : aviso.vendas === null ? (
        <Cartao>
          <Carregando texto="Lendo as notificações…" />
        </Cartao>
      ) : (
        <Cartao>
          <LinhaInterruptor
            titulo="Aviso de cada venda"
            descricao="Uma notificação a cada pedido novo."
            valor={aviso.vendas}
            aoMudar={aviso.mudar}
            desativado={aviso.salvando}
          />
          {aviso.erroAoSalvar ? (
            <Texto variante="rotulo" cor={c.err}>
              {aviso.erroAoSalvar}
            </Texto>
          ) : null}
          <Divisor />
          <Texto variante="rotulo" cor={c.t3}>
            Vale para todas as lojas. Desligar aqui também desliga os webhooks de celular configurados no site.
          </Texto>
        </Cartao>
      )}

      <Cartao estilo={{ gap: ESPACO[3] }}>
        <View style={{ flexDirection: "row", gap: ESPACO[3], alignItems: "flex-start" }}>
          <Feather name={iconeDoCelular(s)} size={20} color={corIcone} style={{ marginTop: 1 }} />
          <View style={{ flex: 1, gap: 2 }}>
            <Texto variante="denso" peso="media">
              Este celular
            </Texto>
            <Texto variante="denso" cor={c.t1}>
              {s ? fraseDoPush(s) : "Conferindo este celular…"}
            </Texto>
            {s?.ok && aviso.vendas === false ? (
              <Texto variante="rotulo" cor={c.t3}>
                Com o aviso de venda desligado, nenhuma notificação chega aqui.
              </Texto>
            ) : null}
          </View>
        </View>
        {s && !s.ok && s.motivo === "negado" ? (
          <Botao titulo="Abrir ajustes do celular" tipo="secundario" aoTocar={celular.abrirAjustesDoCelular} />
        ) : null}
        {s && !s.ok && s.motivo === "falhou" ? (
          <Botao titulo="Tentar de novo" tipo="secundario" aoTocar={() => void celular.conferir()} />
        ) : null}
      </Cartao>
    </>
  );
}
