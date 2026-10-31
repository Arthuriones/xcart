import { useCallback, useState } from "react";
import { Alert, Linking, Platform, View } from "react-native";
import Constants from "expo-constants";
import { Botao, Cartao, Divisor, LinhaValor, Tela, Texto } from "@/components/ui";
import { LinhaLink, Secao } from "@/components/ajustes/pecas";
import { SecaoNotificacoes, useAvisoDeVenda, useSituacaoDoCelular } from "@/components/ajustes/notificacoes";
import { ModalExcluirConta } from "@/components/ajustes/excluir-conta";
import { API_URL } from "@/lib/api";
import { useFiltro } from "@/lib/filtro";
import { useSessao } from "@/lib/sessao";
import { ESPACO, useCores } from "@/lib/tema";

// ============================================================================
// Ajustes: conta, notificacoes, sobre, sair e excluir conta.
//
// As rotas daqui (notificacoes, conta, aparelhos) aceitam o plano vencido --
// desligar o aviso e excluir a conta nao podem depender de pagar. Nada aqui
// usa o filtro do topo: a preferencia de venda e da conta inteira.
// ============================================================================

const SAIR_TITULO = "Sair do Panda Track?";
const SAIR_TEXTO = "Este celular para de receber o aviso de venda até você entrar de novo.";

export default function Ajustes() {
  const c = useCores();
  const { eu, recarregar } = useFiltro();
  const { email: emailDaSessao, sair } = useSessao();
  const aviso = useAvisoDeVenda();
  const celular = useSituacaoDoCelular();
  const [atualizando, setAtualizando] = useState(false);
  const [saindo, setSaindo] = useState(false);
  const [excluindo, setExcluindo] = useState(false);
  const [erroLink, setErroLink] = useState<string | null>(null);

  const email = eu?.usuario.email ?? emailDaSessao;
  const nome = [eu?.usuario.nome, eu?.usuario.sobrenome].filter(Boolean).join(" ") || null;
  const versao = Constants.expoConfig?.version ?? "—";

  const atualizar = useCallback(async () => {
    setAtualizando(true);
    // O /eu so e lido de novo se falhou: recarregar troca o filtro de todas as abas.
    if (!eu) recarregar();
    await Promise.all([aviso.recarregar(), celular.conferir()]);
    setAtualizando(false);
  }, [eu, recarregar, aviso, celular]);

  const sairAgora = useCallback(async () => {
    setSaindo(true);
    try {
      await sair();
    } finally {
      // Com a sessao fora, a tela de login substitui esta; isto so vale se o sair falhar.
      setSaindo(false);
    }
  }, [sair]);

  function confirmarSaida() {
    // No navegador o Alert do React Native nao abre nada: o confirm do navegador faz o papel.
    if (Platform.OS === "web") {
      if (window.confirm(`${SAIR_TITULO}\n\n${SAIR_TEXTO}`)) void sairAgora();
      return;
    }
    Alert.alert(SAIR_TITULO, SAIR_TEXTO, [
      { text: "Cancelar", style: "cancel" },
      { text: "Sair", style: "destructive", onPress: () => void sairAgora() },
    ]);
  }

  function abrirPagina(caminho: string) {
    setErroLink(null);
    Linking.openURL(API_URL + caminho).catch(() => {
      setErroLink(`Não deu para abrir o navegador. O endereço é ${API_URL}${caminho}`);
    });
  }

  const aoExcluida = useCallback(() => {
    void sair();
  }, [sair]);

  return (
    <Tela atualizando={atualizando} aoAtualizar={() => void atualizar()}>
      <Texto variante="titulo">Ajustes</Texto>

      <Secao titulo="Conta">
        <Cartao estilo={{ gap: 2 }}>
          <Texto variante="subtitulo" linhas={2}>
            {nome ?? email ?? "Sua conta"}
          </Texto>
          {nome && email ? (
            <Texto variante="denso" cor={c.t2} linhas={1}>
              {email}
            </Texto>
          ) : null}
        </Cartao>
      </Secao>

      <Secao titulo="Notificações">
        <SecaoNotificacoes aviso={aviso} celular={celular} />
      </Secao>

      <Secao titulo="Sobre">
        <Cartao estilo={{ gap: 0, paddingVertical: ESPACO[1] }}>
          <View style={{ minHeight: 48, justifyContent: "center" }}>
            <LinhaValor rotulo="Versão do app" valor={versao} />
          </View>
          <Divisor />
          <LinhaLink rotulo="Política de privacidade" aoTocar={() => abrirPagina("/privacy")} />
          <Divisor />
          <LinhaLink rotulo="Termos de uso" aoTocar={() => abrirPagina("/terms")} />
        </Cartao>
        {erroLink ? (
          <Texto variante="rotulo" cor={c.err}>
            {erroLink}
          </Texto>
        ) : null}
      </Secao>

      <View style={{ marginTop: ESPACO[4] }}>
        <Botao titulo="Sair" tipo="secundario" aoTocar={confirmarSaida} carregando={saindo} />
      </View>

      <Secao titulo="Excluir conta">
        <Cartao estilo={{ gap: ESPACO[3] }}>
          <Texto variante="denso" cor={c.t1}>
            Apaga a conta e os dados no Panda Track e cancela a assinatura. Não tem volta.
          </Texto>
          <Botao titulo="Excluir conta" tipo="perigo" aoTocar={() => setExcluindo(true)} />
        </Cartao>
      </Secao>

      <ModalExcluirConta
        visivel={excluindo}
        email={email}
        aoFechar={() => setExcluindo(false)}
        aoExcluida={aoExcluida}
      />
    </Tela>
  );
}
