// CORS (README 12.3: APP_ORIGINS, correspondência exata). Nunca `*`: a origem é
// devolvida só quando consta na lista. Sem cookies, então sem Allow-Credentials.

const ALLOWED_HEADERS = "authorization, apikey, content-type, x-client-info";

// Lê APP_ORIGINS. Entradas vazias e `*` são descartadas.
export function parseOrigins(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((o) => o.trim().replace(/\/+$/, ""))
    .filter((o) => o !== "" && o !== "*");
}

export function corsHeaders(
  req: Request,
  allowedOrigins: string[],
  methods = "POST, OPTIONS",
): Record<string, string> {
  const headers: Record<string, string> = { Vary: "Origin" };
  const origin = req.headers.get("origin");
  if (origin && allowedOrigins.includes(origin)) {
    headers["Access-Control-Allow-Origin"] = origin;
    headers["Access-Control-Allow-Headers"] = ALLOWED_HEADERS;
    headers["Access-Control-Allow-Methods"] = methods;
    headers["Access-Control-Max-Age"] = "600";
  }
  return headers;
}
