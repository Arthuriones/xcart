import { useEffect } from "react";
import { Tabs } from "expo-router";
import Feather from "@expo/vector-icons/Feather";
import { registrarAparelho } from "@/lib/push";
import { FONTE, useCores } from "@/lib/tema";

// ============================================================================
// As tres abas: Dashboard (lucro), Campanhas (com a edicao) e Ajustes
// (notificacoes e conta). Ao entrar, o celular se registra para o aviso de
// venda -- a cada abertura, que e o que renova o prazo de 30 dias no servidor.
// ============================================================================

export default function Abas() {
  const c = useCores();

  useEffect(() => {
    void registrarAparelho();
  }, []);

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: c.brand,
        tabBarInactiveTintColor: c.t3,
        tabBarStyle: { backgroundColor: c.surface, borderTopColor: c.border },
        tabBarLabelStyle: { fontFamily: FONTE.media, fontSize: 11 },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{ title: "Dashboard", tabBarIcon: ({ color, size }) => <Feather name="bar-chart-2" size={size} color={String(color)} /> }}
      />
      <Tabs.Screen
        name="campanhas"
        options={{ title: "Campanhas", tabBarIcon: ({ color, size }) => <Feather name="target" size={size} color={String(color)} /> }}
      />
      <Tabs.Screen
        name="ajustes"
        options={{ title: "Ajustes", tabBarIcon: ({ color, size }) => <Feather name="settings" size={size} color={String(color)} /> }}
      />
    </Tabs>
  );
}
