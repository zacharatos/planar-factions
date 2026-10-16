// Pure rules and helpers. No Foundry globals here: everything is unit-tested in tests/util.test.mjs.
//
// The model:
//   pack      what the factions ARE (names, ranks, perks, allies/rivals, missions; seeds for contacts and the ledger).
//             The module ships a generic pack (data/default-pack.json, no factions); a campaign imports its own.
//   state     what the heroes have DONE with them: per faction an attitude toward the party, the party's renown,
//             each hero's renown and membership, and whether the players know the faction; plus contacts,
//             the ledger of debts and favours, and a history of every change.
// Renown follows the optional rule in the 2024 Dungeon Master's Guide (Ch. 3, Renown): a score that never drops
// below 0, recognition at 3+, ranks and perks at thresholds the pack sets.

export const PACK_SCHEMA = 1;
export const STATE_SCHEMA = 1;

export const ATTITUDES = ["hostile", "indifferent", "friendly"];
/** debt: the heroes owe someone. favour: someone owes the heroes. */
export const LEDGER_KINDS = ["debt", "favour"];
export const LEDGER_STATUS = ["open", "called", "paid", "broken", "forgiven"];
export const OPEN_LEDGER = ["open", "called"];
export const WEIGHTS = [1, 2, 3];
export const TRACK_MODES = ["both", "party", "heroes"];
export const FACTION_KINDS = ["faction", "minor", "power", "other"];
export const HISTORY_CAP = 400;

/** Renown awards from the DMG (Gaining Renown), as quick buttons. */
export const AWARDS = [
  { key: "interests", delta: 1 },
  { key: "mission", delta: 2 },
  { key: "great", delta: 3 },
  { key: "offense", delta: -1 }
];

/** DMG Level-Based Renown: [character level, renown score]. */
export const LEVEL_RENOWN = [[1, 1], [3, 3], [5, 10], [11, 25], [17, 50]];
/** DMG Recognition: members are Friendly toward a character with this much renown. */
export const RECOGNITION = 3;

export function escapeHTML(s) {
  return String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

/** Text in the wanted language: plain strings pass through; {en, el} objects fall back to en, then anything. */
export function localText(value, lang = "en") {
  if (value == null) return "";
  if (typeof value === "string") return value;
  return value[lang] ?? value.en ?? Object.values(value).find(v => typeof v === "string") ?? "";
}

const isText = v => (typeof v === "string" && v.trim() !== "") || (v && typeof v === "object" && Object.values(v).some(x => typeof x === "string" && x.trim()));

/** Lower case, no accents, single spaces: "Ζοφερή  Σύναξη" matches "ζοφερη συναξη". */
export function fold(s) {
  return String(s ?? "").normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/[\s_]+/g, " ").trim();
}

/** A stable id from a name: "Bleak Cabal" -> "bleak-cabal". Non-Latin names keep their letters. */
export function slugify(s) {
  return fold(s).replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-+|-+$/g, "") || "x";
}

let counter = 0;
/** Fallback id (Foundry code passes foundry.utils.randomID). */
export const simpleId = () => `pf${Date.now().toString(36)}${(counter++).toString(36)}`;

export const clampRenown = n => Math.max(0, Math.round(Number(n) || 0));

/* ------------------------------------------------------------------ */
/* Renown rules                                                        */
/* ------------------------------------------------------------------ */

const byMin = list => [...(list ?? [])].filter(x => Number.isFinite(Number(x?.min))).sort((a, b) => a.min - b.min);

/** The highest rank whose threshold the score reaches, or null. */
export function rankFor(score, ranks) {
  let found = null;
  for (const r of byMin(ranks)) if (score >= r.min) found = r;
  return found;
}

/** The next rank above the score, or null. */
export function nextRank(score, ranks) {
  return byMin(ranks).find(r => r.min > score) ?? null;
}

/** Every perk the score has reached, lowest first. */
export function perksFor(score, perks) {
  return byMin(perks).filter(p => score >= p.min);
}

export const recognized = score => score >= RECOGNITION;

/** DMG Group Involvement: days of downtime for the next point (10 × current score), once the score is 1+. */
export const downtimeDays = score => (score >= 1 ? 10 * score : null);

/** DMG Level-Based Renown: the score a character of this level would have. */
export function levelRenown(level) {
  let out = 0;
  for (const [lvl, score] of LEVEL_RENOWN) if (level >= lvl) out = score;
  return out;
}

/* ------------------------------------------------------------------ */
/* Packs                                                               */
/* ------------------------------------------------------------------ */

function checkLadder(list, where, errors) {
  if (list === undefined) return;
  if (!Array.isArray(list)) return errors.push(`${where} must be a list`);
  for (const [i, r] of list.entries()) {
    if (!Number.isFinite(Number(r?.min)) || r.min < 0) errors.push(`${where}[${i}]: min must be a number 0 or more`);
    if (!isText(r?.name ?? r?.text)) errors.push(`${where}[${i}]: needs a name or text`);
  }
}

/** Problems with a pack, as readable lines. An empty list means it can be imported. */
export function validatePack(pack) {
  const errors = [];
  if (!pack || typeof pack !== "object" || Array.isArray(pack)) return ["not an object"];
  if (pack.schema !== PACK_SCHEMA) errors.push(`schema must be ${PACK_SCHEMA}`);
  if (typeof pack.id !== "string" || !pack.id) errors.push("id is missing");
  checkLadder(pack.ranks, "ranks", errors);
  checkLadder(pack.perks, "perks", errors);
  if (pack.factions !== undefined && !Array.isArray(pack.factions)) errors.push("factions must be a list");
  const ids = new Set();
  for (const [i, f] of (pack.factions ?? []).entries()) {
    const where = `factions[${i}]${f?.id ? ` (${f.id})` : ""}`;
    if (!f || typeof f !== "object") { errors.push(`${where}: not an object`); continue; }
    if (typeof f.id !== "string" || !/^[\p{L}\p{N}][\p{L}\p{N}-]*$/u.test(f.id)) errors.push(`${where}: id must be letters, digits and dashes`);
    else if (ids.has(f.id)) errors.push(`${where}: duplicate id`);
    ids.add(f.id);
    if (!isText(f.name)) errors.push(`${where}: name is missing`);
    if (f.kind !== undefined && !FACTION_KINDS.includes(f.kind)) errors.push(`${where}: kind must be one of ${FACTION_KINDS.join(", ")}`);
    if (f.attitude !== undefined && !ATTITUDES.includes(f.attitude)) errors.push(`${where}: attitude must be one of ${ATTITUDES.join(", ")}`);
    for (const k of ["allies", "rivals", "aliases"]) if (f[k] !== undefined && !Array.isArray(f[k])) errors.push(`${where}: ${k} must be a list`);
    checkLadder(f.ranks, `${where}.ranks`, errors);
    checkLadder(f.perks, `${where}.perks`, errors);
  }
  for (const [i, f] of (pack.factions ?? []).entries()) {
    for (const k of ["allies", "rivals"]) for (const other of f?.[k] ?? []) {
      if (!ids.has(other)) errors.push(`factions[${i}] (${f.id}): ${k} names unknown faction "${other}"`);
    }
  }
  for (const [i, m] of (pack.missions ?? []).entries()) if (!isText(m?.text)) errors.push(`missions[${i}]: text is missing`);
  const seedIds = new Set();
  for (const [i, c] of (pack.contacts ?? []).entries()) {
    if (typeof c?.id !== "string" || !c.id) errors.push(`contacts[${i}]: id is missing`);
    else if (seedIds.has(c.id)) errors.push(`contacts[${i}]: duplicate id ${c.id}`);
    seedIds.add(c.id);
    if (!isText(c?.name)) errors.push(`contacts[${i}]: name is missing`);
    if (c?.faction && !ids.has(c.faction)) errors.push(`contacts[${i}]: unknown faction "${c.faction}"`);
    if (c?.attitude !== undefined && !ATTITUDES.includes(c.attitude)) errors.push(`contacts[${i}]: bad attitude`);
  }
  for (const [i, e] of (pack.ledger ?? []).entries()) {
    if (typeof e?.id !== "string" || !e.id) errors.push(`ledger[${i}]: id is missing`);
    else if (seedIds.has(e.id)) errors.push(`ledger[${i}]: duplicate id ${e.id}`);
    seedIds.add(e.id);
    if (!LEDGER_KINDS.includes(e?.kind)) errors.push(`ledger[${i}]: kind must be debt or favour`);
    if (!isText(e?.what)) errors.push(`ledger[${i}]: what is missing`);
    if (!e?.with || !(e.with.faction || e.with.contact || isText(e.with.name))) errors.push(`ledger[${i}]: with needs a faction, a contact or a name`);
    if (e?.with?.faction && !ids.has(e.with.faction)) errors.push(`ledger[${i}]: unknown faction "${e.with.faction}"`);
    if (e?.who !== undefined && !Array.isArray(e.who)) errors.push(`ledger[${i}]: who must be a list of hero names`);
    if (e?.weight !== undefined && !WEIGHTS.includes(e.weight)) errors.push(`ledger[${i}]: weight must be 1, 2 or 3`);
    if (e?.status !== undefined && !LEDGER_STATUS.includes(e.status)) errors.push(`ledger[${i}]: bad status`);
  }
  return errors;
}

/** Fill in a faction definition's optional fields. */
export function normalizeFaction(f, source = "") {
  return {
    kind: "faction", group: null, epithet: null, motto: null, leader: null, base: null, plane: null,
    color: null, icon: null, img: null, notes: null, attitude: "indifferent", known: false,
    allies: [], rivals: [], aliases: [], ranks: null, perks: null, missions: null,
    ...f, source: f.source ?? source
  };
}

/**
 * The active definitions: the shipped pack, the imported pack on top, then the GM's own factions (made in the world).
 * Factions with the same id are replaced; ranks, perks and missions come from the pack unless it has none.
 */
export function mergePacks(base, pack, custom = []) {
  const factions = new Map();
  if (!pack?.replaceDefault) for (const f of base?.factions ?? []) factions.set(f.id, normalizeFaction(f, base.id));
  for (const f of pack?.factions ?? []) factions.set(f.id, normalizeFaction(f, pack.id));
  for (const f of custom ?? []) factions.set(f.id, normalizeFaction({ ...f, custom: true }, "custom"));
  const pick = key => (pack?.[key]?.length ? pack[key] : base?.[key] ?? []);
  return {
    id: pack?.id ?? base?.id ?? "default",
    name: pack?.name ?? base?.name ?? "",
    description: pack?.description ?? base?.description ?? "",
    groups: pack?.groups ?? base?.groups ?? [],
    ranks: byMin(pick("ranks")),
    perks: byMin(pick("perks")),
    missions: pick("missions"),
    factions: [...factions.values()],
    contacts: pack?.contacts ?? [],
    ledger: pack?.ledger ?? []
  };
}

export const ranksOf = (def, defs) => byMin(def?.ranks?.length ? def.ranks : defs.ranks);
export const perksOf = (def, defs) => byMin(def?.perks?.length ? def.perks : defs.perks);
export const missionsOf = (def, defs) => (def?.missions?.length ? def.missions : defs.missions) ?? [];

/* ------------------------------------------------------------------ */
/* Finding things by what the GM types                                 */
/* ------------------------------------------------------------------ */

/** fold() without a leading article: "οι Σταχτήδες" and "Σταχτήδες", "The Gloom" and "gloom" match. */
const bare = s => fold(s).replace(/^(the|οι|η|ο|το|τα) /, "");

/** Find a faction by id, alias, name or epithet (any language, accents and leading articles ignored). */
export function findFaction(factions, token) {
  const key = bare(token);
  if (!key) return null;
  const list = factions ?? [];
  const names = f => [f.id, ...(f.aliases ?? []), ...textsOf(f.name), ...textsOf(f.epithet)].map(bare);
  return list.find(f => bare(f.id) === key)
    ?? list.find(f => names(f).includes(key))
    ?? list.find(f => names(f).some(n => n.startsWith(key) && key.length >= 3))
    ?? null;
}

const textsOf = v => (v == null ? [] : typeof v === "string" ? [v] : Object.values(v).filter(x => typeof x === "string"));

/** Find a contact by id or name (full or first word). */
export function findContact(contacts, token) {
  const key = fold(token);
  if (!key) return null;
  const list = contacts ?? [];
  return list.find(c => fold(c.id) === key)
    ?? list.find(c => textsOf(c.name).some(n => fold(n) === key || fold(n).split(" ")[0] === key))
    ?? null;
}

/** Find a hero ({id, name}) by full name or first word. "party" and "all" mean nobody in particular. */
export function findHero(heroes, token) {
  const key = fold(token);
  if (!key || ["party", "all", "ομαδα", "ολοι"].includes(key)) return null;
  return (heroes ?? []).find(h => fold(h.name) === key)
    ?? (heroes ?? []).find(h => fold(h.name).split(" ")[0] === key)
    ?? (heroes ?? []).find(h => fold(h.name).startsWith(key) && key.length >= 3)
    ?? null;
}

/** Split an argument string into tokens; "double quotes" keep spaces. */
export function tokenize(raw) {
  const out = [];
  const re = /"([^"]*)"|(\S+)/g;
  let m;
  while ((m = re.exec(String(raw ?? "")))) out.push(m[1] ?? m[2]);
  return out;
}

const ATTITUDE_WORDS = {
  hostile: ["hostile", "εχθρικος", "εχθρικη", "εχθρικο", "-"],
  indifferent: ["indifferent", "αδιαφορος", "αδιαφορη", "αδιαφορο", "0"],
  friendly: ["friendly", "φιλικος", "φιλικη", "φιλικο", "+"]
};
export function parseAttitudeWord(word) {
  const w = fold(word);
  return Object.keys(ATTITUDE_WORDS).find(a => ATTITUDE_WORDS[a].includes(w)) ?? null;
}

/** "@Renown[athar +2 Lothrik]" -> { target: "athar", delta: 2, who: "Lothrik" }. who is null for the party. */
export function parseRenown(raw) {
  const tokens = tokenize(raw);
  const i = tokens.findIndex((tk, n) => n > 0 && /^[+-]?\d+$/.test(tk));
  if (i < 1) return null;
  const delta = Number(tokens[i]);
  if (!delta) return null;
  return { target: tokens.slice(0, i).join(" "), delta, who: tokens.slice(i + 1).join(" ") || null };
}

/** "@Attitude[harmonium hostile]" -> { target: "harmonium", attitude: "hostile" }. */
export function parseAttitude(raw) {
  const tokens = tokenize(raw);
  const i = tokens.findIndex((tk, n) => n > 0 && parseAttitudeWord(tk));
  if (i < 1) return null;
  return { target: tokens.slice(0, i).join(" "), attitude: parseAttitudeWord(tokens[i]) };
}

/**
 * "@Debt[shemeshka Nanouk w2]{passage to the Outlands}" -> { target: "shemeshka", who: "Nanouk", weight: 2 }.
 * The first token is who it's with (quote a name with spaces); the rest are heroes (none = the party);
 * w1..w3 sets the weight.
 */
export function parseLedger(raw) {
  const tokens = tokenize(raw);
  if (!tokens.length) return null;
  const [target, ...rest] = tokens;
  let weight = null;
  const who = [];
  for (const tk of rest) {
    const w = tk.match(/^w([1-3])$/i);
    if (w) weight = Number(w[1]);
    else who.push(tk);
  }
  return { target, who: who.length ? who : null, weight };
}

/* ------------------------------------------------------------------ */
/* State                                                               */
/* ------------------------------------------------------------------ */

export function emptyState() {
  return { schema: STATE_SCHEMA, factions: {}, custom: [], contacts: [], ledger: [], history: [], seeded: [] };
}

/** Fill in what an older or partial state lacks (idempotent). */
export function normalizeState(s) {
  const out = { ...emptyState(), ...(s && typeof s === "object" ? s : {}) };
  out.schema = STATE_SCHEMA;
  for (const k of ["custom", "contacts", "ledger", "history", "seeded"]) if (!Array.isArray(out[k])) out[k] = [];
  if (!out.factions || typeof out.factions !== "object") out.factions = {};
  return out;
}

/** The standing with one faction (stored, or the definition's defaults). Read-only. */
export function standingOf(state, def) {
  const st = state?.factions?.[def.id] ?? {};
  return {
    known: st.known ?? !!def.known,
    attitude: ATTITUDES.includes(st.attitude) ? st.attitude : (ATTITUDES.includes(def.attitude) ? def.attitude : "indifferent"),
    party: clampRenown(st.party),
    heroes: st.heroes ?? {},
    notes: st.notes ?? "",
    touched: !!state?.factions?.[def.id]
  };
}

/** The stored record for a faction, created on first write. Mutates state. */
function slot(state, def) {
  const cur = state.factions[def.id];
  if (cur) { cur.heroes ??= {}; return cur; }
  const s = standingOf(state, def);
  return (state.factions[def.id] = { known: s.known, attitude: s.attitude, party: 0, heroes: {}, notes: "" });
}

export const heroScore = (standing, actorId) => clampRenown(standing.heroes?.[actorId]?.score);
export const isMember = (standing, actorId) => !!standing.heroes?.[actorId]?.member;

function pushHistory(state, entry, cap = HISTORY_CAP) {
  state.history.push(entry);
  if (state.history.length > cap) state.history.splice(0, state.history.length - cap);
  return entry;
}

const stamp = ctx => ({ id: ctx.id ?? simpleId(), date: ctx.date ?? new Date().toISOString(), session: ctx.session ?? "", by: ctx.by ?? "" });

/**
 * Change renown (mutates state). target "party" or an actor id. Returns what happened, including rank changes.
 * ctx: { id, date, session, by, reason, source, heroName, defs }.
 */
export function changeRenown(state, def, target, delta, ctx = {}) {
  const s = slot(state, def);
  const before = target === "party" ? clampRenown(s.party) : clampRenown(s.heroes[target]?.score);
  const after = clampRenown(before + Number(delta || 0));
  if (target === "party") s.party = after;
  else s.heroes[target] = { member: false, ...(s.heroes[target] ?? {}), score: after };
  const ranks = ctx.defs ? ranksOf(def, ctx.defs) : def.ranks ?? [];
  const rankBefore = rankFor(before, ranks), rankAfter = rankFor(after, ranks);
  const entry = pushHistory(state, {
    ...stamp(ctx), kind: "renown", factionId: def.id, target, heroName: ctx.heroName ?? "",
    delta: after - before, asked: Number(delta || 0), from: before, to: after, reason: ctx.reason ?? "", source: ctx.source ?? ""
  });
  return {
    entry, before, after,
    rankUp: rankAfter && rankAfter !== rankBefore && after > before ? rankAfter : null,
    rankDown: rankBefore && rankAfter !== rankBefore && after < before ? rankAfter ?? { min: 0, name: null } : null,
    recognizedNow: !recognized(before) && recognized(after)
  };
}

/** Set renown to a value (mutates). */
export function setRenown(state, def, target, value, ctx = {}) {
  const s = standingOf(state, def);
  const cur = target === "party" ? s.party : heroScore(s, target);
  return changeRenown(state, def, target, clampRenown(value) - cur, ctx);
}

export function setAttitude(state, def, attitude, ctx = {}) {
  if (!ATTITUDES.includes(attitude)) throw new Error(`Unknown attitude ${attitude}`);
  const s = slot(state, def);
  const from = s.attitude;
  s.attitude = attitude;
  if (from === attitude) return null;
  return pushHistory(state, { ...stamp(ctx), kind: "attitude", factionId: def.id, from, to: attitude, reason: ctx.reason ?? "", source: ctx.source ?? "" });
}

export function setKnown(state, def, known, ctx = {}) {
  const s = slot(state, def);
  if (s.known === !!known) return null;
  s.known = !!known;
  return pushHistory(state, { ...stamp(ctx), kind: "known", factionId: def.id, to: s.known });
}

export function setMember(state, def, actorId, member, ctx = {}) {
  const s = slot(state, def);
  const cur = s.heroes[actorId] ?? { score: 0, member: false };
  if (cur.member === !!member) return null;
  s.heroes[actorId] = { ...cur, member: !!member };
  return pushHistory(state, { ...stamp(ctx), kind: "member", factionId: def.id, target: actorId, heroName: ctx.heroName ?? "", to: !!member, reason: ctx.reason ?? "" });
}

export function setNotes(state, def, notes) {
  slot(state, def).notes = String(notes ?? "");
}

/* ---------------- contacts ---------------- */

export function normalizeContact(c) {
  return {
    id: c.id ?? simpleId(), name: c.name ?? "", faction: c.faction ?? null, actorUuid: c.actorUuid ?? null, img: c.img ?? null,
    attitude: ATTITUDES.includes(c.attitude) ? c.attitude : "indifferent", role: c.role ?? "", offers: c.offers ?? "",
    notes: c.notes ?? "", knownBy: Array.isArray(c.knownBy) ? c.knownBy : [], known: !!c.known,
    met: c.met ?? "", seed: c.seed ?? null
  };
}

export function addContact(state, data, ctx = {}) {
  const c = normalizeContact({ ...data, id: data.id ?? ctx.id });
  state.contacts.push(c);
  pushHistory(state, { ...stamp({ ...ctx, id: ctx.historyId }), kind: "contact", contactId: c.id, text: "added" });
  return c;
}

export function updateContact(state, id, patch) {
  const c = state.contacts.find(x => x.id === id);
  if (!c) throw new Error(`No contact ${id}`);
  Object.assign(c, patch, { id: c.id });
  if (patch.attitude && !ATTITUDES.includes(c.attitude)) c.attitude = "indifferent";
  return c;
}

export function removeContact(state, id) {
  const i = state.contacts.findIndex(x => x.id === id);
  if (i < 0) return false;
  const [gone] = state.contacts.splice(i, 1);
  // Ledger entries with this contact keep the name.
  for (const e of state.ledger) if (e.with?.contact === id) e.with = { name: gone.name ?? "" };
  return true;
}

/* ---------------- ledger ---------------- */

export function normalizeEntry(e) {
  return {
    id: e.id ?? simpleId(), kind: LEDGER_KINDS.includes(e.kind) ? e.kind : "debt",
    with: e.with && typeof e.with === "object" ? { ...e.with } : { name: String(e.with ?? "") },
    who: Array.isArray(e.who) ? e.who : [], what: e.what ?? "", weight: WEIGHTS.includes(e.weight) ? e.weight : 1,
    status: LEDGER_STATUS.includes(e.status) ? e.status : "open", known: !!e.known, notes: e.notes ?? "",
    due: e.due ?? "", date: e.date ?? new Date().toISOString(), session: e.session ?? "", source: e.source ?? "",
    seed: e.seed ?? null, log: Array.isArray(e.log) ? e.log : []
  };
}

export function addEntry(state, data, ctx = {}) {
  const e = normalizeEntry({ ...data, id: data.id ?? ctx.id, date: data.date ?? ctx.date, session: data.session ?? ctx.session });
  state.ledger.push(e);
  pushHistory(state, { ...stamp({ ...ctx, id: ctx.historyId }), kind: "ledger", entryId: e.id, to: e.status, text: "added", source: ctx.source ?? "" });
  return e;
}

export function updateEntry(state, id, patch) {
  const e = state.ledger.find(x => x.id === id);
  if (!e) throw new Error(`No ledger entry ${id}`);
  Object.assign(e, patch, { id: e.id });
  if (!WEIGHTS.includes(e.weight)) e.weight = 1;
  if (!LEDGER_KINDS.includes(e.kind)) e.kind = "debt";
  return e;
}

export function setEntryStatus(state, id, status, ctx = {}) {
  if (!LEDGER_STATUS.includes(status)) throw new Error(`Unknown status ${status}`);
  const e = state.ledger.find(x => x.id === id);
  if (!e) throw new Error(`No ledger entry ${id}`);
  if (e.status === status) return null;
  const from = e.status;
  e.status = status;
  e.log = [...(e.log ?? []), { date: ctx.date ?? new Date().toISOString(), session: ctx.session ?? "", from, to: status, note: ctx.reason ?? "" }];
  return pushHistory(state, { ...stamp(ctx), kind: "ledger", entryId: id, from, to: status, reason: ctx.reason ?? "" });
}

export function removeEntry(state, id) {
  const i = state.ledger.findIndex(x => x.id === id);
  if (i >= 0) state.ledger.splice(i, 1);
  return i >= 0;
}

export const isOpenEntry = e => OPEN_LEDGER.includes(e.status);

/** Open first, then heavier, then newest. */
export function sortLedger(list) {
  return [...(list ?? [])].sort((a, b) => (isOpenEntry(b) - isOpenEntry(a)) || (b.weight - a.weight) || String(b.date).localeCompare(String(a.date)));
}

/**
 * Pack seeds (contacts, ledger) the world hasn't seen yet. Deleted seeds don't come back (state.seeded). Mutates.
 * Ledger seeds name heroes by name ("who": ["Ilka"]); heroes ([{id, name}]) turns those into actor ids.
 */
export function seedFromPack(state, defs, heroes = []) {
  const seeded = new Set(state.seeded ?? []);
  let added = 0;
  for (const c of defs?.contacts ?? []) {
    const key = `contact:${c.id}`;
    if (seeded.has(key)) continue;
    state.contacts.push(normalizeContact({ ...c, id: `seed-${c.id}`, seed: c.id }));
    seeded.add(key); added++;
  }
  for (const e of defs?.ledger ?? []) {
    const key = `ledger:${e.id}`;
    if (seeded.has(key)) continue;
    const w = e.with?.contact ? { ...e.with, contact: `seed-${e.with.contact}` } : e.with;
    const who = (e.who ?? []).map(x => findHero(heroes, x)?.id ?? x);
    state.ledger.push(normalizeEntry({ ...e, with: w, who, id: `seed-${e.id}`, seed: e.id, date: e.date ?? "" }));
    seeded.add(key); added++;
  }
  state.seeded = [...seeded];
  return added;
}

/* ------------------------------------------------------------------ */
/* Custom factions (made in the world)                                 */
/* ------------------------------------------------------------------ */

export function addCustomFaction(state, data, existingIds = []) {
  const base = slugify(localText(data.name) || "faction");
  let id = base, n = 2;
  const taken = new Set([...existingIds, ...state.custom.map(f => f.id)]);
  while (taken.has(id)) id = `${base}-${n++}`;
  const f = { id, name: data.name, epithet: data.epithet ?? null, kind: data.kind ?? "faction", color: data.color ?? null, group: data.group ?? null };
  state.custom.push(f);
  return f;
}

export function removeCustomFaction(state, id) {
  const i = state.custom.findIndex(f => f.id === id);
  if (i < 0) return false;
  state.custom.splice(i, 1);
  return true;
}

/* ------------------------------------------------------------------ */
/* Views                                                               */
/* ------------------------------------------------------------------ */

/** Label for whoever a ledger entry is with. */
export function withLabel(entry, defs, state, lang = "en") {
  const w = entry?.with ?? {};
  if (w.faction) { const f = defs.factions.find(x => x.id === w.faction); if (f) return localText(f.name, lang); }
  if (w.contact) { const c = state.contacts.find(x => x.id === w.contact); if (c) return localText(c.name, lang); }
  return localText(w.name, lang) || "—";
}

/** Heroes an entry names, or null for the whole party. */
export function whoLabel(entry, heroes) {
  if (!entry?.who?.length) return null;
  // A pack may name a hero the world doesn't have (yet): show the name as written.
  return entry.who.map(id => heroes.find(h => h.id === id)?.name ?? id).join(", ");
}

/**
 * Everything one audience may see. gm=true: all of it. Players: known factions, known contacts, known entries;
 * GM notes stripped. heroes: [{id, name}] (the player characters).
 */
export function buildView(state, defs, { gm = false, heroes = [], lang = "en" } = {}) {
  const st = normalizeState(state);
  const factions = defs.factions.map(def => {
    const s = standingOf(st, def);
    const ranks = ranksOf(def, defs), perks = perksOf(def, defs);
    return {
      id: def.id, def, known: s.known, attitude: s.attitude, party: s.party,
      name: localText(def.name, lang), epithet: localText(def.epithet, lang), motto: localText(def.motto, lang),
      group: localText(def.group, lang), kind: def.kind, color: def.color,
      partyPerks: perksFor(s.party, perks).map(p => localText(p.text ?? p.name, lang)),
      recognized: recognized(s.party),
      heroes: heroes.map(h => {
        const score = heroScore(s, h.id);
        const member = isMember(s, h.id);
        const rank = member ? rankFor(score, ranks) : null;
        const next = member ? nextRank(score, ranks) : null;
        return { id: h.id, name: h.name, score, member, rank: rank ? localText(rank.name, lang) : "", next: next ? { min: next.min, name: localText(next.name, lang) } : null,
          recognized: recognized(score), downtime: downtimeDays(score), perks: perksFor(score, perks).map(p => localText(p.text ?? p.name, lang)) };
      }),
      notes: gm ? s.notes : "", gmNotes: gm ? localText(def.notes, lang) : "", touched: s.touched,
      allies: def.allies ?? [], rivals: def.rivals ?? []
    };
  }).filter(f => gm || f.known);
  const contacts = st.contacts.filter(c => gm || c.known).map(c => ({
    ...c, name: localText(c.name, lang), role: localText(c.role, lang), offers: localText(c.offers, lang),
    notes: gm ? localText(c.notes, lang) : "",
    factionName: c.faction ? localText(defs.factions.find(f => f.id === c.faction)?.name, lang) : ""
  }));
  const ledger = sortLedger(st.ledger.filter(e => gm || e.known)).map(e => ({
    ...e, what: localText(e.what, lang), notes: gm ? localText(e.notes, lang) : "", withName: withLabel(e, defs, st, lang), whoName: whoLabel(e, heroes)
  }));
  return { factions, contacts, ledger };
}

/* ------------------------------------------------------------------ */
/* The journal page                                                    */
/* ------------------------------------------------------------------ */

const cell = v => String(v ?? "").replace(/\|/g, "\\|").replace(/\s*\n\s*/g, " ").trim();
const table = (cols, rows, none) => `| ${cols.join(" | ")} |\n|${cols.map(() => "---").join("|")}|\n${rows.length ? rows.map(r => `| ${r.map(cell).join(" | ")} |`).join("\n") : `| ${none} |${" |".repeat(cols.length - 1)}`}\n`;

/**
 * The GM page in Markdown (a Codex note when Planar Codex is installed). view = buildView(..., {gm: true}).
 * L: labels { title, intro, sections: {standing, contacts, ledger, history}, cols: {...}, attitude: {...},
 *   kind: {...}, status: {...}, party, none, yes, member, weight: n => string, history: entry => string }.
 */
export function pageMarkdown(view, history, L) {
  const touched = view.factions.filter(f => f.touched || f.known || f.party || f.heroes.some(h => h.score || h.member));
  const standing = table(
    [L.cols.faction, L.cols.attitude, L.cols.party, L.cols.heroes, L.cols.known],
    touched.map(f => [
      f.name, L.attitude[f.attitude], f.party,
      f.heroes.filter(h => h.score || h.member).map(h => `${h.name} ${h.score}${h.member ? ` (${h.rank || L.member})` : ""}`).join("; "),
      f.known ? L.yes : ""
    ]), L.none);
  const contacts = table(
    [L.cols.contact, L.cols.faction, L.cols.attitude, L.cols.offers, L.cols.known],
    view.contacts.map(c => [c.name, c.factionName, L.attitude[c.attitude], c.offers, c.known ? L.yes : ""]), L.none);
  const ledger = table(
    [L.cols.kind, L.cols.with, L.cols.who, L.cols.what, L.cols.weight, L.cols.status, L.cols.session, L.cols.known],
    view.ledger.map(e => [L.kind[e.kind], e.withName, e.whoName ?? L.party, e.what, L.weight(e.weight), L.status[e.status], e.session, e.known ? L.yes : ""]), L.none);
  const recent = [...(history ?? [])].slice(-40).reverse();
  const hist = recent.length ? recent.map(h => `- ${String(h.date ?? "").slice(0, 10)}${h.session ? ` · ${h.session}` : ""} · ${L.history(h)}`).join("\n") + "\n" : `${L.none}\n`;
  return `# ${L.title}\n\n${L.intro}\n\n## ${L.sections.standing}\n\n${standing}\n## ${L.sections.ledger}\n\n${ledger}\n## ${L.sections.contacts}\n\n${contacts}\n## ${L.sections.history}\n\n${hist}`;
}
