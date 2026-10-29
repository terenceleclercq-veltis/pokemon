import { api, type Card, type Species, type Tier } from "./api";
import { $, $as, debounce, eur, h, pad, toast } from "./dom";

const STATUS_LABEL: Record<Species["status"], string> = {
  manquante: "Manquante",
  a_verifier: "Version plus rare dispo",
  complete: "Complète",
  choisie: "Choix conservé",
};
const TIER_LABEL: Record<Tier, string> = { FA: "Full art", IR: "Illustration Rare", SIR: "Special Illustration Rare" };
const TIERS: Tier[] = ["FA", "IR", "SIR"];

let data: Species[] = [];
let detailAbort: AbortController | undefined;
const byNum = (n: number) => data.find((s) => s.num === n);
const cheapest = (s: Species) =>
  s.cards
    .map((c) => c.price?.trend)
    .filter((v): v is number => v != null)
    .sort((a, b) => a - b)[0];

/** Action utilisateur : désactive le bouton pendant l'appel, toute erreur devient un message (aucun rejet non géré). */
/** Lien vers la version exacte sur Cardmarket (nouvel onglet, sans référent). */
function cmLink(url: string, label: string): HTMLAnchorElement {
  return h(
    "a",
    { href: url, target: "_blank", rel: "noopener noreferrer", "aria-label": `${label} sur Cardmarket` },
    "Voir les offres sur Cardmarket ↗",
  );
}

/** Code Cardmarket (« MEW 166 ») : un clic copie le libellé exact de la recherche (« Bulbizarre (MEW 166) »). */
function cmCode(code: string, label: string): HTMLButtonElement {
  return h(
    "button",
    {
      type: "button",
      class: "code",
      title: "Copier pour la recherche Cardmarket",
      "aria-label": `Copier « ${label} »`,
      onclick: () => {
        navigator.clipboard.writeText(label).then(
          () => {
            toast(`Copié : ${label}`);
          },
          () => {
            toast(`À rechercher sur Cardmarket : ${label}`);
          },
        );
      },
    },
    code,
  );
}

interface BuyItem {
  num: number;
  card_id: string;
  espece: string;
  label: string;
  url: string | null;
  trend: number | null;
}

/** Déduit le prix du budget restant (champ facultatif) après un achat. */
function spend(amount: number | null): void {
  const input = $as("buy-budget", HTMLInputElement);
  if (!input.value || amount == null) return;
  input.value = String(Math.max(0, Math.round((Number(input.value) - amount) * 100) / 100));
}

/** Marque des cartes comme achetées : elles passent au binder et sortent de la liste. */
async function markBought(items: readonly BuyItem[]): Promise<void> {
  for (const it of items) {
    await api(`/api/species/${it.num}/owned`, { method: "PUT", json: { card_id: it.card_id } });
    spend(it.trend);
  }
  toast(
    items.length === 1
      ? `${items[0]?.espece ?? ""} marqué comme acheté.`
      : `${items.length} cartes marquées comme achetées.`,
  );
  await load();
  await renderBuylist();
}

async function renderBuylist(): Promise<void> {
  const q = new URLSearchParams({ tier: $as("buy-tier", HTMLSelectElement).value });
  const budget = $as("buy-budget", HTMLInputElement).value;
  if (budget && Number(budget) > 0) q.set("budget", budget);
  const r = (await (await api(`/api/buylist?${q.toString()}`)).json()) as {
    items: BuyItem[];
    total: number;
    budget: number | null;
  };
  const ol = h("ol", { class: "buylist" });
  for (const it of r.items)
    ol.append(
      h(
        "li",
        {},
        it.url
          ? h("a", { href: it.url, target: "_blank", rel: "noopener noreferrer" }, it.label)
          : h("span", {}, `${it.label} (lien inconnu)`),
        ` · ${it.espece} · ${eur(it.trend)} `,
        h(
          "button",
          {
            type: "button",
            "aria-label": `${it.label} achetée`,
            onclick: (e: Event) => {
              action(e.currentTarget as HTMLButtonElement, () => markBought([it]));
            },
          },
          "Achetée",
        ),
      ),
    );
  const sum = `${r.items.length} carte${r.items.length > 1 ? "s" : ""} · ${eur(r.total)}${
    r.budget ? ` sur ${eur(r.budget)}` : ""
  } (tendance, hors port)`;
  const all = r.items.length
    ? h(
        "button",
        {
          type: "button",
          onclick: (e: Event) => {
            if (!confirm(`Marquer les ${r.items.length} cartes comme achetées ?`)) return;
            action(e.currentTarget as HTMLButtonElement, () => markBought(r.items));
          },
        },
        "Tout marquer comme acheté",
      )
    : null;
  $("buylist").replaceChildren(h("p", { class: "mut" }, sum), ol, all ?? "");
}

function action(btn: HTMLButtonElement | null, fn: () => Promise<void>): void {
  if (btn) btn.disabled = true;
  fn()
    .catch((e: unknown) => {
      toast(e instanceof Error ? e.message : "Erreur", "err");
    })
    .finally(() => {
      if (btn) btn.disabled = false;
    });
}

async function load(): Promise<void> {
  const r = (await (await api("/api/pokedex")).json()) as { species: Species[] };
  data = r.species;
  render();
}

function readState() {
  const p = new URLSearchParams(location.hash.slice(1));
  return { q: p.get("q") ?? "", f: p.get("f") ?? "all" };
}
function writeState(): void {
  const p = new URLSearchParams();
  const q = $as("q", HTMLInputElement).value.trim();
  const f = $as("filter", HTMLSelectElement).value;
  if (q) p.set("q", q);
  if (f !== "all") p.set("f", f);
  history.replaceState(null, "", p.size ? `#${p}` : location.pathname);
}

function render(): void {
  const q = $as("q", HTMLInputElement).value.trim().toLowerCase();
  const f = $as("filter", HTMLSelectElement).value;
  const done = data.filter((s) => s.status === "complete" || s.status === "choisie").length;
  const toCheck = data.filter((s) => s.status === "a_verifier").length;
  const none = data.filter((s) => s.cards.length === 0).length;
  const missingCost = data.filter((s) => s.status === "manquante").reduce((t, s) => t + (cheapest(s) ?? 0), 0);
  $("progress").textContent =
    `${done}/151 complètes · ${toCheck} à vérifier · ${none} sans full art FR · reste ≈ ${eur(missingCost)}`;
  $("bar-fill").style.width = `${(done / 151) * 100}%`;
  $("bar").setAttribute("aria-valuenow", String(done));

  const frag = document.createDocumentFragment();
  for (const s of data) {
    const noCard = s.cards.length === 0;
    if (q && !(s.nom_fr.toLowerCase().includes(q) || String(s.num) === q.replace(/^#?0*/, ""))) continue;
    if (f === "none" ? !noCard : f !== "all" && (noCard || s.status !== f)) continue;
    const sub = noCard
      ? "Aucune full art FR"
      : s.status === "manquante"
        ? `dès ${eur(cheapest(s))}`
        : STATUS_LABEL[s.status];
    frag.append(
      h(
        "button",
        {
          class: `tile ${noCard ? "none" : s.status}`,
          type: "button",
          role: "listitem",
          "data-num": s.num,
          "aria-label": `${pad(s.num)} ${s.nom_fr}, ${sub}`,
        },
        h("span", { class: "n" }, pad(s.num)),
        h("strong", {}, s.nom_fr),
        h("span", { class: "p" }, sub),
      ),
    );
  }
  const grid = $("grid");
  grid.replaceChildren(frag);
  $("empty").hidden = grid.childElementCount > 0;
}

async function openDetail(num: number): Promise<void> {
  const s = byNum(num);
  if (!s) return;
  detailAbort?.abort();
  detailAbort = new AbortController();
  const dlg = $as("detail", HTMLDialogElement);
  paint(s, true);
  if (!dlg.open) dlg.showModal();
  try {
    const live = (await (await api(`/api/species/${num}/prices`, { signal: detailAbort.signal })).json()) as Record<
      string,
      Card["price"]
    >;
    for (const c of s.cards) if (live[c.id]) c.price = { ...c.price, ...live[c.id]! };
    if (dlg.open && $("detail").dataset.num === String(num)) paint(s, false);
    render();
  } catch (e) {
    if ((e as Error).name !== "AbortError") toast("Prix en direct indisponibles : affichage du dernier relevé.", "err");
    paint(s, false);
  }
}

function paint(s: Species, loading: boolean): void {
  const box = $("detail-body");
  $("detail").dataset.num = String(s.num);
  const reload = async () => {
    await load();
    const fresh = byNum(s.num);
    if (fresh) paint(fresh, false);
  };
  const kids: Node[] = [h("h2", { id: "detail-title" }, `${pad(s.num)} ${s.nom_fr}`)];
  kids.push(
    h(
      "p",
      {},
      s.owned
        ? `Dans le binder : ${TIER_LABEL[s.owned.tier]}${s.owned.card_id ? "" : " (carte hors catalogue)"}`
        : "Pas encore dans le binder.",
    ),
  );
  if (s.status === "a_verifier")
    kids.push(
      h("p", { class: "warn" }, `${s.higher.length} version(s) plus rare(s) existe(nt).`),
      h(
        "button",
        {
          type: "button",
          onclick: (e: Event) => {
            action(e.currentTarget as HTMLButtonElement, async () => {
              await api(`/api/species/${s.num}/keep`, { method: "PUT", json: {} });
              toast("Choix conservé : plus de vérification.");
              await reload();
            });
          },
        },
        "Je préfère la mienne (ne plus vérifier)",
      ),
    );
  if (s.status === "choisie")
    kids.push(
      h("p", { class: "mut" }, "Choix conservé : plus de vérification. "),
      h(
        "button",
        {
          type: "button",
          onclick: (e: Event) => {
            action(e.currentTarget as HTMLButtonElement, async () => {
              await api(`/api/species/${s.num}/keep`, { method: "DELETE" });
              await reload();
            });
          },
        },
        "Reprendre la vérification",
      ),
    );
  if (!s.cards.length) kids.push(h("p", {}, "Aucune carte full art française connue pour cette espèce."));
  if (loading) kids.push(h("p", { class: "mut", role: "status" }, "Actualisation des prix…"));

  for (const tier of TIERS) {
    const cs = s.cards
      .filter((c) => c.tier === tier)
      .sort((a, b) => (a.price?.trend ?? Infinity) - (b.price?.trend ?? Infinity));
    if (!cs.length) continue;
    kids.push(h("h3", {}, TIER_LABEL[tier]));
    for (const c of cs) {
      const img = c.image ?? c.price?.image ?? null;
      const mine = s.owned?.card_id === c.id;
      kids.push(
        h(
          "div",
          { class: `opt${mine ? " mine" : ""}` },
          img
            ? h("img", {
                src: img,
                alt: `${c.nom_fr} (${c.set_name})`,
                loading: "lazy",
                decoding: "async",
                width: 56,
                height: 78,
              })
            : h("span", { class: "ph" }),
          h(
            "div",
            { class: "grow" },
            h("div", {}, c.nom_fr, c.code_cm ? cmCode(c.code_cm, c.cm_label) : null),
            h(
              "div",
              { class: "mut" },
              `${c.set_name} · ${c.numero}${c.confiance === "probable" ? " · full art probable" : ""}`,
            ),
            c.cm_url ? cmLink(c.cm_url, c.cm_label) : null,
          ),
          h(
            "div",
            { class: "pr" },
            h("div", { class: "price" }, eur(c.price?.trend)),
            h("div", { class: "mut" }, `bas ${eur(c.price?.low)}`),
          ),
          mine
            ? h("span", { class: "badge" }, "La mienne")
            : h(
                "button",
                {
                  type: "button",
                  onclick: (e: Event) => {
                    action(e.currentTarget as HTMLButtonElement, async () => {
                      await api(`/api/species/${s.num}/owned`, { method: "PUT", json: { card_id: c.id } });
                      toast(`${s.nom_fr} ajouté au binder.`);
                      await reload();
                    });
                  },
                },
                "Je l'ai",
              ),
        ),
      );
    }
  }
  const other = h("details", {}, h("summary", {}, "Ma carte n'est pas dans la liste"));
  for (const t of TIERS)
    other.append(
      h(
        "button",
        {
          type: "button",
          onclick: (e: Event) => {
            action(e.currentTarget as HTMLButtonElement, async () => {
              await api(`/api/species/${s.num}/owned`, { method: "PUT", json: { tier: t } });
              await reload();
            });
          },
        },
        `J'ai une ${TIER_LABEL[t]}`,
      ),
    );
  kids.push(other);
  if (s.owned)
    kids.push(
      h(
        "button",
        {
          type: "button",
          class: "danger",
          onclick: (e: Event) => {
            action(e.currentTarget as HTMLButtonElement, async () => {
              if (!confirm(`Retirer ${s.nom_fr} du binder ?`)) return;
              await api(`/api/species/${s.num}/owned`, { method: "DELETE" });
              await reload();
            });
          },
        },
        "Retirer du binder",
      ),
    );
  box.replaceChildren(...kids);
}

async function settingsState(): Promise<void> {
  const st = (await (await api("/api/cardmarket")).json()) as { linked: boolean; updated_at: string | null };
  $("cm-state").textContent = st.linked ? `Lié (mis à jour le ${st.updated_at?.slice(0, 10)})` : "Non lié";
}

function bind(): void {
  const st = readState();
  $as("q", HTMLInputElement).value = st.q;
  $as("filter", HTMLSelectElement).value = st.f;
  const onFilter = () => {
    writeState();
    render();
  };
  $("q").addEventListener("input", debounce(onFilter, 120));
  $("filter").addEventListener("change", onFilter);
  $("grid").addEventListener("click", (e) => {
    const t = (e.target as HTMLElement).closest<HTMLElement>("[data-num]");
    if (t) void openDetail(Number(t.dataset.num));
  });
  document.addEventListener("click", (e) => {
    const t = e.target as HTMLElement;
    if (t.matches("[data-close]")) t.closest("dialog")?.close();
  });
  $("detail").addEventListener("close", () => detailAbort?.abort());
  $("btn-settings").addEventListener("click", () => {
    void settingsState().catch(() => undefined);
    $as("settings", HTMLDialogElement).showModal();
  });
  $("btn-buy").addEventListener("click", () => {
    $as("buy", HTMLDialogElement).showModal();
    void renderBuylist().catch(() => undefined);
  });
  $("btn-buylist").addEventListener("click", (e) => {
    action(e.currentTarget as HTMLButtonElement, renderBuylist);
  });

  $("btn-wants").addEventListener("click", (e) => {
    action(e.currentTarget as HTMLButtonElement, async () => {
      const t = await (
        await api(`/api/wants?tier=${encodeURIComponent($as("wants-tier", HTMLSelectElement).value)}`)
      ).text();
      await navigator.clipboard.writeText(t);
      toast(`${t ? t.split("\n").length : 0} lignes copiées dans le presse-papiers.`);
    });
  });
  $("btn-export").addEventListener("click", (e) => {
    action(e.currentTarget as HTMLButtonElement, async () => {
      const url = URL.createObjectURL(await (await api("/api/export")).blob());
      h("a", { href: url, download: `pokedex-${new Date().toISOString().slice(0, 10)}.json` }).click();
      setTimeout(() => {
        URL.revokeObjectURL(url);
      }, 1000);
    });
  });
  $as("file-import", HTMLInputElement).addEventListener("change", (e) => {
    action(null, async () => {
      const input = e.target as HTMLInputElement;
      const file = input.files?.[0];
      input.value = "";
      if (!file || !confirm("L'import remplace tout le binder actuel. Continuer ?")) return;
      const r = (await (await api("/api/import", { method: "POST", json: JSON.parse(await file.text()) })).json()) as {
        owned: number;
      };
      toast(`${r.owned} espèces importées.`);
      await load();
    });
  });
  $as("cm-form", HTMLFormElement).addEventListener("submit", (e) => {
    e.preventDefault();
    const form = e.currentTarget as HTMLFormElement;
    action(form.querySelector("button[type=submit]"), async () => {
      await api("/api/cardmarket", { method: "PUT", json: Object.fromEntries(new FormData(form)) });
      form.reset();
      toast("Compte Cardmarket lié (clés chiffrées).");
      await settingsState();
    });
  });
  $("cm-test").addEventListener("click", (e) => {
    action(e.currentTarget as HTMLButtonElement, async () => {
      const r = (await (await api("/api/cardmarket/test", { method: "POST" })).json()) as {
        status: number;
        username: string | null;
      };
      toast(
        r.status === 200 ? `Connecté : ${r.username ?? "?"}` : `Cardmarket a répondu ${r.status}`,
        r.status === 200 ? "ok" : "err",
      );
    });
  });
  $("cm-unlink").addEventListener("click", (e) => {
    action(e.currentTarget as HTMLButtonElement, async () => {
      if (!confirm("Supprimer les clés Cardmarket ?")) return;
      await api("/api/cardmarket", { method: "DELETE" });
      await settingsState();
    });
  });
}

bind();
load().catch((e: unknown) => {
  $("progress").textContent = `Erreur de chargement : ${e instanceof Error ? e.message : "inconnue"}`;
});
