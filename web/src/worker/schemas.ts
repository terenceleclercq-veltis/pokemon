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
export const cardParam = z.object({ id: cardId });
export const wishBody = z.strictObject({ card_id: cardId });
export const excludeBody = z.strictObject({ reason: note });
/** Nouvelle commande ; `received` : achat déjà en main (boutique) -> directement au binder. */
export const purchaseBody = z.strictObject({
  card_id: cardId,
  price_paid: paid,
  note,
  received: z.optional(z.boolean()),
});
export const purchaseParam = z.object({
  id: z.pipe(
    z.string().check(z.regex(/^\d{1,9}$/)),
    z.transform((s: string) => Number(s)),
  ),
});
export const purchasePatch = z.strictObject({ state: z.enum(["recue", "annulee"]), price_paid: paid });
const wantTier = z._default(z.enum([...TIERS, "cheapest", "sir_ir", "objectif"]), "objectif");
export const wantsQuery = z.object({ tier: wantTier });
export const placeholdersQuery = z.object({
  scope: z._default(z.enum(["missing", "all"]), "missing"),
});
export const buylistQuery = z.object({
  tier: wantTier,
  budget: z.optional(z.coerce.number().check(z.gt(0), z.lte(100_000))),
});
const isoDate = z.string().check(z.regex(/^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/));
/** Sauvegarde : version 1 (binder seul) ou 2 (+ versions visées, écartées, commandes). */
export const importBody = z.strictObject({
  version: z.union([z.literal(1), z.literal(2)]),
  owned: z.array(z.object({ species_num: species, card_id: z.nullable(cardId), tier, note })).check(z.maxLength(151)),
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

export const tcgdexCard = z.object({
  image: z.optional(z.url({ protocol: /^https$/, hostname: /^assets\.tcgdex\.net$/ })),
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
