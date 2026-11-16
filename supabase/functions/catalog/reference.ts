// Link de referência para consulta manual (README 7.8). Montado no servidor a partir do
// cadastro: classe e símbolo do ativo + `base_url` da fonte em `data_sources`. O link
// geral NÃO é evidência de observação (cada observação tem a sua `source_url`).
// Só https, sem credenciais, porta, parâmetros nem fragmento; nada vem do navegador.

// Caminho de cada classe no site de referência (só ações na primeira fatia).
const PATH_BY_CLASS: Record<string, string> = { stock: "acoes" };
const SYMBOL = /^[A-Z0-9]{1,12}$/;

export function buildReferenceUrl(
  baseUrl: string | null | undefined,
  assetClass: string,
  symbol: string,
): string | null {
  const path = PATH_BY_CLASS[assetClass];
  if (!baseUrl || !path || !SYMBOL.test(symbol)) return null;
  let base: URL;
  try {
    base = new URL(baseUrl);
  } catch {
    return null;
  }
  if (
    base.protocol !== "https:" || base.username !== "" ||
    base.password !== "" || base.port !== "" || base.search !== "" ||
    base.hash !== "" || !base.hostname.includes(".")
  ) {
    return null;
  }
  return `https://${base.hostname}/${path}/${symbol.toLowerCase()}`;
}
