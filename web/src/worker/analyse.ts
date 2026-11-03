// Pré-évaluation PSA d'un scan par Claude : Claude relève l'état des coins, des bords et de la surface sur les photos
// (format imposé) ; le site mesure lui-même le centrage ; le verdict découle de règles fixes, pas du modèle.
import { APIError } from "@anthropic-ai/sdk";
import type Anthropic from "@anthropic-ai/sdk";
import * as z from "zod/mini";

// --- constats de Claude ---------------------------------------------------------------------------------------------

export const CORNER = ["parfait", "leger", "visible", "important"] as const;
export const EDGE = ["aucun", "leger", "visible", "important"] as const;
export const SURFACE = ["aucune", "legere", "visible", "importante"] as const;
export const CONFIDENCE = ["faible", "moyenne", "elevee"] as const;
export const VISUAL = ["bon", "limite", "decale"] as const;
const FACES = ["recto", "verso"] as const;
const CORNERS = ["hg", "hd", "bd", "bg"] as const;
const EDGES = ["h", "d", "b", "g"] as const;

type Confidence = (typeof CONFIDENCE)[number];
type Face = (typeof FACES)[number];

const confidence = z.enum(CONFIDENCE);
const detail = z.string().check(z.maxLength(400));
const corner = z.object({ etat: z.enum(CORNER), confiance: confidence, detail });
const edge = z.object({ blanchiment: z.enum(EDGE), confiance: confidence, detail });
const surface = z.object({
  gravite: z.enum(SURFACE),
  defauts: z.array(z.string().check(z.maxLength(200))).check(z.maxLength(12)),
  confiance: confidence,
});
const byFace = <T extends z.ZodMiniType>(t: T) => z.object({ recto: t, verso: t });
const corners = z.object({ hg: corner, hd: corner, bd: corner, bg: corner });
const edges = z.object({ h: edge, d: edge, b: edge, g: edge });

/** Réponse de Claude, revalidée côté serveur (le format est imposé, mais on ne fait pas confiance aveuglément). */
export const findings = z.object({
  qualite_photos: z.object({
    exploitable: z.boolean(),
    problemes: z.array(z.string().check(z.maxLength(200))).check(z.maxLength(12)),
  }),
  coins: byFace(corners),
  bords: byFace(edges),
  surface: byFace(surface),
  centrage_visuel: byFace(z.enum(VISUAL)),
  resume: z.string().check(z.maxLength(1500)),
});
export type Findings = z.infer<typeof findings>;

/**
 * Format de réponse imposé à Claude (sorties structurées), en JSON Schema. Volontairement plat : coins, bords et
 * surfaces sont des listes d'entrées identiques. Une propriété par coin et par bord donnait une grammaire trop lourde,
 * refusée par Anthropic (« The compiled grammar is too large », 03/11/2026).
 */
const strict = (properties: Record<string, unknown>) => ({
  type: "object",
  additionalProperties: false,
  required: Object.keys(properties),
  properties,
});
const enumOf = (values: readonly string[]) => ({ type: "string", enum: [...values] });
const strings = { type: "array", items: { type: "string" } };
const list = (item: Record<string, unknown>) => ({ type: "array", items: strict(item) });
export const FINDINGS_SCHEMA = strict({
  qualite_photos: strict({ exploitable: { type: "boolean" }, problemes: strings }),
  coins: list({
    face: enumOf(FACES),
    coin: enumOf(CORNERS),
    etat: enumOf(CORNER),
    confiance: enumOf(CONFIDENCE),
    detail: { type: "string" },
  }),
  bords: list({
    face: enumOf(FACES),
    bord: enumOf(EDGES),
    blanchiment: enumOf(EDGE),
    confiance: enumOf(CONFIDENCE),
    detail: { type: "string" },
  }),
  surface: list({ face: enumOf(FACES), gravite: enumOf(SURFACE), defauts: strings, confiance: enumOf(CONFIDENCE) }),
  centrage_visuel: strict({ recto: enumOf(VISUAL), verso: enumOf(VISUAL) }),
  resume: { type: "string" },
});

/** La réponse de Claude telle qu'elle arrive (listes), revalidée côté serveur avant d'être rangée. */
const face = z.enum(FACES);
export const reply = z.object({
  qualite_photos: findings.shape.qualite_photos,
  coins: z
    .array(z.object({ face, coin: z.enum(CORNERS), etat: z.enum(CORNER), confiance: confidence, detail }))
    .check(z.maxLength(16)),
  bords: z
    .array(z.object({ face, bord: z.enum(EDGES), blanchiment: z.enum(EDGE), confiance: confidence, detail }))
    .check(z.maxLength(16)),
  surface: z
    .array(z.object({ face, gravite: z.enum(SURFACE), defauts: surface.shape.defauts, confiance: confidence }))
    .check(z.maxLength(4)),
  centrage_visuel: findings.shape.centrage_visuel,
  resume: findings.shape.resume,
});
export type Reply = z.infer<typeof reply>;

/** Range les listes de Claude par face, coin et bord ; une entrée manquante rend la réponse inutilisable. */
export function arrange(r: Reply): Findings {
  const pick = <T extends { face: Face }>(items: T[], ok: (x: T) => boolean, what: string): T => {
    const found = items.find(ok);
    if (!found) throw new AnalyseError(`réponse de Claude incomplète : ${what} manquant`);
    return found;
  };
  const byCorner = (f: Face) =>
    Object.fromEntries(
      CORNERS.map((c) => {
        const { etat, confiance, detail } = pick(r.coins, (x) => x.face === f && x.coin === c, `coin ${c} du ${f}`);
        return [c, { etat, confiance, detail }];
      }),
    ) as Findings["coins"]["recto"];
  const byEdge = (f: Face) =>
    Object.fromEntries(
      EDGES.map((b) => {
        const { blanchiment, confiance, detail } = pick(
          r.bords,
          (x) => x.face === f && x.bord === b,
          `bord ${b} du ${f}`,
        );
        return [b, { blanchiment, confiance, detail }];
      }),
    ) as Findings["bords"]["recto"];
  const bySurface = (f: Face) => {
    const { gravite, defauts, confiance } = pick(r.surface, (x) => x.face === f, `surface du ${f}`);
    return { gravite, defauts, confiance };
  };
  return {
    qualite_photos: r.qualite_photos,
    coins: { recto: byCorner("recto"), verso: byCorner("verso") },
    bords: { recto: byEdge("recto"), verso: byEdge("verso") },
    surface: { recto: bySurface("recto"), verso: bySurface("verso") },
    centrage_visuel: r.centrage_visuel,
    resume: r.resume,
  };
}

// --- centrage mesuré par le site -------------------------------------------------------------------------------------

const mm = z.number().check(z.gte(0), z.lte(30));
const pct = z.number().check(z.gte(50), z.lte(100));
export const facesBorders = z.object({
  gauche: mm,
  droite: mm,
  haut: mm,
  bas: mm,
  lr: pct,
  tb: pct,
  sure: z.boolean(),
  /** Coins de l'image où la carte est coupée (absent des mesures faites avant cette vérification). */
  coupe: z.optional(z.array(z.enum(CORNERS)).check(z.maxLength(4))),
});
/** Bordures du recto et du verso (null : non mesurables sur la photo). */
export const centering = z.strictObject({ recto: z.nullable(facesBorders), verso: z.nullable(facesBorders) });
export type Centering = z.infer<typeof centering>;
/** Corps de la demande d'analyse : le centrage mesuré par le site sur le recto et le verso redressés. */
export const analyseBody = z.strictObject({ centrage: centering });

// --- verdict ---------------------------------------------------------------------------------------------------------

export type Grade = 10 | 9 | 8 | 7;
export type Verdict = "candidat_10" | "probable_9" | "huit_ou_moins" | "photos_insuffisantes";

const CORNER_CAP: Record<(typeof CORNER)[number], Grade> = { parfait: 10, leger: 9, visible: 8, important: 7 };
const EDGE_CAP: Record<(typeof EDGE)[number], Grade> = { aucun: 10, leger: 9, visible: 8, important: 7 };
const SURFACE_CAP: Record<(typeof SURFACE)[number], Grade> = { aucune: 10, legere: 9, visible: 8, importante: 7 };
const VISUAL_CAP: Record<(typeof VISUAL)[number], Grade> = { bon: 10, limite: 9, decale: 8 };
const CORNER_NAME = { hg: "haut gauche", hd: "haut droit", bd: "bas droit", bg: "bas gauche" } as const;
/** Libellés des raisons, lus par Terence : accents et virgule décimale. */
const WORD: Record<string, string> = { leger: "léger", legere: "légère", decale: "décalé" };
const word = (v: string) => WORD[v] ?? v;
const dec = (v: number) => String(Math.round(v * 10) / 10).replace(".", ",");
const EDGE_NAME = { h: "haut", d: "droit", b: "bas", g: "gauche" } as const;

/**
 * Tolérances de centrage de PSA (part de la plus large bordure) : 10 = 55/45 au recto et 75/25 au verso ; 9 = 60/40
 * et 90/10 ; 8 = 65/35 au recto. À revérifier sur psacard.com (le site bloque les lecteurs automatiques).
 */
export function centeringCap(face: Face, worst: number): Grade {
  if (face === "recto") return worst <= 55 ? 10 : worst <= 60 ? 9 : worst <= 65 ? 8 : 7;
  return worst <= 75 ? 10 : worst <= 90 ? 9 : 8;
}

export interface Reasons {
  /** Note maximale plausible d'après le plus faible des critères. */
  plafond: Grade;
  verdict: Verdict;
  /** Ce qui limite la note (vide pour un candidat au 10). */
  limites: string[];
  /** Constats de faible confiance (zone floue, reflet…). */
  incertains: string[];
}

/**
 * Centrage d'une face : la mesure du site décide si elle est fiable et compatible avec l'examen visuel de Claude.
 * Sinon (image rognée, bordures irrégulières, ou mesure nettement pire que l'impression visuelle, signe d'un bord
 * mal repéré), c'est l'impression visuelle qui plafonne la note, comme constat incertain, à confirmer.
 */
function centeringReason(face: Face, m: Centering[Face], eye: (typeof VISUAL)[number]): [string, Grade, Confidence] {
  const seen = `à l'œil : ${word(eye)}`;
  if (!m) return [`centrage du ${face} (${seen})`, VISUAL_CAP[eye], "faible"];
  const worst = Math.max(m.lr, m.tb);
  const cap = centeringCap(face, worst);
  const ratio = `${dec(worst)}/${dec(100 - worst)}`;
  if (m.sure && VISUAL_CAP[eye] - cap < 2) return [`centrage du ${face} (${ratio})`, cap, "elevee"];
  const doubt = m.coupe?.length ? "mesure sur image rognée" : m.sure ? "mesure contredite" : "mesure incertaine";
  return [`centrage du ${face} (${seen} ; ${doubt} : ${ratio})`, VISUAL_CAP[eye], "faible"];
}

/**
 * Verdict par règles fixes : chaque critère plafonne la note (coin léger -> 9, visible -> 8…), la note retenue est le
 * plus bas des plafonds. Photos inexploitables, ou trop de constats incertains : « photos insuffisantes ».
 */
export function verdict(f: Findings, c: Centering): Reasons {
  const caps: { label: string; cap: Grade; sure: boolean }[] = [];
  const add = (label: string, cap: Grade, conf: Confidence) => caps.push({ label, cap, sure: conf !== "faible" });
  for (const face of FACES) {
    for (const k of CORNERS) {
      const v = f.coins[face][k];
      add(`coin ${CORNER_NAME[k]} du ${face} (${word(v.etat)})`, CORNER_CAP[v.etat], v.confiance);
    }
    for (const k of EDGES) {
      const v = f.bords[face][k];
      add(`bord ${EDGE_NAME[k]} du ${face} (blanchiment ${word(v.blanchiment)})`, EDGE_CAP[v.blanchiment], v.confiance);
    }
    const s = f.surface[face];
    add(`surface du ${face} (${word(s.gravite)})`, SURFACE_CAP[s.gravite], s.confiance);
    add(...centeringReason(face, c[face], f.centrage_visuel[face]));
  }
  const plafond = Math.min(...caps.map((x) => x.cap)) as Grade;
  const incertains = caps.filter((x) => !x.sure).map((x) => x.label);
  const limites = plafond < 10 ? caps.filter((x) => x.cap === plafond).map((x) => x.label) : [];
  const insufficient = !f.qualite_photos.exploitable || incertains.length > 4;
  return {
    plafond,
    verdict: insufficient
      ? "photos_insuffisantes"
      : plafond === 10
        ? "candidat_10"
        : plafond === 9
          ? "probable_9"
          : "huit_ou_moins",
    limites,
    incertains,
  };
}

// --- coût ------------------------------------------------------------------------------------------------------------

/** Tarifs en $ par million de jetons (entrée, sortie), shared/models.md du SDK Claude, novembre 2026. */
const PRICES: Record<string, [number, number]> = {
  "claude-opus-5-5": [4, 20],
  "claude-sonnet-5-5": [2, 10],
};
export function costUsd(model: string, input: number, output: number): number | null {
  const p = PRICES[model];
  return p ? Math.round((input * p[0] + output * p[1]) / 10_000) / 100 : null;
}

// --- appel ----------------------------------------------------------------------------------------------------------

/** Photos envoyées, dans cet ordre : vues entières, coins, puis bords s'ils ont été pris. */
export const ANALYSE_STEPS = [
  ...FACES,
  ...FACES.flatMap((f) => CORNERS.map((c) => `${f}-${c}`)),
  ...FACES.flatMap((f) => EDGES.map((e) => `${f}-${e}`)),
];
export const REQUIRED_STEPS = ANALYSE_STEPS.slice(0, 10);
const STEP_LABEL = (step: string) => {
  const [face, part] = step.split("-") as [Face, string | undefined];
  if (!part) return `${face} entier, redressé (63 × 88 mm, 20 pixels par mm)`;
  if (part in CORNER_NAME) return `${face}, gros plan du coin ${CORNER_NAME[part as keyof typeof CORNER_NAME]}`;
  return `${face}, gros plan du bord ${EDGE_NAME[part as keyof typeof EDGE_NAME]}`;
};

export const SYSTEM = `Tu pré-évalues une carte Pokémon avant un envoi au grading PSA. Les photos viennent d'un scanner \
guidé : recto et verso entiers, redressés à plat, puis des gros plans de chaque coin (et parfois de chaque bord). \
Relève ce que les photos montrent, sans rien supposer au-delà.

Coins : « parfait » (pointe nette, aucun blanc), « leger » (micro-usure, point blanc à peine visible), « visible » \
(blanchiment ou arrondi net), « important » (coin écrasé, plié ou décollé).
Bords : blanchiment « aucun », « leger », « visible » ou « important ». Sur le verso bleu, le moindre blanc se voit.
Surface de chaque face : rayures, lignes d'impression, bosses, plis, taches, défauts du holo ; gravité « aucune », \
« legere », « visible » ou « importante », avec la liste des défauts vus.
Centrage : ton impression visuelle, face par face, en comparant les bordures opposées : « bon » (recto \
jusqu'à 55/45 environ, verso jusqu'à 75/25), « limite » (recto vers 60/40, verso vers 90/10), « decale » (au-delà). \
Le site mesure aussi le centrage ; ton impression sert de contrôle.
Confiance de chaque constat : « elevee » si la zone est nette et bien éclairée, « moyenne », « faible » si elle est \
floue, masquée par un reflet ou trop petite. Ne donne « parfait » ou « aucun » avec une confiance élevée que sur une \
zone nette.
Distingue les défauts de la carte des artefacts de photo (reflet, poussière sur l'objectif, compression, sleeve).
Qualité des photos : « exploitable » à faux si l'ensemble ne permet pas de juger la carte ; liste les problèmes.
Réponse : « coins » contient 8 entrées, une par coin de chaque face (« coin » hg, hd, bd ou bg = haut gauche, \
haut droit, bas droit, bas gauche) ; « bords » 8 entrées, une par bord de chaque face (« bord » h, d, b ou g) ; \
« surface » 2 entrées, une par face.
Réponds en français, en phrases courtes ; « detail » vide s'il n'y a rien à signaler ; « resume » en deux ou trois \
phrases, sans donner de note.`;

/** Sans format imposé (repli) : la même réponse, demandée en JSON seul et revalidée de la même façon. */
const JSON_ONLY = `Réponds uniquement par un objet JSON, sans texte autour ni bloc de code, conforme à ce schéma : \
${JSON.stringify(FINDINGS_SCHEMA)}`;

/** Le JSON de la réponse : le texte entier, ou à défaut l'objet entre la première et la dernière accolade. */
function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    const from = text.indexOf("{");
    const to = text.lastIndexOf("}");
    if (from < 0 || to <= from) throw new AnalyseError("réponse de Claude illisible");
    try {
      return JSON.parse(text.slice(from, to + 1));
    } catch {
      throw new AnalyseError("réponse de Claude illisible");
    }
  }
}

export interface PhotoRef {
  id: string;
  step: string;
  mime: string;
}

export interface Outcome {
  findings: Findings;
  input_tokens: number;
  output_tokens: number;
}

export class AnalyseError extends Error {}

/**
 * Message lisible d'un échec, enregistré avec l'analyse et affiché dans la fiche : statut, type et message renvoyés
 * par Anthropic (« credit balance too low », image refusée…), jamais de secret.
 */
export function explain(e: unknown): string {
  if (e instanceof AnalyseError) return e.message;
  if (e instanceof APIError) {
    const body = e.error as { error?: { message?: unknown } } | undefined;
    const detail = typeof body?.error?.message === "string" ? body.error.message : e.message;
    return `Claude a répondu ${String(e.status ?? "sans statut")}${e.type ? ` (${e.type})` : ""} : ${detail}`.slice(
      0,
      400,
    );
  }
  return e instanceof Error ? e.message.slice(0, 400) : "échec de l'appel à Claude";
}

/**
 * Envoie les photos (API Files : pas d'encodage base64 dans le Worker, plan gratuit à 10 ms de calcul) puis demande
 * les constats à Claude ; les fichiers sont supprimés ensuite (ils expirent de toute façon au bout d'une heure).
 */
export async function askClaude(
  client: Anthropic,
  model: string,
  photos: PhotoRef[],
  read: (id: string) => Promise<ArrayBuffer | null>,
  progress: (step: "envoi" | "analyse") => void,
): Promise<Outcome> {
  progress("envoi");
  const sent: string[] = [];
  try {
    // allSettled : tous les envois sont terminés avant le nettoyage, même si l'un d'eux échoue
    const results = await Promise.allSettled(
      photos.map(async (p) => {
        const bytes = await read(p.id);
        if (!bytes) throw new AnalyseError(`photo introuvable (${p.step})`);
        const ext = p.mime === "image/webp" ? "webp" : "jpg";
        const meta = await client.files.upload({
          file: new File([bytes], `${p.step}.${ext}`, { type: p.mime }),
          expires_in_seconds: 3600,
        });
        sent.push(meta.id);
        return { ...p, file: meta.id };
      }),
    );
    const uploaded = results.map((r, i) => {
      if (r.status === "fulfilled") return r.value;
      if (r.reason instanceof AnalyseError) throw r.reason;
      throw new AnalyseError(`envoi des photos refusé (${photos[i]?.step ?? "?"}) — ${explain(r.reason)}`);
    });
    progress("analyse");
    const content = [
      ...uploaded.flatMap((p, i) => [
        { type: "text" as const, text: `Photo ${i + 1} : ${STEP_LABEL(p.step)}` },
        { type: "image" as const, source: { type: "file" as const, file_id: p.file } },
      ]),
      { type: "text" as const, text: "Relève l'état de cette carte dans le format demandé." },
    ];
    const ask = (structured: boolean) =>
      client.messages.create({
        model,
        max_tokens: 16_000,
        system: structured ? SYSTEM : `${SYSTEM}\n\n${JSON_ONLY}`,
        output_config: structured
          ? { effort: "high", format: { type: "json_schema", schema: FINDINGS_SCHEMA } }
          : { effort: "high" },
        messages: [{ role: "user", content }],
      });
    const message = await ask(true)
      .catch((e: unknown) => {
        // format imposé refusé (grammaire trop lourde) : même demande sans format imposé, réponse revalidée ici
        if (e instanceof APIError && e.status === 400 && /grammar/i.test(e.message)) return ask(false);
        throw e;
      })
      .catch((e: unknown) => {
        throw new AnalyseError(`analyse refusée — ${explain(e)}`);
      });
    if (message.stop_reason === "refusal") throw new AnalyseError("Claude a refusé l'analyse");
    if (message.stop_reason === "max_tokens") throw new AnalyseError("réponse de Claude tronquée");
    const text = message.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
    const parsed = reply.safeParse(parseJson(text));
    if (!parsed.success) throw new AnalyseError("réponse de Claude hors format");
    return {
      findings: arrange(parsed.data),
      input_tokens: message.usage.input_tokens,
      output_tokens: message.usage.output_tokens,
    };
  } finally {
    await Promise.allSettled(sent.map((id) => client.files.delete(id)));
  }
}
