import { ClaudeMcp } from "./claude-mcp";

// ============================================================================
// Integracoes -> Avancado: o Claude (MCP). Tela tecnica, por isso fora do menu
// principal; /claude redireciona para ca.
// ============================================================================

export default function AvancadoPage() {
  return (
    <>
      <div className="flex flex-col gap-1">
        <h2 className="text-overlay text-ink">Avançado · Claude</h2>
        <p className="max-w-[62ch] text-dense text-t1 text-pretty">
          Opere as lojas pelo Claude Code ou pelo Claude Desktop. Gere um token e copie o comando.
        </p>
      </div>
      <ClaudeMcp />
    </>
  );
}
