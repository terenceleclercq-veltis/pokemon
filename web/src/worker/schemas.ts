// Validation des entrées avec zod/mini (API fonctionnelle, bundle ~10× plus petit que zod complet).
import * as z from "zod/mini";
import { TIERS } from "./logic";

const note = z.nullish(z.string().check(z.trim(), z.maxLength(300)));
const tier = z.enum(TIERS);
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
const wantTier = z._default(z.enum([...TIERS, "cheapest", "sir_ir", "objectif"]), "objectif");
export const wantsQuery = z.object({ tier: wantTier });
export const placeholdersQuery = z.object({
  scope: z._default(z.enum(["missing", "all"]), "missing"),
});
export const buylistQuery = z.object({
  tier: wantTier,
  budget: z.optional(z.coerce.number().check(z.gt(0), z.lte(100_000))),
});
export const importBody = z.strictObject({
  version: z.literal(1),
  owned: z.array(z.object({ species_num: species, card_id: z.nullable(cardId), tier, note })).check(z.maxLength(151)),
  keep: z.array(z.object({ species_num: species, note })).check(z.maxLength(151)),
});
/** Réponse TCGdex (source externe : jamais crue sur parole). */
const num = z.nullish(z.number().check(z.gte(0)));
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
          updated: z.optional(z.string()),
          idProduct: z.optional(z.number().check(z.int())),
        }),
      ),
    }),
  ),
});
