import { redirect } from "next/navigation";

/** O Claude (MCP) mudou para Integracoes -> Avancado; a URL antiga continua valendo. */
export default function ClaudePage() {
  redirect("/integracoes/avancado");
}
