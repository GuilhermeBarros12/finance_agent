// POST /agent, modo determinístico (T18). Ordem do README 9.1:
// authenticate -> authorize -> validate -> reserve -> load_owned_conversation ->
// resolve_assets -> load_published_snapshot -> assemble_evidence -> persist_response.
// Não há LLM aqui: nenhuma chamada de rede além do banco. O `user_id` vem só do JWT.
import { AppError, errorBody, errors } from "./errors.ts";
import { corsHeaders } from "./cors.ts";
import { bearer } from "../_shared/auth.ts";
import {
  type AgentRequest,
  canonicalBody,
  deriveUuid,
  MAX_BODY_BYTES,
  parseAgentRequest,
} from "./request.ts";
import { reserveRun } from "./idempotency.ts";
import { assembleEvidence, renderContent } from "./evidence.ts";
import type { AgentDeps } from "./types.ts";
import type { LlmFailureCode } from "../_shared/llm/groq.ts";

const UNIVERSE = "stocks";

// Textos fixos (pt-BR) para cada motivo de needs_selection. O texto do LLM nunca é usado.
const NEEDS_SELECTION_CONTENT =
  "Não foi possível interpretar a pergunta automaticamente. Escolha os ativos e os indicadores no seletor manual.";
const LLM_WARNINGS: Record<LlmFailureCode, string> = {
  LLM_INVALID_OUTPUT:
    "A interpretação automática não produziu uma resposta válida. O modo por IA não foi usado.",
  LLM_UNSUPPORTED:
    "A pergunta não se encaixa em uma consulta de indicadores de ações suportada.",
  LLM_QUOTA_EXHAUSTED:
    "O limite diário do modo por IA foi atingido. O modo por IA não foi usado.",
  LLM_QUOTA_UNAVAILABLE:
    "Não foi possível verificar o limite do modo por IA. O modo por IA não foi usado.",
  LLM_PROVIDER_ERROR:
    "O serviço de IA não respondeu corretamente. O modo por IA não foi usado.",
  LLM_TIMEOUT:
    "O serviço de IA demorou demais para responder. O modo por IA não foi usado.",
  LLM_DISABLED: "O modo por IA não está habilitado neste ambiente.",
  LLM_INPUT_TOO_LONG:
    "A mensagem é longa demais para a interpretação automática.",
  LLM_NO_UNIVERSE: "Não há ações cadastradas para interpretar a pergunta.",
};
const JSON_HEADERS = { "Content-Type": "application/json; charset=utf-8" };

function json(
  status: number,
  body: unknown,
  extra: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...JSON_HEADERS, ...extra },
  });
}

async function readBody(req: Request): Promise<unknown> {
  const declared = Number(req.headers.get("content-length") ?? "0");
  if (declared > MAX_BODY_BYTES) throw errors.tooLarge();
  const text = await req.text();
  if (new TextEncoder().encode(text).length > MAX_BODY_BYTES) {
    throw errors.tooLarge();
  }
  try {
    return JSON.parse(text);
  } catch {
    throw errors.invalidRequest("O corpo não é um JSON válido.");
  }
}

export async function handleAgentRequest(
  req: Request,
  deps: AgentDeps,
): Promise<Response> {
  const started = deps.now().getTime();
  const cors = corsHeaders(req, deps.allowedOrigins);
  let requestId: string | undefined;
  let userId: string | undefined;
  let llmCalls: number | undefined;

  const finish = (res: Response, code?: string, error?: string): Response => {
    for (const [k, v] of Object.entries(cors)) res.headers.set(k, v);
    // Log sem token, sem cabeçalhos e sem o texto da mensagem.
    deps.log({
      event: "agent_request",
      status: res.status,
      code,
      request_id: requestId,
      user_id: userId,
      duration_ms: deps.now().getTime() - started,
      error,
      llm_calls: llmCalls,
    });
    return res;
  };

  // Reserva aberta: se algo falhar depois dela, a execução é marcada como falha
  // para que a repetição do mesmo pedido não espere os 3 minutos de expiração.
  let openRunId: string | null = null;

  try {
    if (req.method === "OPTIONS") {
      return finish(new Response(null, { status: 204 }));
    }
    if (req.method !== "POST") throw errors.methodNotAllowed();

    // 1. Autenticar. O user_id sai daqui e de mais lugar nenhum.
    const jwt = bearer(req);
    if (!jwt) throw errors.unauthenticated();
    const user = await deps.authenticate(jwt);
    if (!user) throw errors.unauthenticated();
    userId = user.userId;

    // 1b. Autorizar (allowed_users, via RLS com o JWT do usuário).
    const userStore = deps.userStore(jwt);
    if (!(await userStore.isAllowedUser(userId))) throw errors.accessDenied();

    // 2. Validar o corpo.
    const rawBody = await readBody(req);
    const parsed = parseAgentRequest(rawBody);
    if (!parsed.ok) {
      throw errors.invalidRequest(
        "Corpo da requisição inválido.",
        parsed.issues,
      );
    }
    const body: AgentRequest = parsed.value;
    requestId = body.request_id;

    // 3. Idempotência.
    const bodyHash = await deps.sha256Hex(canonicalBody(body));
    const reservation = await reserveRun(deps.system, {
      user_id: userId,
      request_id: body.request_id,
      conversation_id: body.conversation_id,
      body_hash: bodyHash,
    }, deps.now());

    switch (reservation.kind) {
      case "conflict":
        throw errors.conflict();
      case "conversation_missing":
        throw errors.notFound();
      case "in_progress":
        return finish(
          json(202, {
            request_id: body.request_id,
            conversation_id: body.conversation_id,
            status: "processing",
          }, { "Retry-After": "3" }),
          "IN_PROGRESS",
        );
      case "replay":
        return finish(
          json(200, reservation.response, { "Idempotent-Replay": "true" }),
        );
      case "reserved":
        openRunId = reservation.runId;
    }

    // 4. A conversa precisa ser do usuário (RLS com o JWT dele).
    if (!(await userStore.ownsConversation(userId, body.conversation_id))) {
      throw errors.notFound();
    }

    // 4b. Sem `selection`: o classificador escolhe tickers e métricas a partir da mensagem
    //     (T19). Só depois de autenticar, autorizar, reservar e confirmar a conversa, para
    //     que quem não é dono não gaste cota. Nenhuma transação aberta durante a chamada.
    let selection = body.selection;
    let intentSource: "manual" | "llm" | "mock" = "manual";
    if (!selection) {
      const universe = await deps.market.listStockSymbols();
      const outcome = await deps.llm.classify(body.message!, universe);
      llmCalls = outcome.calls;
      if (!outcome.ok) {
        // D5: falha do LLM não derruba a requisição nem bloqueia a consulta. Nada é
        // gravado em `messages` (não há dado a apresentar); a execução é concluída com
        // esta resposta, e repetir o mesmo request_id a devolve sem nova chamada nem cota.
        const response = {
          request_id: body.request_id,
          conversation_id: body.conversation_id,
          status: "needs_selection",
          mode: "deterministic",
          content: NEEDS_SELECTION_CONTENT,
          reason: { code: outcome.code },
          warnings: [{
            code: outcome.code,
            message: LLM_WARNINGS[outcome.code],
          }],
        };
        await deps.system.complete(openRunId, response);
        openRunId = null;
        return finish(json(200, response), outcome.code);
      }
      selection = outcome.selection;
      intentSource = outcome.source;
    }

    // 5. Resolver ativos contra `assets`; não confiamos na lista do navegador nem do LLM.
    const symbols = selection.asset_ids;
    const found = await deps.market.findAssets(symbols);
    const bySymbol = new Map(found.map((a) => [a.symbol, a]));
    const unsupported = symbols.filter((s) => {
      const a = bySymbol.get(s);
      return !a || a.asset_class !== "stock";
    });
    if (unsupported.length > 0) throw errors.unsupportedAsset(unsupported);
    const assets = symbols.map((s) => bySymbol.get(s)!);

    // 6. Snapshot ativo e publicado. Sem ele, nada de resposta com dado antigo inventado.
    const snapshot = await deps.market.activeSnapshot(UNIVERSE);
    if (!snapshot || !snapshot.published_at) throw errors.dataUnavailable();

    // 7. Pacote de evidências.
    const assetIds = assets.map((a) => a.id);
    const metrics = selection.metrics;
    const [validations, observations] = await Promise.all([
      deps.market.loadValidations(snapshot.id, assetIds, metrics),
      deps.market.loadObservations(snapshot.id, assetIds, metrics),
    ]);
    const assembled = assembleEvidence({
      snapshot,
      assets,
      metrics,
      validations,
      observations,
    });

    // 8. Gravar mensagens (sem transação aberta durante chamadas externas: não há
    //    chamada externa) e concluir a execução com a resposta.
    const userMessageId = await deriveUuid(
      `${userId}:${body.request_id}:user`,
      deps.sha256Hex,
    );
    const assistantMessageId = await deriveUuid(
      `${userId}:${body.request_id}:assistant`,
      deps.sha256Hex,
    );
    const content = renderContent(
      symbols,
      metrics,
      snapshot.collected_at,
    );
    await deps.system.persistTurn({
      conversation_id: body.conversation_id,
      user_id: userId,
      user_message_id: userMessageId,
      assistant_message_id: assistantMessageId,
      user_content: body.message ??
        `Consulta manual: ${symbols.join(", ")} (${metrics.join(", ")})`,
      assistant_content: content,
      payload: assembled.payload,
    });

    const response = {
      request_id: body.request_id,
      conversation_id: body.conversation_id,
      user_message_id: userMessageId,
      message_id: assistantMessageId,
      status: "completed",
      mode: "deterministic",
      intent_source: intentSource,
      snapshot_id: snapshot.id,
      content,
      citations: assembled.citations,
      warnings: assembled.payload.warnings,
      coverage: assembled.coverage,
      payload: assembled.payload,
    };
    await deps.system.complete(openRunId, response);
    openRunId = null;
    return finish(json(200, response));
  } catch (err) {
    const appError = toAppError(err);
    if (openRunId) {
      try {
        await deps.system.fail(openRunId, appError.code);
      } catch {
        // Sem a marca de falha a reserva expira sozinha em 3 minutos.
      }
    }
    return finish(
      json(appError.status, errorBody(appError)),
      appError.code,
      appError.status >= 500 ? describe(err) : undefined,
    );
  }
}

function toAppError(err: unknown): AppError {
  if (err instanceof AppError) return err;
  // Inclui dado publicado que viola o contrato (InconsistentDataError): falha
  // explícita, nunca resposta parcial.
  return errors.internal();
}

// Descrição curta e segura para o log: tipo e mensagem truncada, sem corpo nem token.
function describe(err: unknown): string {
  if (err instanceof Error) return `${err.name}: ${err.message}`.slice(0, 200);
  return "erro desconhecido";
}
