import { MODULE_ID } from "./constants.mjs";

const hidden = (key, type, def, onChange) => game.settings.register(MODULE_ID, key, {
  scope: "world", config: false, type, default: def, onChange
});
const world = (key, type, def, extra = {}) => game.settings.register(MODULE_ID, key, {
  name: `PLANAR_FACTIONS.Settings.${key}.Name`, hint: `PLANAR_FACTIONS.Settings.${key}.Hint`,
  scope: "world", config: true, type, default: def, ...extra
});

/**
 * World data lives in hidden world settings (every client can read them; only the active GM writes).
 * onChange lets every client redraw when the GM changes something.
 */
export function registerSettings({ onState } = {}) {
  hidden("state", Object, { schema: 1 }, () => onState?.("state"));
  hidden("pack", Object, null, () => onState?.("pack"));
  hidden("session", String, "", () => onState?.("session"));
  hidden("pageUuid", String, "");

  world("track", String, "both", { choices: {
    both: "PLANAR_FACTIONS.Settings.track.both", party: "PLANAR_FACTIONS.Settings.track.party", heroes: "PLANAR_FACTIONS.Settings.track.heroes"
  }, onChange: () => onState?.("settings") });
  world("announce", String, "gm", { choices: {
    gm: "PLANAR_FACTIONS.Settings.announce.gm", players: "PLANAR_FACTIONS.Settings.announce.players", off: "PLANAR_FACTIONS.Settings.announce.off"
  } });
  world("playerButton", Boolean, true, { onChange: () => ui.controls?.render?.() });
  world("textLanguage", String, "auto", { choices: {
    auto: "PLANAR_FACTIONS.Settings.textLanguage.Auto", en: "English", el: "Ελληνικά"
  }, onChange: () => onState?.("settings") });
  world("pageName", String, "Factions & Favours");
}

export const setting = key => game.settings.get(MODULE_ID, key);
export const setSetting = (key, value) => game.settings.set(MODULE_ID, key, value);
