import { Platform } from "react-native";
import Constants from "expo-constants";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import { chamar } from "./api";

// ============================================================================
// Push de venda: o servidor manda pelo Expo para todo aparelho registrado na
// conta (app_aparelhos, migration 084), junto dos webhooks do celular.
//
// O app registra o token a CADA abertura (o servidor renova o prazo de 30
// dias; celular que nao abre o app para de receber) e o tira ao sair, ANTES
// de descartar o login. Push remoto nao existe no Expo Go nem no navegador:
// precisa de development build (EAS) com o projectId em extra.eas.
// ============================================================================

const CHAVE_TOKEN = "pt_expo_token";

export type SituacaoPush =
  | { ok: true }
  | { ok: false; motivo: "web" | "simulador" | "negado" | "sem_projeto" | "falhou"; detalhe?: string };

/** Notificacao com o app aberto: mostra o banner e toca (padrao do SDK 58, explicito aqui). */
export function configurarNotificacoes() {
  if (Platform.OS === "web") return;
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
  });
}

function projectId(): string | undefined {
  const extra = Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined;
  return extra?.eas?.projectId ?? Constants.easConfig?.projectId ?? undefined;
}

/** Pede a permissao (se preciso), pega o token do Expo e registra na conta. */
export async function registrarAparelho(): Promise<SituacaoPush> {
  if (Platform.OS === "web") return { ok: false, motivo: "web" };
  if (!Device.isDevice) return { ok: false, motivo: "simulador" };

  // No Android 13 o pedido de permissao so aparece depois de existir um canal.
  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync("vendas", {
      name: "Vendas",
      importance: Notifications.AndroidImportance.MAX,
      sound: "default",
    });
  }

  let { status } = await Notifications.getPermissionsAsync();
  if (status !== "granted") {
    status = (await Notifications.requestPermissionsAsync()).status;
  }
  if (status !== "granted") return { ok: false, motivo: "negado" };

  const id = projectId();
  if (!id) return { ok: false, motivo: "sem_projeto" };

  try {
    const token = (await Notifications.getExpoPushTokenAsync({ projectId: id })).data;
    await chamar("/api/app/v1/aparelhos", {
      metodo: "POST",
      corpo: { expoToken: token, plataforma: Platform.OS === "ios" ? "ios" : "android" },
    });
    try {
      localStorage.setItem(CHAVE_TOKEN, token);
    } catch {
      // Sem como guardar: ao sair, o servidor tira o aparelho em 30 dias sem abrir.
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, motivo: "falhou", detalhe: e instanceof Error ? e.message : undefined };
  }
}

/** Tira o aparelho da conta (ao sair). Sem sessao: o token e a prova. Falha nao segura o logout. */
export async function tirarAparelho(): Promise<void> {
  if (Platform.OS === "web") return;
  let token: string | null = null;
  try {
    token = localStorage.getItem(CHAVE_TOKEN);
  } catch {
    token = null;
  }
  if (!token) return;
  try {
    await chamar("/api/app/v1/aparelhos", { metodo: "DELETE", corpo: { expoToken: token }, semLogin: true });
  } catch {
    // Sem rede: o token fica guardado e a proxima abertura deslogada tenta de
    // novo (sessao.tsx). No pior caso, o servidor tira em 30 dias sem abrir.
    return;
  }
  try {
    localStorage.removeItem(CHAVE_TOKEN);
  } catch {
    // nada a fazer
  }
}

/** Texto da tela de Ajustes para cada situacao. */
export function fraseDoPush(s: SituacaoPush): string {
  if (s.ok) return "Este celular recebe o aviso de cada venda.";
  switch (s.motivo) {
    case "web":
      return "O aviso de venda chega no app instalado no celular.";
    case "simulador":
      return "O aviso de venda só chega num celular de verdade.";
    case "negado":
      return "As notificações estão bloqueadas. Libere o Panda Track nos ajustes do celular.";
    case "sem_projeto":
      return "Esta versão do app ainda não recebe aviso de venda.";
    default:
      return s.detalhe ? `Não deu para ativar o aviso: ${s.detalhe}` : "Não deu para ativar o aviso de venda agora.";
  }
}
