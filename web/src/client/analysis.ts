// Pré-évaluation PSA d'un scan par Claude, dans la fiche : centrage mesuré ici (recto et verso redressés), constats de
// Claude reçus en flux, verdict par règles fixes (serveur), note PSA réellement obtenue (fiabilité mesurée à terme).
import { api, ApiError } from "./api";
import { action, h, toast } from "./dom";
import { borders, type Borders } from "./vision";

type Corner = "parfait" | "leger" | "visible" | "important";
type Edge = "aucun" | "leger" | "visible" | "important";
type Surface = "aucune" | "legere" | "visible" | "importante";
type Confidence = "faible" | "moyenne" | "elevee";
type FaceOf<T> = { recto: T; verso: T };
interface Findings {
  qualite_photos: { exploitable: boolean; problemes: string[] };
  coins: FaceOf<Record<"hg" | "hd" | "bd" | "bg", { etat: Corner; confiance: Confidence; detail: string }>>;
  bords: FaceOf<Record<"h" | "d" | "b" | "g", { blanchiment: Edge; confiance: Confidence; detail: string }>>;
  surface: FaceOf<{ gravite: Surface; defauts: string[]; confiance: Confidence }>;
  centrage_visuel: FaceOf<"bon" | "limite" | "decale">;
  resume: string;
}
export interface Analyse {
  id: string;
  created_at: string;
  state: "en_cours" | "terminee" | "echec" | "interrompue";
  model: string;
  centrage: FaceOf<Borders | null> | null;
  constats: Findings | null;
  verdict: "candidat_10" | "probable_9" | "huit_ou_moins" | "photos_insuffisantes" | null;
  plafond: number | null;
  raisons: { limites: string[]; incertains: string[] } | null;
  cout_usd: number | null;
  erreur: string | null;
  note_psa: number | null;
}
export interface ClaudeStatus {
  configured: boolean;
  model: string;
  par_jour: number;
  restantes: number;
}
interface Photo {
  id: string;
  step: string;
  width: number;
}

/** Photos sans lesquelles Claude ne peut pas juger : recto, verso et les 8 coins. */
const REQUIRED = [
  "recto",
  "verso",
  ...["recto", "verso"].flatMap((f) => ["hg", "hd", "bd", "bg"].map((c) => `${f}-${c}`)),
];

const VERDICT = {
  candidat_10: "Candidat PSA 10",
  probable_9: "Probable PSA 9",
  huit_ou_moins: "PSA 8 ou moins",
  photos_insuffisantes: "Photos insuffisantes",
} as const;
const WORD: Record<string, string> = {
  leger: "léger",
  legere: "légère",
  elevee: "élevée",
  decale: "décalé",
};
const word = (v: string) => WORD[v] ?? v;
/** Gravité 0 (rien) à 3 (important) : couleur de l'état. */
const SEVERITY: Record<string, number> = {
  parfait: 0,
  aucun: 0,
  aucune: 0,
  leger: 1,
  legere: 1,
  visible: 2,
  important: 3,
  importante: 3,
};
const modelName = (m: string) =>
  m.replace(/^claude-([a-z]+)-(\d+)-(\d+)$/, (_, n: string, a: string, b: string) => {
    return `Claude ${n.charAt(0).toUpperCase()}${n.slice(1)} ${a}.${b}`;
  });
const num = (v: number, digits = 1) => v.toLocaleString("fr-BE", { maximumFractionDigits: digits });
const usd = (v: number) => `${v.toLocaleString("fr-BE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} $`;
const when = (iso: string) => new Date(iso).toLocaleString("fr-BE", { dateStyle: "short", timeStyle: "short" });

// --- centrage ------------------------------------------------------------------------------------------------------

/** Bordures d'une vue entière redressée (63 mm de large), mesurées sur la photo d'origine. */
async function measure(photo: Photo | undefined): Promise<Borders | null> {
  if (!photo) return null;
  const img = new Image();
  img.src = `/api/photos/${photo.id}`;
  await img.decode();
  const canvas = document.createElement("canvas");
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(img, 0, 0);
  const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
  return borders(data, canvas.width, canvas.height, canvas.width / 63);
}

// --- écran allumé ----------------------------------------------------------------------------------------------------

type Lock = { release(): Promise<void> };
/** Écran allumé pendant l'analyse : en veille, le téléphone couperait la connexion (et le résultat en direct). */
async function keepAwake(): Promise<Lock | undefined> {
  const wake = (navigator as { wakeLock?: { request(type: "screen"): Promise<Lock> } }).wakeLock;
  try {
    return await wake?.request("screen");
  } catch {
    return undefined; // refusé (batterie faible, onglet masqué) ou non pris en charge : sans conséquence
  }
}

// --- lancement (réponse en flux) -----------------------------------------------------------------------------------

type Progress = { etape: "envoi" | "analyse"; photos?: number; secondes?: number };

async function run(scanId: string, centrage: FaceOf<Borders | null>, progress: (p: Progress) => void) {
  const r = await api(`/api/scans/${scanId}/analyses`, { method: "POST", json: { centrage } });
  const reader = r.body?.getReader();
  if (!reader) throw new ApiError("réponse vide", 0);
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (value) buffer += decoder.decode(value, { stream: true });
      let nl;
      while ((nl = buffer.indexOf("\n")) >= 0) {
        const line = JSON.parse(buffer.slice(0, nl)) as Progress | { analyse: Analyse } | { erreur: string };
        buffer = buffer.slice(nl + 1);
        if ("analyse" in line) return line.analyse;
        if ("erreur" in line) throw new ApiError(line.erreur, 502);
        progress(line);
      }
      if (done) throw new ApiError("analyse interrompue : réessaie", 0);
    }
  } finally {
    // résultat reçu (ou échec) : connexion fermée tout de suite, sans attendre la fin du flux
    void reader.cancel().catch(() => undefined);
  }
}

// --- résultat ------------------------------------------------------------------------------------------------------

const state = (value: string, conf?: Confidence, detail?: string) =>
  h(
    "span",
    {
      class: `sev sev-${String(SEVERITY[value] ?? 0)}${conf === "faible" ? " doubt" : ""}`,
      title: [detail, conf ? `confiance ${word(conf)}` : ""].filter(Boolean).join(" · ") || undefined,
    },
    word(value),
    conf === "faible" ? " ?" : "",
  );

function grid(
  caption: string,
  cols: [string, string][],
  cell: (face: "recto" | "verso", key: string) => HTMLElement,
): HTMLElement {
  return h(
    "table",
    { class: "an-grid" },
    h("caption", {}, caption),
    h("tr", {}, h("td", {}), ...cols.map(([, label]) => h("th", { scope: "col" }, label))),
    ...(["recto", "verso"] as const).map((face) =>
      h("tr", {}, h("th", { scope: "row" }, face), ...cols.map(([key]) => h("td", {}, cell(face, key)))),
    ),
  );
}

function centeringLine(face: "recto" | "verso", b: Borders | null, visual: string | undefined): HTMLElement {
  const limit = face === "recto" ? "55/45" : "75/25";
  if (!b) return h("li", {}, `${face} : non mesurable sur la photo`, visual ? ` (à l'œil : ${word(visual)})` : "");
  const pair = (v: number) => `${num(v)}/${num(100 - v)}`;
  return h(
    "li",
    {},
    `${face} : ${pair(b.lr)} gauche-droite, ${pair(b.tb)} haut-bas`,
    h(
      "span",
      { class: "mut" },
      ` (bordures ${num(b.gauche)} · ${num(b.droite)} · ${num(b.haut)} · ${num(b.bas)} mm ; PSA 10 jusqu'à ${limit})`,
    ),
    b.sure ? "" : h("span", { class: "sev sev-1" }, " mesure incertaine"),
  );
}

function result(a: Analyse, changed: () => void): HTMLElement {
  if (a.state !== "terminee" || !a.constats || !a.verdict)
    return h(
      "p",
      { class: "mut" },
      `Analyse du ${when(a.created_at)} : `,
      a.state === "en_cours"
        ? "en cours…"
        : a.state === "interrompue"
          ? "interrompue."
          : `échec (${a.erreur ?? "erreur"}).`,
    );
  const f = a.constats;
  const psa = h(
    "select",
    {
      "aria-label": "Note PSA obtenue",
      onchange: (e: Event) => {
        const sel = e.currentTarget as HTMLSelectElement;
        const note = sel.value ? Number(sel.value) : null;
        action(null, async () => {
          await api(`/api/analyses/${a.id}/psa`, { method: "PUT", json: { note } });
          a.note_psa = note;
          toast(note === null ? "Note PSA effacée." : "Note PSA enregistrée.");
          changed();
        });
      },
    },
    h("option", { value: "" }, "pas encore gradée"),
    ...[10, 9, 8.5, 8, 7.5, 7, 6.5, 6, 5.5, 5, 4.5, 4, 3.5, 3, 2.5, 2, 1.5, 1].map((g) => {
      const o = h("option", { value: String(g) }, `PSA ${num(g)}`);
      o.selected = a.note_psa === g;
      return o;
    }),
  );
  const reasons = a.raisons ?? { limites: [], incertains: [] };
  return h(
    "article",
    { class: `an-result v-${a.verdict}` },
    h(
      "p",
      { class: "an-verdict" },
      h("strong", {}, VERDICT[a.verdict]),
      a.verdict === "photos_insuffisantes" ? "" : ` · note maximale plausible : ${String(a.plafond ?? "?")}`,
    ),
    reasons.limites.length ? h("p", {}, "Limité par : ", reasons.limites.join(" ; "), ".") : null,
    reasons.incertains.length
      ? h("p", { class: "mut" }, "À confirmer (zone peu nette) : ", reasons.incertains.join(" ; "), ".")
      : null,
    h("h4", {}, "Centrage mesuré"),
    h(
      "ul",
      { class: "an-list" },
      centeringLine("recto", a.centrage?.recto ?? null, f.centrage_visuel.recto),
      centeringLine("verso", a.centrage?.verso ?? null, f.centrage_visuel.verso),
    ),
    grid(
      "Coins",
      [
        ["hg", "haut g."],
        ["hd", "haut d."],
        ["bd", "bas d."],
        ["bg", "bas g."],
      ],
      (face, k) => {
        const v = f.coins[face][k as "hg"];
        return state(v.etat, v.confiance, v.detail);
      },
    ),
    grid(
      "Bords (blanchiment)",
      [
        ["h", "haut"],
        ["d", "droit"],
        ["b", "bas"],
        ["g", "gauche"],
      ],
      (face, k) => {
        const v = f.bords[face][k as "h"];
        return state(v.blanchiment, v.confiance, v.detail);
      },
    ),
    h("h4", {}, "Surface"),
    h(
      "ul",
      { class: "an-list" },
      ...(["recto", "verso"] as const).map((face) => {
        const v = f.surface[face];
        return h(
          "li",
          {},
          `${face} : `,
          state(v.gravite, v.confiance),
          v.defauts.length ? ` (${v.defauts.join(", ")})` : "",
        );
      }),
    ),
    f.qualite_photos.problemes.length
      ? h("p", { class: "mut" }, "Photos : ", f.qualite_photos.problemes.join(" ; "), ".")
      : null,
    h("p", { class: "an-summary" }, f.resume),
    h(
      "p",
      { class: "an-foot" },
      `${modelName(a.model)} · ${when(a.created_at)}`,
      a.cout_usd != null ? ` · ${usd(a.cout_usd)}` : "",
      " · ",
      h("label", {}, "Note obtenue ", psa),
    ),
  );
}

// --- bloc de la fiche ----------------------------------------------------------------------------------------------

/** Pré-évaluation du dernier scan : bouton, avancement, dernier résultat, analyses précédentes. */
export function analysisBlock(
  scan: { id: string; photos: Photo[]; analyses: Analyse[] },
  claude: ClaudeStatus,
  changed: () => void,
): HTMLElement {
  const [last, ...older] = scan.analyses;
  const missing = REQUIRED.filter((s) => !scan.photos.some((p) => p.step === s));
  const status = h("p", { class: "mut", role: "status", "aria-live": "polite" });
  const running = last?.state === "en_cours";
  const btn = h(
    "button",
    {
      type: "button",
      onclick: () => {
        action(btn, async () => {
          const lock = await keepAwake();
          try {
            status.textContent = "Mesure du centrage…";
            const view = (step: string) => scan.photos.find((p) => p.step === step);
            const centrage = { recto: await measure(view("recto")), verso: await measure(view("verso")) };
            const started = Date.now();
            await run(scan.id, centrage, (p) => {
              const s = Math.round((Date.now() - started) / 1000);
              status.textContent =
                p.etape === "envoi"
                  ? `Envoi des ${String(p.photos ?? "")} photos à Claude…`
                  : `Claude examine la carte… ${String(s)} s (une à deux minutes)`;
            });
            toast("Pré-évaluation terminée.");
          } finally {
            void lock?.release().catch(() => undefined);
            // succès ou échec : la fiche se redessine (résultat ou échec enregistré, quota du jour à jour)
            changed();
          }
        });
      },
    },
    "🔍 Pré-évaluer avec Claude",
  );
  btn.disabled = !claude.configured || missing.length > 0 || claude.restantes <= 0 || running;
  const note = !claude.configured
    ? "Pré-évaluation par Claude pas encore configurée (fédération d'identité, voir la documentation)."
    : missing.length
      ? "Pour la pré-évaluation, il faut un scan complet : recto, verso et les 8 coins."
      : claude.restantes <= 0
        ? `Limite de ${String(claude.par_jour)} analyses atteinte aujourd'hui.`
        : `${modelName(claude.model)}, environ 0,25 $ par analyse · ${String(claude.restantes)} restante${claude.restantes > 1 ? "s" : ""} aujourd'hui.`;
  status.textContent = note;
  return h(
    "div",
    { class: "analysis" },
    h("h4", {}, "Pré-évaluation PSA"),
    h("div", { class: "an-run" }, btn, status),
    last ? result(last, changed) : null,
    older.length
      ? h(
          "details",
          { "data-key": "analyses-old" },
          h("summary", {}, `Analyses précédentes (${String(older.length)})`),
          ...older.map((a) => result(a, changed)),
        )
      : null,
    h(
      "p",
      { class: "mut an-note" },
      "Indicatif : PSA examine la surface à la loupe et en lumière rasante ; une photo ne remplace pas cet examen.",
    ),
  );
}
