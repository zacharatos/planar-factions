// Socket traffic. Only one message: the GM asks every player's client to open the Standing window.
// (Everything else the players see comes from the world settings, which every client already has.)
import { EVENT, MODULE_ID } from "./constants.mjs";

let onShow = null;

/** GM side: open the Standing window on every connected player's screen. Returns how many were asked. */
export function showToPlayers() {
  const players = game.users.filter(u => u.active && !u.isGM);
  game.socket.emit(EVENT, { op: "show", from: game.user.id });
  return players.length;
}

export function onMessage(msg) {
  if (!msg || typeof msg !== "object") return;
  if (msg.op === "show" && game.users.get(msg.from)?.isGM && !game.user.isGM) {
    try { onShow?.(); } catch (err) { console.warn(`${MODULE_ID} |`, err); }
  }
}

export function registerSocket(show) {
  onShow = show;
  game.socket.on(EVENT, onMessage);
}
