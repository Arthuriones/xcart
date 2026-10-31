import { useRef, useState } from "react";
import { Image, KeyboardAvoidingView, Linking, Platform, View, type TextInputInstance } from "react-native";
import { Botao, Campo, Tela, Texto } from "@/components/ui";
import { useSessao } from "@/lib/sessao";
import { supabaseConfigurado } from "@/lib/supabase";
import { API_URL } from "@/lib/api";
import { ESPACO, useCores } from "@/lib/tema";

// ============================================================================
// Login com a mesma conta do site (e-mail e senha). Sem "criar conta" nem
// plano aqui: a conta nasce no site (regra 3.1.1 da Apple, nada de compra no
// app). "Esqueci a senha" abre a pagina do site.
// ============================================================================

const ICONE = require("../../assets/icon.png");

export default function Login() {
  const c = useCores();
  const { entrar } = useSessao();
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const campoSenha = useRef<TextInputInstance>(null);

  async function enviar() {
    if (!email.trim() || !senha) {
      setErro("Preencha o e-mail e a senha.");
      return;
    }
    setEnviando(true);
    setErro(null);
    const falha = await entrar(email, senha);
    setEnviando(false);
    if (falha) setErro(falha);
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <Tela bordas={["top", "bottom"]} estilo={{ flexGrow: 1, justifyContent: "center", maxWidth: 440, width: "100%", alignSelf: "center" }}>
        <View style={{ alignItems: "center", gap: ESPACO[3], marginBottom: ESPACO[4] }}>
          <Image source={ICONE} style={{ width: 72, height: 72, borderRadius: 18 }} accessibilityIgnoresInvertColors />
          <Texto variante="titulo">Panda Track</Texto>
          <Texto variante="denso" cor={c.t2} estilo={{ textAlign: "center" }}>
            Entre com a mesma conta do site para ver o lucro e as vendas no celular.
          </Texto>
        </View>

        {!supabaseConfigurado ? (
          <Texto variante="denso" cor={c.err}>
            Esta versão do app está sem a configuração do login.
          </Texto>
        ) : null}

        <Campo
          rotulo="E-mail"
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          autoComplete="email"
          keyboardType="email-address"
          textContentType="emailAddress"
          placeholder="voce@empresa.com"
          returnKeyType="next"
          submitBehavior="submit"
          onSubmitEditing={() => campoSenha.current?.focus()}
        />
        <Campo
          ref={campoSenha}
          rotulo="Senha"
          value={senha}
          onChangeText={setSenha}
          secureTextEntry
          autoComplete="password"
          textContentType="password"
          placeholder="Sua senha"
          returnKeyType="go"
          onSubmitEditing={enviar}
          erro={erro}
        />
        <Botao titulo="Entrar" aoTocar={enviar} carregando={enviando} estilo={{ marginTop: ESPACO[2] }} />
        <Botao titulo="Esqueci a senha" tipo="texto" aoTocar={() => Linking.openURL(`${API_URL}/login`)} />
      </Tela>
    </KeyboardAvoidingView>
  );
}
