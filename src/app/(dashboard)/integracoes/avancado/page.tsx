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
          Opere as lojas conversando com o Claude Code ou o Claude Desktop: buscar produtos, reescrever
          descrição e SEO, conferir se a página subiu certo. Gere um token e copie o comando.
        </p>
      </div>
      <ClaudeMcp />
    </>
  );
}
