import "expo-sqlite/localStorage/install";
import { AppState, Platform } from "react-native";
import { createClient } from "@supabase/supabase-js";

// ============================================================================
// O login do app e o mesmo do site (Supabase Auth, e-mail e senha). A sessao
// fica no localStorage do expo-sqlite (no navegador, o localStorage dele) e o
// access token vai no Authorization das rotas /api/app/v1 (src/lib/api.ts).
// Chave PUBLICA do Supabase (a mesma NEXT_PUBLIC_ do site), do .env.local.
// ============================================================================

const url = process.env.EXPO_PUBLIC_SUPABASE_URL ?? "";
const chave = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? "";

export const supabaseConfigurado = Boolean(url && chave);

export const supabase = createClient(url || "https://sem-config.supabase.co", chave || "sem-config", {
  auth: {
    storage: localStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});

// Renova o token so com o app aberto (o padrao do Supabase para React Native).
if (Platform.OS !== "web") {
  AppState.addEventListener("change", (estado) => {
    if (estado === "active") supabase.auth.startAutoRefresh();
    else supabase.auth.stopAutoRefresh();
  });
}
