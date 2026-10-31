import { useCallback, useState } from "react";
import { View } from "react-native";
import { Botao, Cartao, Interruptor, Tela, Texto } from "@/components/ui";
import { useAvisoDeVenda } from "@/components/ajustes/notificacoes";
import { ModalExcluirConta } from "@/components/ajustes/excluir-conta";
import { useFiltro } from "@/lib/filtro";
import { useSessao } from "@/lib/sessao";
import { ESPACO, useCores } from "@/lib/tema";

// ============================================================================
// Plano vencido (403 sem_acesso). Tela NEUTRA: sem preco, sem plano e sem link
// de compra -- a Apple recusa app que leva a compra para fora (regra 3.1.1).
//
// Mesmo sem plano a pessoa precisa conseguir desligar o aviso de venda e
// excluir a conta (Apple 5.1.1(v)): as rotas /notificacoes e /conta aceitam o
// plano vencido de proposito, e esta tela da acesso as duas.
// ============================================================================

export default function SemAcesso() {
  const c = useCores();
  const { email, sair, conferirDeNovo } = useSessao();
  const { recarregar } = useFiltro();
  const aviso = useAvisoDeVenda();
  const [excluindo, setExcluindo] = useState(false);

  const verificar = useCallback(() => {
    // O /eu da abertura pode ter dado o mesmo 403: le de novo junto.
    conferirDeNovo();
    recarregar();
  }, [conferirDeNovo, recarregar]);

  const aoExcluida = useCallback(() => {
    void sair();
  }, [sair]);

  return (
    <Tela bordas={["top", "bottom"]} estilo={{ flexGrow: 1, justifyContent: "center" }}>
      <Cartao estilo={{ gap: ESPACO[3] }}>
        <Texto variante="titulo">Sua conta está sem acesso agora</Texto>
        <Texto variante="denso" cor={c.t1}>
          A conta {email ?? ""} não está com o acesso ao Panda Track liberado neste momento.
        </Texto>
        <View style={{ gap: ESPACO[2], marginTop: ESPACO[2] }}>
          <Botao titulo="Verificar de novo" aoTocar={verificar} />
          <Botao titulo="Sair" tipo="secundario" aoTocar={() => void sair()} />
        </View>
      </Cartao>

      <Cartao estilo={{ gap: ESPACO[2] }}>
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: ESPACO[3] }}>
          <View style={{ flex: 1, gap: 2 }}>
            <Texto variante="denso" peso="seminegrito">
              Aviso de cada venda
            </Texto>
            <Texto variante="rotulo" cor={c.t2}>
              {aviso.erro ?? aviso.erroAoSalvar ?? "Vale para todas as lojas da conta."}
            </Texto>
          </View>
          <Interruptor
            rotulo="Aviso de cada venda"
            valor={aviso.vendas === true}
            desativado={aviso.vendas === null || aviso.salvando}
            aoMudar={aviso.mudar}
          />
        </View>
      </Cartao>

      <Cartao estilo={{ gap: ESPACO[3] }}>
        <Texto variante="denso" cor={c.t1}>
          Excluir a conta apaga os dados no Panda Track e cancela a assinatura. Não tem volta.
        </Texto>
        <Botao titulo="Excluir conta" tipo="perigo" aoTocar={() => setExcluindo(true)} />
      </Cartao>

      <ModalExcluirConta visivel={excluindo} email={email} aoFechar={() => setExcluindo(false)} aoExcluida={aoExcluida} />
    </Tela>
  );
}
