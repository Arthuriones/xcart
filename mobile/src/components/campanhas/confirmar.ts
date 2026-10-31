import { Alert, Platform } from "react-native";

// ============================================================================
// Confirmacao e aviso que funcionam nos dois lados: no celular o Alert nativo;
// na web (a conferencia no navegador) o Alert do react-native-web nao faz
// nada, entao vai window.confirm / window.alert.
// ============================================================================

export function confirmar(titulo: string, mensagem: string, botao: string): Promise<boolean> {
  if (Platform.OS === "web") {
    return Promise.resolve(window.confirm(mensagem ? `${titulo}\n\n${mensagem}` : titulo));
  }
  return new Promise((resolve) => {
    Alert.alert(
      titulo,
      mensagem,
      [
        { text: "Cancelar", style: "cancel", onPress: () => resolve(false) },
        { text: botao, onPress: () => resolve(true) },
      ],
      // Tocar fora (Android) e cancelar, nunca confirmar.
      { cancelable: true, onDismiss: () => resolve(false) }
    );
  });
}

export function avisar(titulo: string, mensagem: string): void {
  if (Platform.OS === "web") {
    window.alert(`${titulo}\n\n${mensagem}`);
    return;
  }
  Alert.alert(titulo, mensagem);
}
