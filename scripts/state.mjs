// World data: the definitions (shipped pack + imported pack + the GM's own factions) and the state.
// Every client reads; only the active GM's client writes, one write at a time.
import { MODULE_ID, DEFAULT_PACK_PATH } from "./constants.mjs";
import { setting, setSetting } from "./settings.mjs";
import { validatePack, mergePacks, normalizeState, seedFromPack, localText, buildView, standingOf, pickLanguage } from "./util.mjs";

const clone = v => foundry.utils.deepClone(v);
let defaultPack = null;
let afterWrite = null;

/** One write at a time: a promise queue. Never call serial() from inside a serial() block. */
let queue = Promise.resolve();
export function serial(fn) {
  const run = queue.then(fn, fn);
  queue = run.catch(() => {});
  return run;
}

/** Called after every saved change (the page sync hooks in here). */
export const onWrite = fn => { afterWrite = fn; };

/** Load the generic pack shipped with the module (once). */
export async function loadDefaultPack() {
  if (defaultPack) return defaultPack;
  try { defaultPack = await (await fetch(DEFAULT_PACK_PATH)).json(); }
  catch (err) { console.error(`${MODULE_ID} | default pack failed to load`, err); defaultPack = { schema: 1, id: "default", factions: [] }; }
  return defaultPack;
}

export const importedPack = () => setting("pack");
export const state = () => normalizeState(setting("state"));
/** The active definitions. */
export const defs = () => mergePacks(defaultPack, importedPack(), state().custom);
export const factionDef = id => defs().factions.find(f => f.id === id) ?? null;
/** The standing with one faction right now. */
export const standingFor = def => standingOf(state(), def);

/** While the shared journal page is written, everything is in the world's language, not the GM's own. */
let forced = null;

/** This user's language for the module (windows and pack text): their choice, the world default, or Foundry's. */
export const textLang = () => forced ?? pickLanguage(setting("language"), setting("textLanguage"), game.i18n.lang);
/** The world's language (the shared page): the world default, or Foundry's. */
export const worldLang = () => pickLanguage(null, setting("textLanguage"), game.i18n.lang);
/** The EN/ΕΛ button: switch this user's language. */
export const toggleLanguage = () => setSetting("language", textLang() === "el" ? "en" : "el");

/** Run fn (synchronous) with the module's text in the world's language. */
export function inWorldLanguage(fn) {
  const prev = forced;
  forced = worldLang();
  try { return fn(); } finally { forced = prev; }
}
export const local = value => localText(value, textLang());

/** The label for the current session ("S01"), stamped on every change. */
export const session = () => setting("session") ?? "";

/** Player characters, as {id, name, img} (characters owned by a player). */
export function heroes() {
  return game.actors.filter(a => a.type === "character" && a.hasPlayerOwner).map(a => ({ id: a.id, name: a.name, img: a.img }));
}

/** What this client may see. */
export const view = ({ gm = game.user.isGM } = {}) => buildView(state(), defs(), { gm, heroes: heroes(), lang: textLang() });

/** Change the state on the GM's client (inside serial()). fn gets a copy and the definitions; its result is returned. */
export function mutate(fn) {
  if (!game.user.isGM) throw new Error("Only the GM changes the factions.");
  return serial(async () => {
    const s = clone(state());
    const result = await fn(s, defs());
    await setSetting("state", s);
    afterWrite?.();
    return result;
  });
}

/** Ids and dates for util.mjs, from Foundry. */
export const ctx = (extra = {}) => ({
  id: foundry.utils.randomID(), historyId: foundry.utils.randomID(), date: new Date().toISOString(),
  session: session(), by: game.user.name, ...extra
});

/** Seed pack contacts and ledger entries the world hasn't seen (GM, after load and after an import). */
export async function seed() {
  if (!game.user.isGM || !game.users.activeGM?.isSelf) return 0;
  const d = defs();
  if (!d.contacts.length && !d.ledger.length) return 0;
  const s = state();
  const probe = clone(s);
  const n = seedFromPack(probe, d, heroes());
  if (!n) return 0;
  return mutate(st => seedFromPack(st, defs(), heroes()));
}

/** Import a pack (object). Returns the problems found; saves only if there are none. */
export async function importPack(data) {
  const errors = validatePack(data);
  if (errors.length) return errors;
  await setSetting("pack", data);
  await seed();
  return [];
}
export const resetPack = () => setSetting("pack", null);
