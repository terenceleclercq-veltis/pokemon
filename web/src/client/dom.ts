// Construction DOM sûre : textContent uniquement (compatible Trusted Types, pas d'injection HTML).
type Child = Node | string | null | undefined | false;
type Props = Record<string, string | number | boolean | EventListener | undefined>;

const ATTRS = new Set([
  "id",
  "role",
  "type",
  "alt",
  "src",
  "href",
  "target",
  "rel",
  "download",
  "loading",
  "width",
  "height",
  "title",
  "value",
  "decoding",
]);
const SAFE_URL = /^(https:|blob:|\/(?!\/))/; // ni javascript:, ni data:, ni //hôte

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Props = {},
  ...kids: Child[]
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v === undefined || v === false) continue;
    if (typeof v === "function") e.addEventListener(k.replace(/^on/, ""), v);
    else if (k === "class") e.className = String(v);
    else if ((k === "href" || k === "src") && !SAFE_URL.test(String(v))) throw new Error(`URL refusée : ${k}`);
    else if (k.startsWith("data-") || k.startsWith("aria-") || ATTRS.has(k))
      e.setAttribute(k, v === true ? "" : String(v));
    else throw new Error(`attribut non autorisé : ${k}`);
  }
  for (const k of kids) if (k !== null && k !== undefined && k !== false) e.append(k);
  return e;
}

export function $(id: string): HTMLElement {
  const e = document.getElementById(id);
  if (!e) throw new Error(`#${id} introuvable`);
  return e;
}

/** Élément typé, vérifié à l'exécution (pas de cast aveugle). */
export function $as<T extends HTMLElement>(id: string, ctor: new () => T): T {
  const e = $(id);
  if (!(e instanceof ctor)) throw new Error(`#${id} n'est pas un ${ctor.name}`);
  return e;
}

const fmt = new Intl.NumberFormat("fr-BE", { style: "currency", currency: "EUR" });
export const eur = (v: number | null | undefined) => (v == null ? "n/d" : fmt.format(v));
export const pad = (n: number) => `#${String(n).padStart(3, "0")}`;

export function toast(msg: string, kind: "ok" | "err" = "ok"): void {
  const t = h("div", { class: `toast ${kind}`, role: kind === "err" ? "alert" : "status" }, msg);
  $("toasts").append(t);
  setTimeout(() => {
    t.remove();
  }, 5000);
}

export function debounce<A extends unknown[]>(fn: (...a: A) => void, ms: number) {
  let t: ReturnType<typeof setTimeout> | undefined;
  return (...a: A) => {
    clearTimeout(t);
    t = setTimeout(() => {
      fn(...a);
    }, ms);
  };
}
