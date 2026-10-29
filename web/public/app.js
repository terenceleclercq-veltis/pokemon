"use strict";
const $ = (id) => document.getElementById(id);
const H = { "Content-Type": "application/json", "X-Requested-With": "pokedex" };
const STATUS = { manquante: "Manquante", a_verifier: "À vérifier", complete: "Complète", choisie: "Choix conservé" };
const eur = (v) => (v == null ? "n/d" : v.toFixed(2).replace(".", ",") + " €");
let data = [];

function el(tag, props = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) k === "class" ? (e.className = v) : k.startsWith("on") ? e.addEventListener(k.slice(2), v) : e.setAttribute(k, v);
  for (const k of kids) e.append(k);
  return e;
}
async function api(path, opts = {}) {
  const r = await fetch(path, { ...opts, headers: { ...H, ...(opts.headers || {}) } });
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || r.statusText);
  return r;
}
async function load() { data = await (await api("/api/pokedex")).json(); render(); }

function render() {
  const q = $("q").value.trim().toLowerCase(), f = $("filter").value;
  const done = data.filter((s) => s.status === "complete" || s.status === "choisie").length;
  $("progress").textContent = `${done} / 151 complètes · ${data.filter((s) => s.status === "a_verifier").length} à vérifier · ${data.filter((s) => s.no_card).length} sans full art FR`;
  $("bar-fill").style.width = `${(done / 151) * 100}%`;
  const grid = $("grid"); grid.replaceChildren();
  for (const s of data) {
    if (q && !(s.nom_fr.toLowerCase().includes(q) || String(s.num) === q)) continue;
    if (f === "none" ? !s.no_card : f !== "all" && s.status !== f) continue;
    const cheapest = s.options.map((o) => o.price?.trend).filter((v) => v != null).sort((a, b) => a - b)[0];
    const t = el("button", { class: `tile ${s.no_card ? "" : s.status}`, role: "listitem", onclick: () => openDetail(s.num) },
      el("div", { class: "n" }, `#${String(s.num).padStart(3, "0")}`), el("strong", {}, s.nom_fr),
      el("div", { class: "p" }, s.no_card ? "Aucune full art FR" : s.status === "manquante" ? `dès ${eur(cheapest)}` : STATUS[s.status]));
    grid.append(t);
  }
}

async function openDetail(num) {
  const s = data.find((x) => x.num === num), box = $("detail-body");
  box.replaceChildren(el("h2", {}, `#${String(num).padStart(3, "0")} ${s.nom_fr}`), el("p", { class: "mut" }, "Prix en direct…"));
  $("detail").showModal();
  let live = {};
  try { live = await (await api(`/api/species/${num}/prices`)).json(); } catch { /* garde les prix en cache */ }
  for (const c of s.cards) if (live[c.id]) c.price = { ...c.price, ...live[c.id] };
  paint(s);
}
function paint(s) {
  const box = $("detail-body"); box.replaceChildren(el("h2", {}, `#${String(s.num).padStart(3, "0")} ${s.nom_fr}`));
  box.append(el("p", {}, s.owned ? `Possédée : ${s.owned.tier}${s.owned.card_id ? "" : " (autre carte)"}` : "Pas encore dans le binder."));
  if (s.status === "a_verifier") {
    box.append(el("p", { class: "warn" }, "Une version plus rare existe. "),
      el("button", { onclick: async () => { await api(`/api/species/${s.num}/keep`, { method: "PUT", body: "{}" }); await load(); openDetail(s.num); } }, "Je préfère la mienne (ne plus vérifier)"));
  }
  if (s.status === "choisie") box.append(el("p", { class: "mut" }, "Choix conservé : plus de vérification. "),
    el("button", { onclick: async () => { await api(`/api/species/${s.num}/keep`, { method: "DELETE" }); await load(); openDetail(s.num); } }, "Reprendre la vérification"));
  if (s.no_card) box.append(el("p", {}, "Aucune carte full art française connue pour cette espèce."));
  const tiers = { FA: "Full art", IR: "Illustration Rare", SIR: "Special Illustration Rare" };
  for (const tier of ["FA", "IR", "SIR"]) {
    const cs = s.cards.filter((c) => c.tier === tier).sort((a, b) => (a.price?.trend ?? 1e9) - (b.price?.trend ?? 1e9));
    if (!cs.length) continue;
    box.append(el("h3", {}, tiers[tier]));
    for (const c of cs) {
      const img = c.image || c.price?.image;
      box.append(el("div", { class: "opt" }, img ? el("img", { src: img, alt: "", loading: "lazy" }) : el("span"),
        el("div", { class: "grow" }, el("div", {}, c.nom_fr), el("div", { class: "mut" }, `${c.set_name} · ${c.numero}${c.confiance === "probable" ? " · full art probable" : ""}`)),
        el("div", {}, el("div", { class: "price" }, eur(c.price?.trend)), el("div", { class: "mut" }, `bas ${eur(c.price?.low)}`)),
        el("button", { onclick: async () => { await api(`/api/species/${s.num}/owned`, { method: "PUT", body: JSON.stringify({ card_id: c.id }) }); await load(); $("detail").close(); } }, "Je l'ai")));
    }
  }
  if (s.owned) box.append(el("button", { onclick: async () => { if (confirm("Retirer cette espèce du binder ?")) { await api(`/api/species/${s.num}/owned`, { method: "DELETE" }); await load(); $("detail").close(); } } }, "Retirer"));
  else if (s.no_card || true) box.append(el("p", { class: "mut" }, "Carte absente du catalogue ?"), ...["FA", "IR", "SIR"].map((t) => el("button", { onclick: async () => { await api(`/api/species/${s.num}/owned`, { method: "PUT", body: JSON.stringify({ tier: t }) }); await load(); $("detail").close(); } }, `J'ai une ${t}`)));
}

async function settingsState() {
  const st = await (await api("/api/cardmarket")).json();
  $("cm-state").textContent = st.linked ? `Lié (mis à jour ${st.updated_at.slice(0, 10)})` : "Non lié";
}
document.addEventListener("click", (e) => { if (e.target.matches("[data-close]")) e.target.closest("dialog").close(); });
$("q").addEventListener("input", render); $("filter").addEventListener("change", render);
$("btn-refresh").addEventListener("click", async (e) => { e.target.disabled = true; await api("/api/prices/refresh", { method: "POST" }).catch(() => {}); setTimeout(() => { load(); e.target.disabled = false; }, 8000); });
$("btn-settings").addEventListener("click", () => { settingsState().catch(() => {}); $("settings").showModal(); });
$("btn-wants").addEventListener("click", async () => { const t = await (await api(`/api/wants?tier=${$("wants-tier").value}`)).text(); await navigator.clipboard.writeText(t); $("wants-msg").textContent = `${t ? t.split("\n").length : 0} lignes copiées`; });
$("btn-export").addEventListener("click", async () => { const b = await (await api("/api/export")).blob(); const a = el("a", { href: URL.createObjectURL(b), download: "pokedex-export.json" }); a.click(); URL.revokeObjectURL(a.href); });
$("file-import").addEventListener("change", async (e) => { try { const r = await (await api("/api/import", { method: "POST", body: await e.target.files[0].text() })).json(); $("io-msg").textContent = `${r.lignes} lignes importées`; load(); } catch (x) { $("io-msg").textContent = x.message; } });
$("cm-form").addEventListener("submit", async (e) => { e.preventDefault(); try { await api("/api/cardmarket", { method: "PUT", body: JSON.stringify(Object.fromEntries(new FormData(e.target))) }); e.target.reset(); $("cm-msg").textContent = "Lié."; settingsState(); } catch (x) { $("cm-msg").textContent = x.message; } });
$("cm-test").addEventListener("click", async () => { try { const r = await (await api("/api/cardmarket/test", { method: "POST" })).json(); $("cm-msg").textContent = r.status === 200 ? `Connecté : ${r.username}` : `Réponse Cardmarket ${r.status}`; } catch (x) { $("cm-msg").textContent = x.message; } });
$("cm-unlink").addEventListener("click", async () => { await api("/api/cardmarket", { method: "DELETE" }); settingsState(); });
load().catch((e) => { $("progress").textContent = "Erreur : " + e.message; });
