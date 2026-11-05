// Pré-évaluation PSA des photos d'une carte par Claude, dans la fiche : Claude trie les photos, relève l'état de la
// carte et mesure les bordures (réponse en flux) ; verdict par règles fixes (serveur) ; note PSA réellement obtenue
// (fiabilité mesurée à terme).
import { api, ApiError } from "./api";
import { action, h, toast } from "./dom";

/** Centrage mesuré par le scanner précédent (anciennes analyses seulement). */
interface Measured {
  gauche: number;
  droite: number;
  haut: number;
  bas: number;
  lr: number;
  tb: number;
  sure: boolean;
  coupe?: ("hg" | "hd" | "bd" | "bg")[];
}
/** Bordures mesurées par Claude sur une vue entière (pixels de la photo ; photo 0 : aucune vue utilisable). */
interface ClaudeBorders {
  photo: number;
  gauche: number;
  droite: number;
  haut: number;
  bas: number;
  confiance: Confidence;
  detail: string;
}

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
  /** Analyses récentes : bordures mesurées par Claude, ce que montre chaque photo, photos à ajouter. */
  centrage?: FaceOf<ClaudeBorders>;
  photos?: { numero: number; contenu: string }[];
  a_prendre?: string[];
  /** Anciennes analyses : impression visuelle de Claude, à côté de la mesure du site. */
  centrage_visuel?: FaceOf<"bon" | "limite" | "decale">;
  resume: string;
}
export interface Analyse {
  id: string;
  created_at: string;
  state: "en_cours" | "terminee" | "echec" | "interrompue";
  model: string;
  centrage: FaceOf<Measured | null> | null;
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

/** Photos nécessaires (le recto et le verso entiers) ; au-delà de 20, les suivantes ne sont pas envoyées. */
const MIN_PHOTOS = 2;
const MAX_PHOTOS = 20;
/**
 * Coût estimé d'une analyse : jusqu'à ~4 800 jetons par photo en haute définition, ~3 000 jetons de consignes et de
 * réponse réfléchie, aux tarifs d'Opus 5.5 (4 $ et 20 $ par million de jetons).
 */
export const estimate = (photos: number) => (Math.min(photos, MAX_PHOTOS) * 4800 + 3000) * 4e-6 + 4000 * 20e-6;

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

async function run(scanId: string, progress: (p: Progress) => void) {
  const r = await api(`/api/scans/${scanId}/analyses`, { method: "POST", json: {} });
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

const CUT_NAME = { hg: "haut gauche", hd: "haut droit", bd: "bas droit", bg: "bas gauche" } as const;
const LIMIT = { recto: "55/45", verso: "75/25" } as const;
const pair = (v: number) => `${num(v)}/${num(100 - v)}`;
const share = (a: number, b: number) => (100 * Math.max(a, b)) / (a + b);

/** Centrage d'une face mesuré par Claude (bordures en pixels sur une vue entière). */
function claudeCentering(face: "recto" | "verso", m: ClaudeBorders): HTMLElement {
  if (!(m.photo > 0 && m.gauche + m.droite > 0 && m.haut + m.bas > 0))
    return h("li", {}, `${face} : non mesurable sur les photos`, m.detail ? ` (${m.detail})` : "");
  return h(
    "li",
    {},
    `${face} : ${pair(share(m.gauche, m.droite))} gauche-droite, ${pair(share(m.haut, m.bas))} haut-bas`,
    h("span", { class: "mut" }, ` (mesuré sur la photo ${String(m.photo)} ; PSA 10 jusqu'à ${LIMIT[face]})`),
    m.confiance === "faible" ? h("span", { class: "sev sev-1" }, " mesure incertaine") : "",
    m.detail ? h("span", { class: "mut" }, ` · ${m.detail}`) : "",
  );
}

/** Ancienne analyse : centrage mesuré par le site sur la vue redressée, impression visuelle de Claude à côté. */
function siteCentering(face: "recto" | "verso", b: Measured | null, visual: string | undefined): HTMLElement {
  if (!b) return h("li", {}, `${face} : non mesurable sur la photo`, visual ? ` (à l'œil : ${word(visual)})` : "");
  return h(
    "li",
    {},
    `${face} : ${pair(b.lr)} gauche-droite, ${pair(b.tb)} haut-bas`,
    h(
      "span",
      { class: "mut" },
      ` (bordures ${num(b.gauche)} · ${num(b.droite)} · ${num(b.haut)} · ${num(b.bas)} mm ; PSA 10 jusqu'à ${LIMIT[face]})`,
    ),
    b.coupe?.length
      ? h(
          "span",
          { class: "sev sev-1" },
          ` carte coupée sur la photo (${b.coupe.length > 1 ? "coins" : "coin"} ${b.coupe.map((c) => CUT_NAME[c]).join(", ")}) : mesure non fiable`,
        )
      : b.sure
        ? ""
        : h("span", { class: "sev sev-1" }, " mesure incertaine"),
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
    f.a_prendre?.length
      ? h(
          "div",
          { class: "an-more" },
          h("p", {}, h("strong", {}, "Photos à ajouter pour conclure :")),
          h("ul", {}, ...f.a_prendre.map((t) => h("li", {}, t))),
        )
      : null,
    h("h4", {}, "Centrage"),
    h(
      "ul",
      { class: "an-list" },
      ...(["recto", "verso"] as const).map((face) =>
        f.centrage
          ? claudeCentering(face, f.centrage[face])
          : siteCentering(face, a.centrage?.[face] ?? null, f.centrage_visuel?.[face]),
      ),
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
    f.photos?.length
      ? h(
          "details",
          { "data-key": `photos-${a.id}` },
          h("summary", {}, "Ce que montre chaque photo"),
          h(
            "ol",
            { class: "an-photos" },
            ...f.photos.map((p) => h("li", {}, `Photo ${String(p.numero)} : ${p.contenu}`)),
          ),
        )
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

/**
 * Pré-évaluation du dernier scan : bouton, avancement, dernier résultat, analyses précédentes. `auto` : lancée tout de
 * suite (photos enregistrées avec « Enregistrer et pré-évaluer »).
 */
export function analysisBlock(
  scan: { id: string; photos: Photo[]; analyses: Analyse[] },
  claude: ClaudeStatus,
  changed: () => void,
  auto = false,
): HTMLElement {
  const [last, ...older] = scan.analyses;
  const missing = scan.photos.length < MIN_PHOTOS;
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
            status.textContent = "Préparation…";
            const started = Date.now();
            await run(scan.id, (p) => {
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
  btn.disabled = !claude.configured || missing || claude.restantes <= 0 || running;
  const n = Math.min(scan.photos.length, MAX_PHOTOS);
  const note = !claude.configured
    ? "Pré-évaluation par Claude pas encore configurée (fédération d'identité, voir la documentation)."
    : missing
      ? "Pour la pré-évaluation, il faut au moins le recto et le verso entiers."
      : claude.restantes <= 0
        ? `Limite de ${String(claude.par_jour)} analyses atteinte aujourd'hui.`
        : `${modelName(claude.model)}, environ ${usd(estimate(n))} pour ${String(n)} photos · ${String(claude.restantes)} restante${claude.restantes > 1 ? "s" : ""} aujourd'hui.`;
  status.textContent = note;
  // lancée d'office après l'enregistrement des photos, une seule fois
  if (auto && !btn.disabled)
    queueMicrotask(() => {
      btn.click();
    });
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
