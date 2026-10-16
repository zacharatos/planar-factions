// What the GM does, as one call each: used by the console, the journal buttons and the macro API.
// Every change goes through mutate() (GM only, one at a time) and lands in the history.
import { MODULE_ID } from "./constants.mjs";
import { t, info } from "./i18n.mjs";
import { setting } from "./settings.mjs";
import {
  changeRenown, setRenown, setAttitude, setKnown, setMember, setNotes, addContact, updateContact, removeContact,
  addEntry, updateEntry, setEntryStatus, removeEntry, addCustomFaction, removeCustomFaction,
  findFaction, findContact, findHero, withLabel, missionsOf, escapeHTML as esc, localText
} from "./util.mjs";
import { mutate, ctx, defs, factionDef, state, heroes, local, textLang } from "./state.mjs";

const need = id => {
  const def = typeof id === "object" ? id : factionDef(id);
  if (!def) throw new Error(t("Notify.NoFaction", { id: String(id) }));
  return def;
};
const heroName = target => (target === "party" ? "" : game.actors.get(target)?.name ?? "?");
const targetLabel = target => (target === "party" ? t("Common.Party") : heroName(target));

/* ---------------- chat ---------------- */

async function post(html, { publicMsg = false } = {}) {
  const mode = setting("announce");
  if (mode === "off") return null;
  const toAll = publicMsg && mode === "players";
  return ChatMessage.create({
    content: `<div class="planar-factions-card">${html}</div>`,
    speaker: { alias: t("Chat.Speaker") },
    whisper: toAll ? [] : game.users.filter(u => u.isGM).map(u => u.id)
  });
}

function announceRenown(def, target, res, reason) {
  const name = local(def.name);
  const known = state().factions[def.id]?.known ?? def.known;
  const delta = res.after - res.before;
  if (!delta) return;
  const line = t(delta > 0 ? "Chat.RenownUp" : "Chat.RenownDown", { who: targetLabel(target), faction: name, from: res.before, to: res.after });
  info("Notify.Renown", { who: targetLabel(target), faction: name, from: res.before, to: res.after });
  let html = `<p><i class="fa-solid fa-landmark-flag"></i> ${esc(line)}</p>${reason ? `<p class="pf-reason">${esc(reason)}</p>` : ""}`;
  const isMember = target !== "party" && !!state().factions[def.id]?.heroes?.[target]?.member;
  if (res.rankUp && isMember) html += `<p class="pf-rank"><i class="fa-solid fa-award"></i> ${esc(t("Chat.RankUp", { who: targetLabel(target), rank: local(res.rankUp.name) }))}</p>`;
  if (res.recognizedNow) html += `<p class="pf-rank"><i class="fa-solid fa-handshake"></i> ${esc(t("Chat.Recognized", { who: targetLabel(target), faction: name }))}</p>`;
  post(html, { publicMsg: known });
}

/* ---------------- factions ---------------- */

/** Add (or with a negative delta, remove) renown. target: "party" or an actor id. */
export async function renown(factionId, target, delta, { reason = "", source = "" } = {}) {
  const def = need(factionId);
  const res = await mutate((s, d) => changeRenown(s, def, target, delta, ctx({ reason, source, heroName: heroName(target), defs: d })));
  announceRenown(def, target, res, reason);
  return res;
}

export async function renownTo(factionId, target, value, { reason = "" } = {}) {
  const def = need(factionId);
  const res = await mutate((s, d) => setRenown(s, def, target, value, ctx({ reason, heroName: heroName(target), defs: d })));
  announceRenown(def, target, res, reason);
  return res;
}

export async function attitude(factionId, value, { reason = "", source = "" } = {}) {
  const def = need(factionId);
  const entry = await mutate(s => setAttitude(s, def, value, ctx({ reason, source })));
  if (entry) {
    const known = state().factions[def.id]?.known;
    info("Notify.Attitude", { faction: local(def.name), attitude: t(`Attitude.${value}`) });
    post(`<p><i class="fa-solid fa-people-group"></i> ${esc(t("Chat.Attitude", { faction: local(def.name), attitude: t(`Attitude.${value}`) }))}</p>${reason ? `<p class="pf-reason">${esc(reason)}</p>` : ""}`, { publicMsg: known });
  }
  return entry;
}

export const reveal = (factionId, known = true) => mutate(s => setKnown(s, need(factionId), known, ctx()));
export const member = (factionId, actorId, on = true, { reason = "" } = {}) => mutate(s => setMember(s, need(factionId), actorId, on, ctx({ reason, heroName: heroName(actorId) })));
export const notes = (factionId, text) => mutate(s => setNotes(s, need(factionId), text));

export const addFaction = data => mutate((s, d) => addCustomFaction(s, data, d.factions.map(f => f.id)));
export const deleteFaction = id => mutate(s => removeCustomFaction(s, id));

/** Roll on the faction's mission table (or the pack's), whispered to the GM. */
export async function rollMission(factionId) {
  const def = factionId ? need(factionId) : null;
  const list = missionsOf(def, defs());
  if (!list.length) return null;
  const roll = await new Roll(`1d${list.length}`).evaluate();
  const mission = list[roll.total - 1];
  const head = def ? t("Chat.MissionFor", { faction: local(def.name) }) : t("Chat.Mission");
  await roll.toMessage({
    speaker: { alias: t("Chat.Speaker") },
    flavor: `<div class="planar-factions-card"><p><strong>${esc(head)}</strong></p><p>${esc(local(mission.text))}</p></div>`,
    whisper: game.users.filter(u => u.isGM).map(u => u.id)
  });
  return mission;
}

/* ---------------- contacts ---------------- */

export const contactAdd = data => mutate(s => addContact(s, data, ctx()));
export const contactUpdate = (id, patch) => mutate(s => updateContact(s, id, patch));
export const contactDelete = id => mutate(s => removeContact(s, id));

/* ---------------- ledger ---------------- */

export const entryAdd = (data, extra = {}) => mutate(s => addEntry(s, data, ctx(extra)));
export const entryUpdate = (id, patch) => mutate(s => updateEntry(s, id, patch));
export const entryDelete = id => mutate(s => removeEntry(s, id));

/** Change an entry's status. "called" posts to chat (publicly if the players know about it). */
export async function entryStatus(id, status, { reason = "" } = {}) {
  const h = await mutate(s => setEntryStatus(s, id, status, ctx({ reason })));
  if (!h) return h;
  const st = state();
  const e = st.ledger.find(x => x.id === id);
  if (e) {
    const lang = textLang();
    const withName = withLabel(e, defs(), st, lang);
    const key = status === "called" ? (e.kind === "debt" ? "Chat.CalledDebt" : "Chat.CalledFavour") : `Chat.Status.${status}`;
    post(`<p><i class="fa-solid fa-scale-balanced"></i> ${esc(t(key, { with: withName }))}</p><p class="pf-what">${esc(localText(e.what, lang))}</p>`, { publicMsg: e.known });
  }
  return h;
}

/* ---------------- resolving names typed in journal buttons ---------------- */

/** "athar" / "Αθαρ" / "Bleak Cabal" -> a faction definition, or null. */
export const resolveFaction = token => findFaction(defs().factions, token);

/** A ledger counterparty from a token: a faction, a contact, or just a name. */
export function resolveWith(token) {
  const f = findFaction(defs().factions, token);
  if (f) return { faction: f.id };
  const c = findContact(state().contacts, token);
  if (c) return { contact: c.id };
  return { name: String(token ?? "").replace(/_/g, " ") };
}

/** Hero tokens -> actor ids; unknown names are reported. */
export function resolveHeroes(tokens) {
  const list = heroes();
  const ids = [], missing = [];
  for (const tk of tokens ?? []) {
    const h = findHero(list, tk);
    if (h) ids.push(h.id);
    else if (!["party", "all"].includes(String(tk).toLowerCase())) missing.push(tk);
  }
  return { ids: [...new Set(ids)], missing };
}

export { MODULE_ID };
