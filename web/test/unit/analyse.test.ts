import Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it, vi } from "vitest";
import {
  AnalyseError,
  askClaude,
  centeringCap,
  arrange,
  costUsd,
  explain,
  FINDINGS_SCHEMA,
  findings,
  orderPhotos,
  verdict,
  type Findings,
} from "../../src/worker/analyse";
import { PERFECT, toReply } from "../helpers";

const corner = PERFECT.coins.recto.hg;
const edge = PERFECT.bords.recto.h;
const corners = PERFECT.coins.recto;
const edges = PERFECT.bords.recto;
type Conf = "faible" | "moyenne" | "elevee";
/** Bordures du recto mesurées par Claude (pixels), le verso restant celui de PERFECT. */
const recto = (gauche: number, droite: number, haut = 120, bas = 120, confiance: Conf = "elevee", photo = 1) =>
  ({
    ...PERFECT,
    centrage: { ...PERFECT.centrage, recto: { photo, gauche, droite, haut, bas, confiance, detail: "" } },
  }) satisfies Findings;

describe("pré-évaluation : verdict par règles fixes", () => {
  it("tout est parfait : candidat au 10, rien de limitant ni d'incertain", () => {
    expect(verdict(PERFECT)).toEqual({
      plafond: 10,
      verdict: "candidat_10",
      limites: [],
      incertains: [],
    });
  });
  it("le plus faible critère plafonne la note : coin léger -> 9, bord blanchi -> 8", () => {
    const leger: Findings = {
      ...PERFECT,
      coins: { ...PERFECT.coins, verso: { ...corners, hd: { ...corner, etat: "leger" } } },
    };
    const r = verdict(leger);
    expect(r).toMatchObject({ plafond: 9, verdict: "probable_9", limites: ["coin haut droit du verso (léger)"] });
    const blanchi: Findings = {
      ...leger,
      bords: { ...PERFECT.bords, recto: { ...edges, b: { ...edge, blanchiment: "visible" } } },
    };
    expect(verdict(blanchi)).toMatchObject({
      plafond: 8,
      verdict: "huit_ou_moins",
      limites: ["bord bas du recto (blanchiment visible)"],
    });
  });
  it("centrage mesuré par Claude (bordures en pixels) : tolérances PSA du recto (55/45) et du verso (75/25)", () => {
    expect([55, 55.1, 60, 65, 70].map((v) => centeringCap("recto", v))).toEqual([10, 9, 9, 8, 7]);
    expect([75, 80, 90, 95].map((v) => centeringCap("verso", v))).toEqual([10, 9, 9, 8]);
    expect(verdict(recto(140, 100))).toMatchObject({ plafond: 9, limites: ["centrage du recto (58,3/41,7)"] });
    // le côté le plus décentré compte (ici haut-bas)
    expect(verdict(recto(120, 120, 150, 90))).toMatchObject({ plafond: 8, limites: ["centrage du recto (62,5/37,5)"] });
  });
  it("centrage non mesurable : pas de plafond, mais à confirmer ; photo de biais : mesure incertaine", () => {
    expect(verdict(recto(0, 0, 0, 0, "faible", 0))).toMatchObject({
      plafond: 10,
      verdict: "candidat_10",
      incertains: ["centrage du recto (non mesurable sur les photos)"],
    });
    expect(verdict(recto(150, 100, 120, 120, "faible"))).toMatchObject({
      plafond: 9,
      incertains: ["centrage du recto (60/40)"],
    });
  });
  it("photos inexploitables, ou plus de 4 constats incertains : photos insuffisantes", () => {
    expect(verdict({ ...PERFECT, qualite_photos: { exploitable: false, problemes: ["flou"] } }).verdict).toBe(
      "photos_insuffisantes",
    );
    const flou = { ...corner, confiance: "faible" } as const;
    const vague: Findings = {
      ...PERFECT,
      coins: { recto: { hg: flou, hd: flou, bd: flou, bg: corner }, verso: { ...corners, hg: flou, hd: flou } },
    };
    expect(verdict(vague)).toMatchObject({ verdict: "photos_insuffisantes", plafond: 10 });
  });
  it("coût d'Opus 5.5 (4 $ et 20 $ par million de jetons) ; modèle inconnu : coût non chiffré", () => {
    expect(costUsd("claude-opus-5-5", 30_000, 4_000)).toBe(0.2);
    expect(costUsd("claude-sonnet-5-5", 30_000, 4_000)).toBe(0.1);
    expect(costUsd("autre", 1, 1)).toBeNull();
  });
  it("le format imposé à Claude et la validation serveur décrivent la même réponse", () => {
    expect(findings.safeParse(PERFECT).success).toBe(true);
    const keys = (o: { required?: string[] }) => o.required;
    expect(keys(FINDINGS_SCHEMA)).toEqual(Object.keys(PERFECT));
    expect(findings.safeParse({ ...PERFECT, coins: { recto: corners } }).success).toBe(false);
  });
  it("ordre d'envoi : étapes de l'ancien scanner, puis photos libres par numéro ; 20 au plus", () => {
    const steps = ["photo-10", "photo-2", "verso", "recto-hg", "recto", "photo-1"].map((step) => ({ step }));
    expect(orderPhotos(steps).map((p) => p.step)).toEqual([
      "recto",
      "verso",
      "recto-hg",
      "photo-1",
      "photo-2",
      "photo-10",
    ]);
    expect(orderPhotos(Array.from({ length: 25 }, (_, i) => ({ step: `photo-${String(i + 1)}` })))).toHaveLength(20);
  });
});

/** Faux client Anthropic : envois et suppressions de fichiers, réponse du modèle au choix. */
function fakeClient(reply: () => Promise<unknown>) {
  let n = 0;
  const upload = vi.fn(async (p: { file: File; expires_in_seconds?: number }) => {
    await Promise.resolve();
    return { id: `file_${String(++n)}`, filename: p.file.name };
  });
  const remove = vi.fn(async () => {
    await Promise.resolve();
  });
  const create = vi.fn(reply);
  return {
    client: { files: { upload, delete: remove }, messages: { create } } as unknown as Anthropic,
    upload,
    remove,
    create,
  };
}
/** Six photos libres (envoyées trois par trois). */
const photos = Array.from({ length: 6 }, (_, i) => ({
  id: `p${String(i)}`,
  step: `photo-${String(i + 1)}`,
  mime: "image/jpeg",
}));
const read = () => Promise.resolve(new Uint8Array([0xff, 0xd8, 0xff, 0]).buffer);
const message = (text: string, stop = "end_turn") => ({
  content: [
    { type: "thinking", thinking: "…" },
    { type: "text", text },
  ],
  stop_reason: stop,
  usage: { input_tokens: 30_000, output_tokens: 4_000 },
});

describe("pré-évaluation : appel à Claude", () => {
  it("photos envoyées par l'API Files, légendées dans l'ordre, puis supprimées", async () => {
    const f = fakeClient(() => Promise.resolve(message(JSON.stringify(toReply(PERFECT)))));
    const steps: string[] = [];
    const out = await askClaude(f.client, "claude-opus-5-5", photos, read, (s) => steps.push(s));
    expect(out).toEqual({ findings: PERFECT, input_tokens: 30_000, output_tokens: 4_000 });
    expect(steps).toEqual(["envoi", "analyse"]);
    expect(f.upload).toHaveBeenCalledTimes(6);
    expect(f.upload.mock.calls[0]![0]).toMatchObject({ expires_in_seconds: 3600 });
    expect(f.upload.mock.calls[0]![0].file.name).toBe("photo-1.jpg");
    const params = f.create.mock.calls[0] as unknown as [
      { model: string; output_config: unknown; messages: { content: { type: string; text?: string }[] }[] },
    ];
    expect(params[0].model).toBe("claude-opus-5-5");
    expect(params[0].output_config).toEqual({
      effort: "high",
      format: { type: "json_schema", schema: FINDINGS_SCHEMA },
    });
    // photos libres : un simple numéro, Claude dit lui-même ce qu'elles montrent
    const content = params[0].messages[0]!.content;
    expect(content[0]).toEqual({ type: "text", text: "Photo 1" });
    expect(content[1]).toMatchObject({ type: "image", source: { type: "file" } });
    expect(content[4]).toEqual({ type: "text", text: "Photo 3" });
    expect(f.remove).toHaveBeenCalledTimes(6);
  });
  it("ancien scan (étapes du scanner) : légende de chaque photo gardée", async () => {
    const f = fakeClient(() => Promise.resolve(message(JSON.stringify(toReply(PERFECT)))));
    const legacy = ["recto", "verso", "recto-hg"].map((step, i) => ({ id: `l${String(i)}`, step, mime: "image/jpeg" }));
    await askClaude(f.client, "m", legacy, read, () => undefined);
    const params = f.create.mock.calls[0] as unknown as [{ messages: { content: { text?: string }[] }[] }];
    const texts = params[0].messages[0]!.content.flatMap((b) => (b.text ? [b.text] : []));
    expect(texts.slice(0, 3)).toEqual([
      "Photo 1 : recto entier, redressé (63 × 88 mm, 20 pixels par mm)",
      "Photo 2 : verso entier, redressé (63 × 88 mm, 20 pixels par mm)",
      "Photo 3 : recto, gros plan du coin haut gauche",
    ]);
  });
  it("refus, réponse tronquée ou hors format : erreur explicite, fichiers supprimés quand même", async () => {
    for (const [reply, error] of [
      [message("{}", "refusal"), "Claude a refusé l'analyse"],
      [message("{", "max_tokens"), "réponse de Claude tronquée"],
      [message("pas du json"), "réponse de Claude illisible"],
      [message(JSON.stringify({ ...toReply(PERFECT), resume: 3 })), "réponse de Claude hors format"],
    ] as const) {
      const f = fakeClient(() => Promise.resolve(reply));
      await expect(askClaude(f.client, "m", photos, read, () => undefined)).rejects.toThrow(error);
      expect(f.remove).toHaveBeenCalledTimes(6);
    }
  });
  it("erreur d'Anthropic : statut, type et message enregistrés, avec l'étape (envoi des photos ou analyse)", async () => {
    const credit = Anthropic.APIError.generate(
      400,
      { type: "error", error: { type: "invalid_request_error", message: "Your credit balance is too low" } },
      undefined,
      new Headers(),
    );
    expect(explain(credit)).toBe("Claude a répondu 400 (invalid_request_error) : Your credit balance is too low");
    expect(explain(new Error("réseau coupé"))).toBe("réseau coupé");
    expect(explain("?")).toBe("échec de l'appel à Claude");
    const upload = fakeClient(() => Promise.resolve(message(JSON.stringify(toReply(PERFECT)))));
    upload.upload.mockRejectedValueOnce(credit);
    await expect(askClaude(upload.client, "m", photos, read, () => undefined)).rejects.toThrow(
      "envoi des photos refusé (photo-1) — Claude a répondu 400 (invalid_request_error) : Your credit balance is too low",
    );
    // premier lot de trois : un refus arrête les envois ; les deux photos envoyées sont supprimées
    expect(upload.create).not.toHaveBeenCalled();
    expect(upload.upload).toHaveBeenCalledTimes(3);
    expect(upload.remove).toHaveBeenCalledTimes(2);
    const refused = fakeClient(() => Promise.reject(credit));
    await expect(askClaude(refused.client, "m", photos, read, () => undefined)).rejects.toThrow(
      "analyse refusée — Claude a répondu 400 (invalid_request_error) : Your credit balance is too low",
    );
    expect(refused.remove).toHaveBeenCalledTimes(6);
  });
  it("réponse en listes, rangée par face, coin et bord ; entrée manquante refusée", () => {
    expect(arrange(toReply(PERFECT))).toEqual(PERFECT);
    const partial = toReply(PERFECT);
    partial.coins = partial.coins.filter((c) => !(c.face === "verso" && c.coin === "hd"));
    expect(() => arrange(partial)).toThrow("réponse de Claude incomplète : coin hd du verso manquant");
  });
  it("format imposé refusé (grammaire trop lourde) : même demande sans format imposé, JSON revalidé", async () => {
    const grammar = Anthropic.APIError.generate(
      400,
      { type: "error", error: { type: "invalid_request_error", message: "The compiled grammar is too large" } },
      undefined,
      new Headers(),
    );
    let calls = 0;
    const f = fakeClient(() =>
      ++calls === 1
        ? Promise.reject(grammar)
        : Promise.resolve(message("```json\n" + JSON.stringify(toReply(PERFECT)) + "\n```")),
    );
    const out = await askClaude(f.client, "claude-opus-5-5", photos, read, () => undefined);
    expect(out.findings).toEqual(PERFECT);
    const [first, second] = f.create.mock.calls as unknown as [
      [{ output_config: { format?: unknown }; system: string }],
      [{ output_config: { format?: unknown }; system: string }],
    ];
    expect(first[0].output_config.format).toBeDefined();
    expect(second[0].output_config).toEqual({ effort: "high" });
    expect(second[0].system).toContain("Réponds uniquement par un objet JSON");
    expect(f.remove).toHaveBeenCalledTimes(6);
  });
  it("photo absente de R2 : aucune demande au modèle, les fichiers déjà envoyés sont supprimés", async () => {
    const f = fakeClient(() => Promise.resolve(message(JSON.stringify(toReply(PERFECT)))));
    const partial = (id: string) => (id === "p3" ? Promise.resolve(null) : read());
    const err = await askClaude(f.client, "m", photos, partial, () => undefined).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AnalyseError);
    expect((err as Error).message).toBe("photo introuvable (photo-4)");
    expect(f.create).not.toHaveBeenCalled();
    // second lot (photos 4 à 6) : les deux autres photos du lot sont parties, puis supprimées avec les trois premières
    expect(f.remove).toHaveBeenCalledTimes(5);
  });
});
