import { MODULE_ID } from "./constants.mjs";
import { registerSettings } from "./settings.mjs";
import { loadDefaultPack, seed, onWrite, state, defs, view, importedPack, textLang } from "./state.mjs";
import { loadDictionaries, setLanguageSource } from "./i18n.mjs";
import { registerSocket, showToPlayers } from "./rpc.mjs";
import { FactionsConsole } from "./console.mjs";
import { StandingWindow } from "./standing.mjs";
import { registerEnrichers, registerClicks } from "./enrichers.mjs";
import { schedulePageSync, syncPage, markdown } from "./page.mjs";
import * as act from "./actions.mjs";

const refresh = () => {
  FactionsConsole.instance?.refreshSoon();
  StandingWindow.instance?.refreshSoon();
};

/** The GM gets the console, players the Standing window. */
const openForMe = () => (game.user.isGM ? FactionsConsole.open() : StandingWindow.open());

Hooks.once("init", () => {
  registerSettings({ onState: what => { refresh(); if (what === "language") ui.controls?.render?.(); } });
  registerEnrichers();
  game.keybindings.register(MODULE_ID, "open", {
    name: "PLANAR_FACTIONS.Keybinding.Open",
    editable: [],
    onDown: () => { openForMe(); return true; }
  });
});

Hooks.once("ready", async () => {
  setLanguageSource(textLang);
  await Promise.all([loadDefaultPack(), loadDictionaries()]);
  registerSocket(() => StandingWindow.open());
  registerClicks();
  onWrite(schedulePageSync);
  await seed().catch(err => console.warn(`${MODULE_ID} | seeding`, err));
  const module = game.modules.get(MODULE_ID);
  if (module) module.api = {
    open: opts => (game.user.isGM ? FactionsConsole.open(opts) : StandingWindow.open(opts)),
    openStanding: opts => StandingWindow.open(opts),
    showToPlayers: () => showToPlayers(),
    state: () => state(),
    defs: () => defs(),
    pack: () => importedPack(),
    view: opts => view(opts),
    renown: (faction, target, delta, opts) => act.renown(faction, target ?? "party", delta, opts),
    attitude: (faction, value, opts) => act.attitude(faction, value, opts),
    reveal: (faction, known = true) => act.reveal(faction, known),
    member: (faction, actorId, on = true) => act.member(faction, actorId, on),
    addEntry: data => act.entryAdd(data),
    entryStatus: (id, status, opts) => act.entryStatus(id, status, opts),
    addContact: data => act.contactAdd(data),
    rollMission: faction => act.rollMission(faction),
    resolveFaction: token => act.resolveFaction(token),
    syncPage: () => syncPage(),
    markdown: () => markdown()
  };
});

// Toolbar button: the GM's console; for players (if the setting allows) their Standing window.
Hooks.on("getSceneControlButtons", controls => {
  if (!controls?.tokens?.tools) return;
  const gm = game.user?.isGM;
  if (!gm && !game.settings.get(MODULE_ID, "playerButton")) return;
  controls.tokens.tools[MODULE_ID] = {
    name: MODULE_ID,
    title: gm ? "PLANAR_FACTIONS.ToolTitle" : "PLANAR_FACTIONS.ToolTitlePlayer",
    icon: "fa-solid fa-landmark-flag",
    order: 62,
    button: true,
    visible: true,
    onChange: () => openForMe()
  };
});

// Names and portraits of heroes show in both windows.
Hooks.on("updateActor", (actor, change) => { if (change?.name || change?.img || change?.ownership) refresh(); });
Hooks.on("createActor", refresh);
Hooks.on("deleteActor", refresh);
Hooks.on("updateUser", refresh);
