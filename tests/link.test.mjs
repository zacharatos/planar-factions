// Loads the real entry point against stubbed Foundry globals. This catches broken imports, missing
// exports and hook wiring mistakes; it does not replace testing in Foundry.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const hooks = { once: {}, on: {} };
globalThis.Hooks = {
  once: (name, fn) => { hooks.once[name] = fn; },
  on: (name, fn) => { (hooks.on[name] ??= []).push(fn); },
  callAll: () => true
};
class FakeApp { static DEFAULT_OPTIONS = {}; }
let ids = 0;
globalThis.foundry = {
  applications: { api: { ApplicationV2: FakeApp, DialogV2: class {} } },
  utils: { randomID: () => `id${++ids}`, deepClone: v => structuredClone(v), escapeHTML: s => s }
};
globalThis.CONFIG = { TextEditor: { enrichers: [] } };
const settings = new Map();
const registered = { settings: [], keys: [], sockets: [], listeners: [] };
const heroes = [{ id: "a1", name: "Ilka Thorn", type: "character", hasPlayerOwner: true, img: "" }, { id: "n1", name: "Guard", type: "npc", hasPlayerOwner: false }];
globalThis.game = {
  user: { isGM: true, id: "gm", name: "GM" },
  users: Object.assign([{ id: "gm", isGM: true, active: true }], { activeGM: { isSelf: true }, get: () => ({ isGM: true }) }),
  actors: Object.assign([...heroes], { get: id => heroes.find(h => h.id === id) ?? null }),
  modules: new Map([["planar-factions", {}]]),
  settings: {
    register: (mod, key, cfg) => { registered.settings.push(`${mod}.${key}`); settings.set(key, cfg.default); },
    get: (mod, key) => settings.get(key),
    set: async (mod, key, v) => { settings.set(key, v); return v; }
  },
  keybindings: { register: (mod, key) => registered.keys.push(`${mod}.${key}`) },
  socket: { on: event => registered.sockets.push(event), emit() {} },
  i18n: { localize: k => k, format: k => k, lang: "en" }
};
globalThis.document = { addEventListener: (type, fn) => registered.listeners.push(type) };
const defaultPack = JSON.parse(readFileSync(new URL("../data/default-pack.json", import.meta.url), "utf8"));
globalThis.fetch = async () => ({ json: async () => defaultPack });
globalThis.ui = { notifications: { warn() {}, info() {}, error() {} }, controls: { render() {} } };
globalThis.ChatMessage = { create: async data => data };
// The journal page is rebuilt 2 s after a change; give it somewhere to go.
const journal = [];
game.folders = Object.assign([], { find: () => null });
globalThis.Folder = { create: async data => ({ id: "f1", ...data }) };
globalThis.CONST = { DOCUMENT_OWNERSHIP_LEVELS: { NONE: 0 }, JOURNAL_ENTRY_PAGE_FORMATS: { MARKDOWN: 2 } };
globalThis.JournalEntry = { create: async data => { journal.push(data); return { pages: { contents: [{ uuid: "JournalEntry.j1.JournalEntryPage.p1", update: async () => {} }] } }; } };
globalThis.fromUuid = async () => null;

await import("../scripts/main.mjs");

test("registers settings, the journal enricher and a keybinding on init", () => {
  hooks.once.init();
  for (const k of ["state", "pack", "session", "pageUuid", "track", "announce", "playerButton", "textLanguage", "pageName"]) {
    assert.ok(registered.settings.includes(`planar-factions.${k}`), k);
  }
  assert.deepEqual(registered.keys, ["planar-factions.open"]);
  assert.equal(CONFIG.TextEditor.enrichers.length, 1);
  const { pattern } = CONFIG.TextEditor.enrichers[0];
  const found = [..."See @Faction[athar] and @Renown[athar +2]{a mission}, @Debt[\"The Lady\" Ilka w3]{everything}, @Ledger[toll].".matchAll(pattern)].map(m => m[1]);
  assert.deepEqual(found, ["Faction", "Renown", "Debt", "Ledger"]);
});

test("exposes an api on ready, listens on the module socket and for clicks on journal buttons", async () => {
  await hooks.once.ready();
  const api = game.modules.get("planar-factions").api;
  assert.deepEqual(registered.sockets, ["module.planar-factions"]);
  assert.ok(registered.listeners.includes("click"));
  for (const fn of ["open", "openStanding", "showToPlayers", "state", "defs", "pack", "view", "renown", "attitude", "reveal", "member", "addEntry", "entryStatus", "addContact", "rollMission", "resolveFaction", "syncPage", "markdown"]) {
    assert.equal(typeof api[fn], "function", fn);
  }
  assert.equal(api.defs().ranks.length, 4, "uses the shipped pack");
  assert.equal(api.defs().factions.length, 0);
  assert.deepEqual(api.state().ledger, []);
});

test("the api changes the state through the GM's queue", async () => {
  const api = game.modules.get("planar-factions").api;
  await api.addEntry({ kind: "favour", with: { name: "A stranger" }, what: "a light in the dark", known: true });
  const s = api.state();
  assert.equal(s.ledger.length, 1);
  assert.equal(s.ledger[0].what, "a light in the dark");
  assert.equal(s.history.at(-1).kind, "ledger");
  await assert.rejects(() => api.renown("nobody", "party", 1), /Notify.NoFaction/);
  const v = api.view({ gm: false });
  assert.equal(v.ledger.length, 1, "known entries reach the players' view");
  assert.equal(v.ledger[0].withName, "A stranger");
});

test("toolbar button for the GM, and for players only when the setting allows", () => {
  const gm = { tokens: { tools: {} } };
  hooks.on.getSceneControlButtons[0](gm);
  assert.ok(gm.tokens.tools["planar-factions"]);
  game.user.isGM = false;
  const player = { tokens: { tools: {} } };
  hooks.on.getSceneControlButtons[0](player);
  assert.ok(player.tokens.tools["planar-factions"], "playerButton is on by default");
  settings.set("playerButton", false);
  const player2 = { tokens: { tools: {} } };
  hooks.on.getSceneControlButtons[0](player2);
  assert.deepEqual(player2.tokens.tools, {});
  game.user.isGM = true;
  assert.doesNotThrow(() => hooks.on.getSceneControlButtons[0]({}));
});

test("actor hooks don't throw", () => {
  for (const fn of hooks.on.updateActor) assert.doesNotThrow(() => fn({}, { name: "x" }));
  for (const fn of hooks.on.createActor) assert.doesNotThrow(() => fn({}));
});

test("the journal page is written a moment after a change", async () => {
  await new Promise(r => setTimeout(r, 2300));
  assert.equal(journal.length, 1);
  assert.match(journal[0].pages[0].text.markdown, /a light in the dark/);
  assert.equal(settings.get("pageUuid"), "JournalEntry.j1.JournalEntryPage.p1");
});
