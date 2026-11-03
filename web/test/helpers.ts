import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { vi } from "vitest";
import type { Findings, Reply } from "../src/worker/analyse";
import worker from "../src/worker/index";

export const TEAM = "equipe-test";
export const AUD = "aud-test";
export const EMAIL = "terence@example.com";
export const ORIGIN = "https://pokedex.example.com";

const b64url = (b: ArrayBuffer | Uint8Array | string) =>
  btoa(
    typeof b === "string" ? b : String.fromCharCode(...new Uint8Array(b instanceof Uint8Array ? b : new Uint8Array(b))),
  )
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

let keys: CryptoKeyPair | undefined;
export async function keyPair(): Promise<CryptoKeyPair> {
  keys ??= (await crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true,
    ["sign", "verify"],
  )) as CryptoKeyPair;
  return keys;
}
export async function jwks() {
  const pub = (await crypto.subtle.exportKey("jwk", (await keyPair()).publicKey)) as JsonWebKey;
  return { keys: [{ ...pub, kid: "k1", alg: "RS256", use: "sig" }] };
}
export async function signJwt(claims: Record<string, unknown> = {}, header: Record<string, unknown> = {}) {
  const now = Math.floor(Date.now() / 1000);
  const h = b64url(JSON.stringify({ alg: "RS256", kid: "k1", typ: "JWT", ...header }));
  const p = b64url(
    JSON.stringify({
      aud: [AUD],
      iss: `https://${TEAM}.cloudflareaccess.com`,
      email: EMAIL,
      exp: now + 600,
      iat: now,
      ...claims,
    }),
  );
  const sig = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    (await keyPair()).privateKey,
    new TextEncoder().encode(`${h}.${p}`),
  );
  return `${h}.${p}.${b64url(sig)}`;
}

/**
 * Remplace fetch sortant : JWKS Access + TCGdex simulés, et l'API Claude si `anthropic` est fourni ; tout autre hôte =
 * erreur (pas de réseau en test).
 */
export function mockOutbound(
  prices: Record<string, number | null> = {},
  anthropic?: (req: Request) => Promise<Response>,
) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.href === `https://${TEAM}.cloudflareaccess.com/cdn-cgi/access/certs`) return Response.json(await jwks());
    if (url.hostname === "api.anthropic.com" && anthropic)
      return anthropic(input instanceof Request ? input : new Request(url, init));
    if (url.hostname === "api.tcgdex.net") {
      const id = decodeURIComponent(url.pathname.split("/").pop() ?? "");
      if (!(id in prices)) return new Response("not found", { status: 404 });
      return Response.json({
        image: `https://assets.tcgdex.net/fr/x/${id}`,
        pricing: { cardmarket: { trend: prices[id], low: prices[id] ? prices[id] / 2 : null, avg7: prices[id] } },
      });
    }
    throw new Error(`réseau interdit en test : ${url.href}`);
  });
}

export async function call(
  path: string,
  init: RequestInit & { json?: unknown; auth?: boolean; csrf?: boolean; vars?: Partial<Env> } = {},
): Promise<Response> {
  const { json, auth = true, csrf = true, vars, ...rest } = init;
  const headers = new Headers(rest.headers);
  if (auth) headers.set("Cf-Access-Jwt-Assertion", await signJwt());
  if (csrf) headers.set("X-Requested-With", "pokedex");
  if (json !== undefined) headers.set("Content-Type", "application/json");
  const req = new Request(ORIGIN + path, {
    ...rest,
    headers,
    body: json !== undefined ? JSON.stringify(json) : rest.body,
  });
  const ctx = createExecutionContext();
  const res = await worker.fetch(req, vars ? { ...env, ...vars } : env, ctx);
  await waitOnExecutionContext(ctx);
  return res;
}

// --- API Claude simulée ----------------------------------------------------------------------------------------------

const corner = { etat: "parfait", confiance: "elevee", detail: "" } as const;
const edge = { blanchiment: "aucun", confiance: "elevee", detail: "" } as const;
const corners = { hg: corner, hd: corner, bd: corner, bg: corner };
const edges = { h: edge, d: edge, b: edge, g: edge };
const surface = { gravite: "aucune" as const, defauts: [] as string[], confiance: "elevee" as const };
/** Constats d'une carte sans défaut visible. */
export const PERFECT: Findings = {
  qualite_photos: { exploitable: true, problemes: [] },
  coins: { recto: corners, verso: corners },
  bords: { recto: edges, verso: edges },
  surface: { recto: surface, verso: surface },
  centrage_visuel: { recto: "bon", verso: "bon" },
  resume: "Carte en très bon état.",
};

/** Les mêmes constats au format de réponse de Claude (listes d'entrées). */
export function toReply(f: Findings): Reply {
  const faces = ["recto", "verso"] as const;
  return {
    qualite_photos: f.qualite_photos,
    coins: faces.flatMap((face) =>
      (["hg", "hd", "bd", "bg"] as const).map((coin) => ({ face, coin, ...f.coins[face][coin] })),
    ),
    bords: faces.flatMap((face) =>
      (["h", "d", "b", "g"] as const).map((bord) => ({ face, bord, ...f.bords[face][bord] })),
    ),
    surface: faces.map((face) => ({ face, ...f.surface[face] })),
    centrage_visuel: f.centrage_visuel,
    resume: f.resume,
  };
}

interface AnthropicCall {
  method: string;
  path: string;
  headers: Headers;
  body: unknown;
}

/**
 * Faux api.anthropic.com : échange de jeton fédéré, API Files (envoi, suppression), Messages. `exchange` / `messages` :
 * statut HTTP à renvoyer à la place d'une réponse normale.
 */
export function anthropicApi(opts: { reply?: unknown; exchange?: number; messages?: number; grammar?: boolean } = {}) {
  const calls: AnthropicCall[] = [];
  let n = 0;
  const error = (status: number, type: string) =>
    Response.json({ type: "error", error: { type, message: "refusé" } }, { status });
  const handler = async (req: Request): Promise<Response> => {
    const url = new URL(req.url);
    const call: AnthropicCall = { method: req.method, path: url.pathname, headers: req.headers, body: null };
    calls.push(call);
    if (url.pathname === "/v1/oauth/token") {
      call.body = await req.json();
      if (opts.exchange) return error(opts.exchange, "authentication_error");
      return Response.json({ access_token: "sk-ant-oat01-test", token_type: "Bearer", expires_in: 600 });
    }
    if (url.pathname === "/v1/files" && req.method === "POST") {
      const form = await req.formData();
      const file = form.get("file") as File;
      call.body = { name: file.name, type: file.type, size: file.size, expires: form.get("expires_in_seconds") };
      return Response.json({
        id: `file_${String(++n)}`,
        type: "file",
        filename: file.name,
        mime_type: file.type,
        size_bytes: file.size,
        created_at: new Date().toISOString(),
        downloadable: false,
      });
    }
    if (url.pathname.startsWith("/v1/files/") && req.method === "DELETE")
      return Response.json({ id: url.pathname.split("/").pop(), type: "file_deleted" });
    if (url.pathname === "/v1/messages") {
      call.body = await req.json();
      if (opts.messages) return error(opts.messages, "invalid_request_error");
      // format imposé refusé comme le 03/11/2026 en production ; la demande sans format imposé passe
      if (opts.grammar && (call.body as { output_config?: { format?: unknown } }).output_config?.format)
        return Response.json(
          {
            type: "error",
            error: {
              type: "invalid_request_error",
              message: "The compiled grammar is too large, which would cause performance issues.",
            },
          },
          { status: 400 },
        );
      return Response.json({
        id: "msg_test",
        type: "message",
        role: "assistant",
        model: "claude-opus-5-5",
        content: [{ type: "text", text: JSON.stringify(opts.reply ?? toReply(PERFECT)) }],
        stop_reason: "end_turn",
        stop_sequence: null,
        usage: { input_tokens: 30_000, output_tokens: 4_000 },
      });
    }
    return new Response("introuvable", { status: 404 });
  };
  return { calls, handler };
}
