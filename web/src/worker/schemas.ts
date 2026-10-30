// Validation des entrées avec zod/mini (API fonctionnelle, bundle ~10× plus petit que zod complet).
import * as z from "zod/mini";
import { TIERS } from "./logic";

const note = z.nullish(z.string().check(z.trim(), z.maxLength(300)));
const tier = z.enum(TIERS);
const paid = z.nullish(z.number().check(z.gte(0), z.lte(100_000)));
const species = z.number().check(z.int(), z.gte(1), z.lte(151));
export const cardId = z.string().check(z.regex(/^[A-Za-z0-9.-]{1,40}$/));

export const speciesParam = z.object({
  num: z.pipe(
    z.string().check(z.regex(/^\d{1,3}$/)),
    z.pipe(
      z.transform((s: string) => Number(s)),
      species,
    ),
  ),
});
export const ownedBody = z.union([z.strictObject({ card_id: cardId, note }), z.strictObject({ tier, note })]);
export const keepBody = z.strictObject({ note });
/** États de la grille Cardmarket. */
const condition = z.nullish(z.enum(["MT", "NM", "EX", "GD", "LP", "PL", "PO"]));
const grade = z.nullish(z.string().check(z.trim(), z.maxLength(20)));
const doubles = z.optional(z.number().check(z.int(), z.gte(0), z.lte(99)));
export const detailsBody = z.strictObject({ note, condition, grade, doubles });
/** Version ajoutée depuis le site : id TCGdex choisi parmi les candidates, rareté déclarée par Terence. */
export const addCardBody = z.strictObject({ species_num: species, id: cardId, tier });
export const alertBody = z.strictObject({ max_price: z.number().check(z.gt(0), z.lte(100_000)) });
export const cardParam = z.object({ id: cardId });
export const wishBody = z.strictObject({ card_id: cardId });
export const excludeBody = z.strictObject({ reason: note });
/** Nouvelle commande ; `received` : achat déjà en main (boutique) -> directement au binder. */
const day = z.string().check(z.regex(/^\d{4}-\d{2}-\d{2}$/));
export const purchaseBody = z.strictObject({
  card_id: cardId,
  price_paid: paid,
  note,
  received: z.optional(z.boolean()),
  /** Date de la commande (import Cardmarket), aujourd'hui sinon. */
  date: z.optional(day),
});
export const purchaseParam = z.object({
  id: z.pipe(
    z.string().check(z.regex(/^\d{1,9}$/)),
    z.transform((s: string) => Number(s)),
  ),
});
/** Prix payé pour la carte possédée (« Ma carte ») ; date d'achat facultative (aujourd'hui sinon). */
export const paidBody = z.strictObject({
  price_paid: paid,
  date: z.optional(day),
});
/** Budget mensuel (avec report du solde d'un mois sur l'autre), à partir d'un mois donné ; null : pas de budget. */
export const budgetBody = z.strictObject({
  monthly: z.nullable(z.number().check(z.gt(0), z.lte(100_000))),
  since: z.string().check(z.regex(/^\d{4}-(0[1-9]|1[0-2])$/)),
});
export const purchasePatch = z.strictObject({ state: z.enum(["recue", "annulee"]), price_paid: paid });
const wantTier = z._default(z.enum([...TIERS, "cheapest", "sir_ir", "objectif"]), "objectif");
export const wantsQuery = z.object({ tier: wantTier });
export const placeholdersQuery = z.object({
  scope: z._default(z.enum(["missing", "all"]), "missing"),
});
const isoDate = z.string().check(z.regex(/^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/));
const tcgdexImage = z.optional(z.url({ protocol: /^https$/, hostname: /^assets\.tcgdex\.net$/ }));
/** Version ajoutée depuis le site, telle qu'enregistrée dans une sauvegarde v3. */
const siteCard = z.object({
  id: cardId,
  species_num: species,
  nom_fr: z.string().check(z.minLength(1), z.maxLength(80)),
  set_name: z.string().check(z.minLength(1), z.maxLength(80)),
  numero: z.string().check(z.minLength(1), z.maxLength(20)),
  tier,
  id_product: z.nullable(z.number().check(z.int(), z.gt(0))),
  code_cm: z.nullable(z.string().check(z.maxLength(30))),
  image: z.nullable(z.url({ protocol: /^https$/, hostname: /^assets\.tcgdex\.net$/ })),
});
/**
 * Sauvegarde : version 1 (binder seul), 2 (+ versions visées, écartées, commandes) ou 3 (+ versions ajoutées
 * depuis le site, alertes de prix).
 */
export const importBody = z.strictObject({
  version: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  owned: z
    .array(z.object({ species_num: species, card_id: z.nullable(cardId), tier, note, condition, grade, doubles }))
    .check(z.maxLength(151)),
  keep: z.array(z.object({ species_num: species, note })).check(z.maxLength(151)),
  wish: z.optional(z.array(z.object({ species_num: species, card_id: cardId })).check(z.maxLength(151))),
  excluded: z.optional(z.array(z.object({ card_id: cardId, reason: note })).check(z.maxLength(2000))),
  purchases: z.optional(
    z
      .array(
        z.object({
          card_id: cardId,
          state: z.enum(["commandee", "recue", "annulee"]),
          price_paid: paid,
          ordered_at: isoDate,
          received_at: z.nullable(isoDate),
          note,
        }),
      )
      .check(z.maxLength(5000)),
  ),
  cards_site: z.optional(z.array(siteCard).check(z.maxLength(2000))),
  budget: z.optional(z.nullable(z.lazy(() => budgetBody))),
  alerts: z.optional(
    z
      .array(z.object({ card_id: cardId, max_price: z.number().check(z.gt(0), z.lte(100_000)) }))
      .check(z.maxLength(2000)),
  ),
});
/** Réponse TCGdex (source externe : jamais crue sur parole). */
const num = z.nullish(z.number().check(z.gte(0)));
/** Prix du guide Cardmarket publiés par .github/workflows/prix.yml (branche donnees-prix) : vérifiés aussi. */
const point = z.object({ trend: num, low: num, avg1: num, avg7: num, avg30: num });
export const priceFeed = z.object({
  version: z.literal(1),
  guide: z.string().check(z.minLength(10), z.maxLength(40)),
  generated_at: z.string().check(z.maxLength(40)),
  prices: z.record(z.string().check(z.regex(/^\d{1,9}$/)), point),
});

/** Liste de cartes TCGdex (recherche) : seuls les champs utiles, vérifiés. */
export const tcgdexBriefs = z.array(
  z.object({
    id: cardId,
    localId: z.string().check(z.maxLength(20)),
    name: z.string().check(z.maxLength(80)),
    image: tcgdexImage,
  }),
);
/** Détail d'une carte TCGdex pour l'ajouter au catalogue. */
export const tcgdexDetail = z.object({
  id: cardId,
  localId: z.string().check(z.maxLength(20)),
  name: z.string().check(z.maxLength(80)),
  dexId: z.optional(z.array(z.number().check(z.int()))),
  image: tcgdexImage,
  set: z.object({ id: z.string().check(z.regex(/^[A-Za-z0-9.-]{1,30}$/)), name: z.string().check(z.maxLength(80)) }),
  pricing: z.nullish(
    z.object({ cardmarket: z.nullish(z.object({ idProduct: z.optional(z.number().check(z.int())) })) }),
  ),
});
export const tcgdexSet = z.object({
  abbreviation: z.optional(z.object({ official: z.optional(z.string().check(z.maxLength(20))) })),
});

export const tcgdexCard = z.object({
  image: z.optional(z.url({ protocol: /^https$/, hostname: /^assets\.tcgdex\.net$/ })),
  illustrator: z.optional(z.string().check(z.trim(), z.maxLength(80))),
  pricing: z.nullish(
    z.object({
      cardmarket: z.nullish(
        z.object({
          trend: num,
          "trend-holo": num,
          low: num,
          avg7: num,
          avg30: num,
          updated: z.optional(z.string()),
          idProduct: z.optional(z.number().check(z.int())),
        }),
      ),
    }),
  ),
});
