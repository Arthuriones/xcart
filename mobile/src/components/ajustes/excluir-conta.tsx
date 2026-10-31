import { useCallback, useEffect, useRef, useState } from "react";
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, View } from "react-native";
import Feather from "@expo/vector-icons/Feather";
import { Botao, Campo, Cartao, Tela, Texto } from "@/components/ui";
import { chamar, ErroApi, PRAZO_LONGO_MS } from "@/lib/api";
import { ESPACO, useCores } from "@/lib/tema";

// ============================================================================
// Excluir a conta pelo app (Apple 5.1.1(v) e Google Play exigem o caminho
// dentro do app). DELETE /api/app/v1/conta { confirmacao: <e-mail> }: o
// servidor confere o e-mail, cancela a assinatura ANTES (se nao cancelar, nao
// apaga) e so entao apaga a conta. A frase de erro vem pronta de la.
//
// Tela cheia (pageSheet no iPhone) em vez de caixa sobre fundo escurecido: o
// fundo da tela e um token do tema, e o teclado tem espaco para o campo.
// ============================================================================

/** Como o servidor compara: maiuscula e espaco nao contam. */
function normalizar(v: string): string {
  return v.replace(/\s+/g, "").toLowerCase();
}

/** Tempo para a pessoa ler "Conta excluída" antes de voltar ao login. */
const ESPERA_ANTES_DE_SAIR_MS = 2500;

export function ModalExcluirConta({
  visivel,
  email,
  aoFechar,
  aoExcluida,
}: {
  visivel: boolean;
  /** E-mail da conta; null = desconhecido (o servidor confere de qualquer jeito). */
  email: string | null;
  aoFechar: () => void;
  /** Chamado uma vez, depois de mostrar "Conta excluída": quem chama faz o sair(). Estavel (useCallback), senao o prazo reinicia. */
  aoExcluida: () => void;
}) {
  const c = useCores();
  const [digitado, setDigitado] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [excluida, setExcluida] = useState(false);
  const saiu = useRef(false);

  // Abriu de novo: comeca limpo (o e-mail digitado da ultima vez nao fica la).
  useEffect(() => {
    if (visivel && !excluida) {
      setDigitado("");
      setErro(null);
    }
  }, [visivel, excluida]);

  // O timer e o botao "Ok" podem chegar juntos: o sair() do pai roda uma vez so.
  const sair = useCallback(() => {
    if (saiu.current) return;
    saiu.current = true;
    aoExcluida();
  }, [aoExcluida]);

  useEffect(() => {
    if (!excluida) return;
    const t = setTimeout(sair, ESPERA_ANTES_DE_SAIR_MS);
    return () => clearTimeout(t);
  }, [excluida, sair]);

  const confere = email ? normalizar(digitado) === normalizar(email) : normalizar(digitado).length > 0;

  async function excluir() {
    if (!confere || enviando) return;
    setEnviando(true);
    setErro(null);
    try {
      await chamar<{ ok: true; excluida: true }>("/api/app/v1/conta", {
        metodo: "DELETE",
        corpo: { confirmacao: digitado.trim() },
        prazoMs: PRAZO_LONGO_MS,
      });
      setExcluida(true);
    } catch (e) {
      setErro(e instanceof ErroApi ? e.message : "Não deu para excluir a conta agora. Tente de novo em instantes.");
    } finally {
      setEnviando(false);
    }
  }

  function fechar() {
    if (excluida) return sair();
    // Com o pedido no ar, fechar esconderia o resultado (a conta pode ter sido apagada).
    if (!enviando) aoFechar();
  }

  return (
    <Modal visible={visivel} animationType="slide" presentationStyle="pageSheet" onRequestClose={fechar}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <Tela bordas={["top", "bottom"]} rolar={false} estilo={{ padding: 0, gap: 0 }}>
          {excluida ? (
            <View style={{ flex: 1, justifyContent: "center", padding: ESPACO[4] }}>
              <Cartao estilo={{ alignItems: "flex-start", gap: ESPACO[3] }}>
                <Feather name="check-circle" size={28} color={c.ok} />
                <Texto variante="titulo">Conta excluída</Texto>
                <Texto variante="denso" cor={c.t1}>
                  Sua conta e os dados dela foram apagados do Panda Track. Você vai voltar para a tela de entrada.
                </Texto>
                <Botao titulo="Ok" aoTocar={sair} estilo={{ alignSelf: "stretch" }} />
              </Cartao>
            </View>
          ) : (
            <>
              <View
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  justifyContent: "space-between",
                  paddingLeft: ESPACO[4],
                  paddingRight: ESPACO[1],
                  paddingVertical: ESPACO[1],
                }}
              >
                <Texto variante="titulo">Excluir conta</Texto>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Fechar"
                  disabled={enviando}
                  onPress={fechar}
                  style={({ pressed }) => ({
                    width: 48,
                    height: 48,
                    alignItems: "center",
                    justifyContent: "center",
                    opacity: enviando ? 0.4 : pressed ? 0.6 : 1,
                  })}
                >
                  <Feather name="x" size={22} color={c.t1} />
                </Pressable>
              </View>

              <ScrollView
                keyboardShouldPersistTaps="handled"
                contentContainerStyle={{ padding: ESPACO[4], paddingTop: ESPACO[2], gap: ESPACO[4], paddingBottom: ESPACO[8] }}
              >
                <Texto variante="corpo" cor={c.t1}>
                  Isto apaga a sua conta e todos os dados dela no Panda Track: lojas conectadas, pedidos, custos,
                  rastreamento e configurações.
                </Texto>

                <Cartao estilo={{ gap: ESPACO[3] }}>
                  <Item icone="credit-card">A assinatura é cancelada e nada mais é cobrado.</Item>
                  <Item icone="bell-off">Este celular para de receber o aviso de venda.</Item>
                  <Item icone="alert-triangle" perigo>
                    Não tem volta: a conta e os dados não podem ser recuperados.
                  </Item>
                </Cartao>

                <Texto variante="denso" cor={c.t2}>
                  Suas lojas na Shopify e as contas de anúncio continuam como estão; só deixam de estar ligadas ao Panda
                  Track.
                </Texto>

                <Campo
                  rotulo="Digite o e-mail da conta para confirmar"
                  value={digitado}
                  onChangeText={(t) => {
                    setDigitado(t);
                    if (erro) setErro(null);
                  }}
                  placeholder={email ?? "voce@empresa.com"}
                  autoCapitalize="none"
                  autoCorrect={false}
                  autoComplete="off"
                  keyboardType="email-address"
                  returnKeyType="done"
                  editable={!enviando}
                  onSubmitEditing={() => void excluir()}
                  erro={erro}
                  ajuda={email && digitado && !confere ? "Ainda não é o e-mail desta conta." : undefined}
                />

                <View style={{ gap: ESPACO[2] }}>
                  <Botao
                    titulo="Excluir minha conta"
                    tipo="perigo"
                    aoTocar={() => void excluir()}
                    carregando={enviando}
                    desativado={!confere}
                  />
                  <Botao titulo="Cancelar" tipo="secundario" aoTocar={fechar} desativado={enviando} />
                </View>
              </ScrollView>
            </>
          )}
        </Tela>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function Item({
  icone,
  perigo,
  children,
}: {
  icone: "credit-card" | "bell-off" | "alert-triangle";
  perigo?: boolean;
  children: string;
}) {
  const c = useCores();
  return (
    <View style={{ flexDirection: "row", gap: ESPACO[3], alignItems: "flex-start" }}>
      <Feather name={icone} size={18} color={perigo ? c.err : c.t2} style={{ marginTop: 1 }} />
      <View style={{ flex: 1 }}>
        <Texto variante="denso" cor={perigo ? c.err : c.t1}>
          {children}
        </Texto>
      </View>
    </View>
  );
}
