// Dublês para os testes do LLM (T19). Nenhum teste chama a Groq: o `fetch` é sempre um
// destes dublês, e o fetch real é substituído por um que falha o teste se for usado.

export const forbiddenFetch: typeof fetch = () => {
  throw new Error("fetch real proibido nos testes: use um dublê");
};

export interface FakeCall {
  url: string;
  headers: Headers;
  body: string;
}

export type FakeReply =
  | { status: number; body?: string; headers?: Record<string, string> }
  | { hang: true } // nunca responde; só termina quando o AbortController dispara
  | { throws: true };

export class FakeProvider {
  calls: FakeCall[] = [];
  private queue: FakeReply[];

  constructor(replies: FakeReply[]) {
    this.queue = [...replies];
  }

  fetch: typeof fetch = (input, init) => {
    const reply = this.queue.shift();
    this.calls.push({
      url: String(input instanceof Request ? input.url : input),
      headers: new Headers(init?.headers),
      body: String(init?.body ?? ""),
    });
    if (!reply) return Promise.reject(new Error("resposta de teste ausente"));
    if ("throws" in reply) return Promise.reject(new TypeError("rede caiu"));
    if ("hang" in reply) {
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          reject(new DOMException("abortado", "AbortError"));
        });
      });
    }
    return Promise.resolve(
      new Response(reply.body ?? "", {
        status: reply.status,
        headers: reply.headers,
      }),
    );
  };
}

// Envelope no formato da API (choices[0].message.content).
export function groqReply(content: string): FakeReply {
  return {
    status: 200,
    body: JSON.stringify({ choices: [{ message: { content } }] }),
  };
}

// Contador em memória com a mesma regra da RPC: consome antes, recusa no limite.
export class FakeQuota {
  used = 0;
  calls: { provider: string; limit: number }[] = [];
  fail = false;

  consume = (provider: string, limit: number): Promise<boolean> => {
    this.calls.push({ provider, limit });
    if (this.fail) return Promise.reject(new Error("banco fora do ar"));
    if (this.used >= limit) return Promise.resolve(false);
    this.used++;
    return Promise.resolve(true);
  };
}
