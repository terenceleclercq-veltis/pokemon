import type Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it, vi } from "vitest";
import {
  AnalyseError,
  askClaude,
  centeringCap,
  costUsd,
  FINDINGS_SCHEMA,
  findings,
  REQUIRED_STEPS,
  verdict,
  type Centering,
  type Findings,
} from "../../src/worker/analyse";
import { PERFECT } from "../helpers";

const corner = PERFECT.coins.recto.hg;
const edge = PERFECT.bords.recto.h;
const corners = PERFECT.coins.recto;
const edges = PERFECT.bords.recto;
const face = (lr: number, tb: number, sure = true) => ({ gauche: 3, droite: 3, haut: 3, bas: 3, lr, tb, sure });
const CENTERED: Centering = { recto: face(51, 50), verso: face(52, 53) };

describe("pré-évaluation : verdict par règles fixes", () => {
  it("tout est parfait : candidat au 10, rien de limitant ni d'incertain", () => {
    expect(verdict(PERFECT, CENTERED)).toEqual({
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
    const r = verdict(leger, CENTERED);
    expect(r).toMatchObject({ plafond: 9, verdict: "probable_9", limites: ["coin haut droit du verso (léger)"] });
    const blanchi: Findings = {
      ...leger,
      bords: { ...PERFECT.bords, recto: { ...edges, b: { ...edge, blanchiment: "visible" } } },
    };
    expect(verdict(blanchi, CENTERED)).toMatchObject({
      plafond: 8,
      verdict: "huit_ou_moins",
      limites: ["bord bas du recto (blanchiment visible)"],
    });
  });
  it("centrage mesuré : tolérances PSA du recto (55/45) et du verso (75/25)", () => {
    expect([55, 55.1, 60, 65, 70].map((v) => centeringCap("recto", v))).toEqual([10, 9, 9, 8, 7]);
    expect([75, 80, 90, 95].map((v) => centeringCap("verso", v))).toEqual([10, 9, 9, 8]);
    const r = verdict(PERFECT, { ...CENTERED, recto: face(58.3, 50) });
    expect(r).toMatchObject({ plafond: 9, limites: ["centrage du recto (58,3/41,7)"] });
  });
  it("centrage non mesurable : impression de Claude, comptée comme incertaine", () => {
    const r = verdict(
      { ...PERFECT, centrage_visuel: { recto: "limite", verso: "bon" } },
      { recto: null, verso: face(50, 50) },
    );
    expect(r.plafond).toBe(9);
    expect(r.incertains).toEqual(["centrage du recto (à l'œil : limite)"]);
    expect(verdict(PERFECT, { ...CENTERED, verso: face(60, 50, false) }).incertains).toEqual([
      "centrage du verso (60/40)",
    ]);
  });
  it("photos inexploitables, ou plus de 4 constats incertains : photos insuffisantes", () => {
    expect(verdict({ ...PERFECT, qualite_photos: { exploitable: false, problemes: ["flou"] } }, CENTERED).verdict).toBe(
      "photos_insuffisantes",
    );
    const flou = { ...corner, confiance: "faible" } as const;
    const vague: Findings = {
      ...PERFECT,
      coins: { recto: { hg: flou, hd: flou, bd: flou, bg: corner }, verso: { ...corners, hg: flou, hd: flou } },
    };
    expect(verdict(vague, CENTERED)).toMatchObject({ verdict: "photos_insuffisantes", plafond: 10 });
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
const photos = REQUIRED_STEPS.map((step, i) => ({ id: `p${String(i)}`, step, mime: "image/jpeg" }));
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
    const f = fakeClient(() => Promise.resolve(message(JSON.stringify(PERFECT))));
    const steps: string[] = [];
    const out = await askClaude(f.client, "claude-opus-5-5", photos, read, (s) => steps.push(s));
    expect(out).toEqual({ findings: PERFECT, input_tokens: 30_000, output_tokens: 4_000 });
    expect(steps).toEqual(["envoi", "analyse"]);
    expect(f.upload).toHaveBeenCalledTimes(10);
    expect(f.upload.mock.calls[0]![0]).toMatchObject({ expires_in_seconds: 3600 });
    expect(f.upload.mock.calls[0]![0].file.name).toBe("recto.jpg");
    const params = f.create.mock.calls[0] as unknown as [
      { model: string; output_config: unknown; messages: { content: { type: string; text?: string }[] }[] },
    ];
    expect(params[0].model).toBe("claude-opus-5-5");
    expect(params[0].output_config).toEqual({
      effort: "high",
      format: { type: "json_schema", schema: FINDINGS_SCHEMA },
    });
    const content = params[0].messages[0]!.content;
    expect(content[0]).toEqual({
      type: "text",
      text: "Photo 1 : recto entier, redressé (63 × 88 mm, 20 pixels par mm)",
    });
    expect(content[1]).toMatchObject({ type: "image", source: { type: "file" } });
    expect(content[4]).toEqual({ type: "text", text: "Photo 3 : recto, gros plan du coin haut gauche" });
    expect(f.remove).toHaveBeenCalledTimes(10);
  });
  it("refus, réponse tronquée ou hors format : erreur explicite, fichiers supprimés quand même", async () => {
    for (const [reply, error] of [
      [message("{}", "refusal"), "Claude a refusé l'analyse"],
      [message("{", "max_tokens"), "réponse de Claude tronquée"],
      [message("pas du json"), "réponse de Claude illisible"],
      [message(JSON.stringify({ ...PERFECT, resume: 3 })), "réponse de Claude hors format"],
    ] as const) {
      const f = fakeClient(() => Promise.resolve(reply));
      await expect(askClaude(f.client, "m", photos, read, () => undefined)).rejects.toThrow(error);
      expect(f.remove).toHaveBeenCalledTimes(10);
    }
  });
  it("photo absente de R2 : aucune demande au modèle, les fichiers déjà envoyés sont supprimés", async () => {
    const f = fakeClient(() => Promise.resolve(message(JSON.stringify(PERFECT))));
    const partial = (id: string) => (id === "p3" ? Promise.resolve(null) : read());
    const err = await askClaude(f.client, "m", photos, partial, () => undefined).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AnalyseError);
    expect((err as Error).message).toBe("photo introuvable (recto-hd)");
    expect(f.create).not.toHaveBeenCalled();
    expect(f.remove).toHaveBeenCalledTimes(9);
  });
});
