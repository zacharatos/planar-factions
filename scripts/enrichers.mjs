// Journal buttons, for prep notes (any journal page, Planar Codex notes included):
//   @Faction[athar]{label}                 a chip: the faction's name, the party's attitude and renown (GM), click to open
//   @Renown[athar +2]{assigned mission}    GM button: +2 renown for the party; @Renown[athar +1 Lothrik] for one hero
//   @Attitude[harmonium hostile]{reason}   GM button: set the faction's attitude (hostile / indifferent / friendly)
//   @Debt[shemeshka Nanouk w2]{what}       GM button: add "the heroes owe …" to the ledger (once); then shows its status
//   @Favour[ring-givers]{what}             the same for "… owes the heroes"
//   @Ledger[entry-id]{label}               a chip for an existing entry (seeded entries by their pack id)
// Players never see the GM buttons; they see a faction chip or a ledger chip only once the players know about it.
import { MODULE_ID, PALETTE, ATTITUDE_ICON } from "./constants.mjs";
import { t, info, warn } from "./i18n.mjs";
import { escapeHTML as esc, parseRenown, parseAttitude, parseLedger, localText } from "./util.mjs";
import { state, defs, local, textLang, standingFor } from "./state.mjs";
import * as act from "./actions.mjs";

const PATTERN = /@(Faction|Renown|Attitude|Debt|Favour|Favor|Ledger)\[([^\]\n]+)\](?:\{([^}\n]*)\})?/g;

export function registerEnrichers() {
  CONFIG.TextEditor.enrichers.push({ id: MODULE_ID, pattern: PATTERN, enricher: enrich });
}

const el = (tag, cls, html, data = {}) => {
  const e = document.createElement(tag);
  e.className = cls;
  e.innerHTML = html;
  for (const [k, v] of Object.entries(data)) if (v != null) e.dataset[k] = String(v);
  return e;
};
const empty = () => el("span", "pf-ref pf-ref-hidden", "");
const plain = text => el("span", "pf-ref-text", esc(text ?? ""));
const unresolved = (raw, why) => game.user.isGM
  ? el("span", "pf-ref pf-ref-bad", `<i class="fa-solid fa-circle-exclamation"></i> ${esc(raw)}`, { tooltip: why })
  : plain("");

/** The key that marks a button as used: the page it sits on plus its exact text. */
const sourceKey = (match, options) => `${options?.relativeTo?.uuid ?? ""}#${match[0]}`;

async function enrich(match, options = {}) {
  try {
    const [, type, raw, label] = match;
    switch (type) {
      case "Faction": return factionChip(raw, label);
      case "Renown": return renownButton(raw, label, sourceKey(match, options));
      case "Attitude": return attitudeButton(raw, label, sourceKey(match, options));
      case "Debt": return ledgerButton("debt", raw, label, sourceKey(match, options));
      case "Favour":
      case "Favor": return ledgerButton("favour", raw, label, sourceKey(match, options));
      case "Ledger": return ledgerChip(raw, label);
    }
  } catch (err) { console.warn(`${MODULE_ID} | enricher`, err); }
  return plain(match[0]);
}

function colorOf(def) {
  const all = defs().factions;
  return def.color || PALETTE[Math.max(0, all.findIndex(f => f.id === def.id)) % PALETTE.length];
}

function factionChip(raw, label) {
  const def = act.resolveFaction(raw);
  if (!def) return unresolved(raw, t("Enricher.NoFaction"));
  const s = standingFor(def);
  const name = label || local(def.name);
  if (!game.user.isGM && !s.known) return plain(name);
  const extra = game.user.isGM ? ` <span class="pf-score">${s.party}</span>` : "";
  return el("a", "pf-ref pf-ref-faction", `<span class="pf-swatch" style="background:${esc(colorOf(def))}"></span>${esc(name)} <i class="fa-solid ${ATTITUDE_ICON[s.attitude]} a-${s.attitude}"></i>${extra}`,
    { pf: "faction", faction: def.id, tooltip: t(`Attitude.${s.attitude}`) });
}

function heroTarget(who) {
  if (!who) return { target: "party", name: t("Common.Party") };
  const { ids, missing } = act.resolveHeroes([who]);
  if (missing.length || !ids.length) return null;
  return { target: ids[0], name: game.actors.get(ids[0])?.name ?? who };
}

function renownButton(raw, label, source) {
  if (!game.user.isGM) return empty();
  const p = parseRenown(raw);
  if (!p) return unresolved(raw, t("Enricher.BadRenown"));
  const def = act.resolveFaction(p.target);
  if (!def) return unresolved(raw, t("Enricher.NoFaction"));
  const who = heroTarget(p.who);
  if (!who) return unresolved(raw, t("Enricher.NoHero", { name: p.who }));
  const used = state().history.find(h => h.source === source);
  const text = t("Enricher.Renown", { delta: p.delta > 0 ? `+${p.delta}` : p.delta, faction: local(def.name), who: who.name });
  return el("a", `pf-ref pf-ref-btn ${used ? "used" : ""}`, `<i class="fa-solid ${used ? "fa-check" : "fa-landmark-flag"}"></i> ${esc(text)}${label ? ` <small>· ${esc(label)}</small>` : ""}`,
    { pf: "renown", faction: def.id, target: who.target, delta: p.delta, reason: label ?? "", source, tooltip: used ? t("Enricher.Used", { date: String(used.date).slice(0, 10) }) : t("Enricher.Click") });
}

function attitudeButton(raw, label, source) {
  if (!game.user.isGM) return empty();
  const p = parseAttitude(raw);
  if (!p) return unresolved(raw, t("Enricher.BadAttitude"));
  const def = act.resolveFaction(p.target);
  if (!def) return unresolved(raw, t("Enricher.NoFaction"));
  const used = state().history.find(h => h.source === source);
  const text = t("Enricher.Attitude", { faction: local(def.name), attitude: t(`Attitude.${p.attitude}`) });
  return el("a", `pf-ref pf-ref-btn ${used ? "used" : ""}`, `<i class="fa-solid ${used ? "fa-check" : ATTITUDE_ICON[p.attitude]}"></i> ${esc(text)}${label ? ` <small>· ${esc(label)}</small>` : ""}`,
    { pf: "attitude", faction: def.id, attitude: p.attitude, reason: label ?? "", source, tooltip: used ? t("Enricher.Used", { date: String(used.date).slice(0, 10) }) : t("Enricher.Click") });
}

function entryChip(e, label) {
  const lang = textLang();
  const what = label || localText(e.what, lang);
  if (!game.user.isGM && !e.known) return plain("");
  return el("a", `pf-ref pf-ref-entry k-${e.kind} s-${e.status}`, `<i class="fa-solid fa-scale-balanced"></i> ${esc(what)} <span class="pf-status s-${e.status}">${esc(t(`Status.${e.status}`))}</span>`,
    { pf: "entry", entry: e.id, tooltip: t(e.kind === "debt" ? "Kind.debtLong" : "Kind.favourLong") });
}

function ledgerButton(kind, raw, label, source) {
  const existing = state().ledger.find(e => e.source === source);
  if (existing) return entryChip(existing, null);
  if (!game.user.isGM) return empty();
  const p = parseLedger(raw);
  if (!p) return unresolved(raw, t("Enricher.BadLedger"));
  const withData = act.resolveWith(p.target);
  const { ids, missing } = act.resolveHeroes(p.who ?? []);
  if (missing.length) return unresolved(raw, t("Enricher.NoHero", { name: missing.join(", ") }));
  const withName = withData.faction ? local(defs().factions.find(f => f.id === withData.faction)?.name)
    : withData.contact ? local(state().contacts.find(c => c.id === withData.contact)?.name) : withData.name;
  const text = t(kind === "debt" ? "Enricher.Debt" : "Enricher.Favour", { with: withName });
  return el("a", "pf-ref pf-ref-btn", `<i class="fa-solid fa-scale-balanced"></i> ${esc(text)}${label ? `: ${esc(label)}` : ""}`,
    { pf: "ledger", kind, with: JSON.stringify(withData), who: JSON.stringify(ids), weight: p.weight ?? 1, what: label ?? "", source, tooltip: t("Enricher.ClickLedger") });
}

function ledgerChip(raw, label) {
  const id = raw.trim();
  const e = state().ledger.find(x => x.id === id || x.id === `seed-${id}` || x.seed === id);
  if (!e) return unresolved(raw, t("Enricher.NoEntry"));
  return entryChip(e, label);
}

/* ---------------- clicks (one listener for every page) ---------------- */

export function registerClicks() {
  document.addEventListener("click", ev => {
    const a = ev.target.closest?.("a.pf-ref[data-pf]");
    if (!a) return;
    ev.preventDefault();
    ev.stopPropagation();
    onClick(a).catch(err => { console.warn(`${MODULE_ID} |`, err); ui.notifications.warn(err.message); });
  }, true);
}

async function confirmed(text) {
  return foundry.applications.api.DialogV2.confirm({ window: { title: t("Enricher.ConfirmTitle") }, content: `<p>${esc(text)}</p>` });
}

async function onClick(a) {
  const d = a.dataset;
  const gm = game.user.isGM;
  switch (d.pf) {
    case "faction": {
      if (gm) { const { FactionsConsole } = await import("./console.mjs"); FactionsConsole.open({ faction: d.faction }); }
      else { const { StandingWindow } = await import("./standing.mjs"); StandingWindow.open({ faction: d.faction }); }
      return;
    }
    case "entry": {
      if (gm) { const { FactionsConsole } = await import("./console.mjs"); FactionsConsole.open({ entry: d.entry }); }
      else { const { StandingWindow } = await import("./standing.mjs"); StandingWindow.open({ tab: "ledger" }); }
      return;
    }
  }
  if (!gm) return;
  const usedText = a.classList.contains("used") ? `${t("Enricher.Again")} ` : "";
  if (d.pf === "renown") {
    if (!await confirmed(usedText + a.textContent.trim())) return;
    await act.renown(d.faction, d.target, Number(d.delta), { reason: d.reason, source: d.source });
    markUsed(a);
  } else if (d.pf === "attitude") {
    if (!await confirmed(usedText + a.textContent.trim())) return;
    await act.attitude(d.faction, d.attitude, { reason: d.reason, source: d.source });
    markUsed(a);
  } else if (d.pf === "ledger") {
    if (state().ledger.some(e => e.source === d.source)) return warn("Enricher.AlreadyAdded");
    const known = await foundry.applications.api.DialogV2.wait({
      window: { title: t("Enricher.ConfirmTitle") },
      content: `<p>${esc(a.textContent.trim())}</p><p class="pf-hint">${esc(t("Enricher.KnownQuestion"))}</p>`,
      buttons: [
        { action: "known", label: t("Enricher.AddKnown"), icon: "fa-solid fa-eye", default: true },
        { action: "secret", label: t("Enricher.AddSecret"), icon: "fa-solid fa-eye-slash" },
        { action: "cancel", label: t("Enricher.Cancel") }
      ],
      rejectClose: false
    }).catch(() => null);
    if (!known || known === "cancel") return;
    const e = await act.entryAdd({
      kind: d.kind, with: JSON.parse(d.with), who: JSON.parse(d.who), weight: Number(d.weight) || 1,
      what: d.what || a.textContent.trim(), known: known === "known", source: d.source
    }, { source: d.source });
    a.replaceWith(entryChip(e, null));
    info("Notify.EntryAdded");
  }
}

function markUsed(a) {
  a.classList.add("used");
  const icon = a.querySelector("i");
  if (icon) icon.className = "fa-solid fa-check";
  a.dataset.tooltip = t("Enricher.Used", { date: new Date().toISOString().slice(0, 10) });
}
