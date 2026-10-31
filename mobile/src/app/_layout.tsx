import { useEffect } from "react";
import { Platform } from "react-native";
import { SplashScreen, Stack, router } from "expo-router";
import { StatusBar } from "expo-status-bar";
import * as Notifications from "expo-notifications";
import { useFonts } from "expo-font";
import {
  InstrumentSans_400Regular,
  InstrumentSans_500Medium,
  InstrumentSans_600SemiBold,
  InstrumentSans_700Bold,
} from "@expo-google-fonts/instrument-sans";
import { ProvedorSessao, useSessao } from "@/lib/sessao";
import { ProvedorFiltro } from "@/lib/filtro";
import { configurarNotificacoes } from "@/lib/push";
import { useCores } from "@/lib/tema";

// ============================================================================
// Raiz do app: fontes, splash e a porta do login. Sem sessao so existe a tela
// de login; com sessao e plano, as abas; com sessao e plano vencido, a tela
// neutra de "sem acesso" (nada de preco nem link de compra: Apple 3.1.1).
// Tocar na notificacao de venda abre o Dashboard.
// ============================================================================

SplashScreen.preventAutoHideAsync().catch(() => {});
configurarNotificacoes();

function Navegacao() {
  const { carregando, sessao, semAcesso } = useSessao();
  const c = useCores();
  const usuarioId = sessao?.user.id ?? null;

  useEffect(() => {
    if (!carregando) SplashScreen.hideAsync().catch(() => {});
  }, [carregando]);

  // Notificacao tocada (com o app fechado ou aberto) -> Dashboard.
  useEffect(() => {
    if (Platform.OS === "web" || !usuarioId) return;
    const abrir = (r: Notifications.NotificationResponse | null) => {
      if (!r) return;
      const url = r.notification.request.content.data?.url;
      if (typeof url === "string" && url.startsWith("/")) router.push(url as never);
      else router.push("/");
      // Sem limpar, o ultimo toque voltaria a abrir o Dashboard na proxima montagem.
      Notifications.clearLastNotificationResponse();
    };
    abrir(Notifications.getLastNotificationResponse());
    const sub = Notifications.addNotificationResponseReceivedListener(abrir);
    return () => sub.remove();
    // So na troca de usuario: a sessao muda de objeto a cada renovacao do token.
  }, [usuarioId]);

  if (carregando) return null;
  const logado = Boolean(sessao);

  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: c.bg } }}>
      <Stack.Protected guard={logado && !semAcesso}>
        <Stack.Screen name="(abas)" />
      </Stack.Protected>
      <Stack.Protected guard={logado && semAcesso}>
        <Stack.Screen name="sem-acesso" />
      </Stack.Protected>
      <Stack.Protected guard={!logado}>
        <Stack.Screen name="login" />
      </Stack.Protected>
    </Stack>
  );
}

function ComSessao() {
  const { sessao } = useSessao();
  // O filtro (e o /eu) so existe com login; trocar de conta recomeca do zero.
  return sessao ? (
    <ProvedorFiltro key={sessao.user.id}>
      <Navegacao />
    </ProvedorFiltro>
  ) : (
    <Navegacao />
  );
}

export default function Raiz() {
  const [fontes, erroFontes] = useFonts({
    InstrumentSans_400Regular,
    InstrumentSans_500Medium,
    InstrumentSans_600SemiBold,
    InstrumentSans_700Bold,
  });
  if (!fontes && !erroFontes) return null;
  return (
    <ProvedorSessao>
      <StatusBar style="auto" />
      <ComSessao />
    </ProvedorSessao>
  );
}
