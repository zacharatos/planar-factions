export const MODULE_ID = "planar-factions";
export const EVENT = `module.${MODULE_ID}`;

/** The generic pack shipped with the module (ranks, perks, missions; no factions). */
export const DEFAULT_PACK_PATH = `modules/${MODULE_ID}/data/default-pack.json`;

/** Journal folder for the standing page when Planar Codex is not installed. */
export const PAGE_FOLDER = "Planar Factions";

/** Colours for factions that don't set one (cycled by position). */
export const PALETTE = ["#8a6d3b", "#5b7f95", "#7d5a8c", "#6b8e4e", "#a4553f", "#4f6d7a", "#9b7a2f", "#6d4c41", "#3f7f6b", "#8c4a5e"];

/** Icons per attitude (Font Awesome). */
export const ATTITUDE_ICON = { hostile: "fa-face-angry", indifferent: "fa-face-meh", friendly: "fa-face-smile" };
