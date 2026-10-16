// The "Factions & Favours" journal page: standing, ledger, contacts and recent history, rebuilt from the state.
// A Planar Codex note when the Codex is installed (so it exports to the vault), otherwise a GM-only Markdown page.
import { MODULE_ID, PAGE_FOLDER } from "./constants.mjs";
import { t } from "./i18n.mjs";
import { setting, setSetting } from "./settings.mjs";
import { pageMarkdown, ATTITUDES, LEDGER_KINDS, LEDGER_STATUS, withLabel, localText } from "./util.mjs";
import { serial, view, state, defs, textLang } from "./state.mjs";

/** One history entry as a sentence. */
export function historyLine(h) {
  const d = defs(), st = state(), lang = textLang();
  const fac = id => localText(d.factions.find(f => f.id === id)?.name, lang) || id || "";
  const who = h => (h.target === "party" ? t("Common.Party") : h.heroName || game.actors.get(h.target)?.name || "?");
  const reason = h.reason ? ` — ${h.reason}` : "";
  switch (h.kind) {
    case "renown": return t("History.Renown", { who: who(h), faction: fac(h.factionId), from: h.from, to: h.to, delta: h.delta > 0 ? `+${h.delta}` : String(h.delta) }) + reason;
    case "attitude": return t("History.Attitude", { faction: fac(h.factionId), from: t(`Attitude.${h.from}`), to: t(`Attitude.${h.to}`) }) + reason;
    case "known": return t(h.to ? "History.Revealed" : "History.Hidden", { faction: fac(h.factionId) });
    case "member": return t(h.to ? "History.Joined" : "History.Left", { who: who(h), faction: fac(h.factionId) }) + reason;
    case "contact": {
      const c = st.contacts.find(x => x.id === h.contactId);
      return t("History.Contact", { name: localText(c?.name, lang) || "?" });
    }
    case "ledger": {
      const e = st.ledger.find(x => x.id === h.entryId);
      const what = localText(e?.what, lang) || "?";
      if (h.text === "added") return t("History.EntryAdded", { kind: t(`Kind.${e?.kind ?? "debt"}`), with: e ? withLabel(e, d, st, lang) : "?", what });
      return t("History.EntryStatus", { what, from: t(`Status.${h.from}`), to: t(`Status.${h.to}`) }) + reason;
    }
    default: return h.kind;
  }
}

export function markdown() {
  const L = {
    title: setting("pageName") || t("Page.Title"),
    intro: t("Page.Intro"),
    sections: { standing: t("Page.Standing"), contacts: t("Page.Contacts"), ledger: t("Page.Ledger"), history: t("Page.History") },
    cols: Object.fromEntries(["faction", "attitude", "party", "heroes", "known", "contact", "offers", "kind", "with", "who", "what", "weight", "status", "session"].map(c => [c, t(`Page.Col.${c}`)])),
    attitude: Object.fromEntries(ATTITUDES.map(a => [a, t(`Attitude.${a}`)])),
    kind: Object.fromEntries(LEDGER_KINDS.map(k => [k, t(`Kind.${k}`)])),
    status: Object.fromEntries(LEDGER_STATUS.map(s => [s, t(`Status.${s}`)])),
    party: t("Common.Party"), none: t("Page.None"), yes: "✓", member: t("Common.Member"),
    weight: n => t(`Weight.${n}`),
    history: historyLine
  };
  return pageMarkdown(view({ gm: true }), state().history, L);
}

function toHTML(md) {
  const body = md.replace(/^---\n[\s\S]*?\n---\n/, "");
  const conv = globalThis.showdown ? new globalThis.showdown.Converter({ tables: true, strikethrough: true }) : null;
  return conv ? conv.makeHtml(body) : `<pre>${foundry.utils.escapeHTML?.(body) ?? body}</pre>`;
}

/** The page, if it still exists. */
export async function page() {
  const uuid = setting("pageUuid");
  return uuid ? fromUuid(uuid).catch(() => null) : null;
}

/** Create or update the page (GM only, inside serial()). */
export async function syncPage() {
  if (!game.user.isGM) return null;
  const md = markdown();
  const codex = game.modules.get("planar-codex");
  const api = codex?.active ? codex.api : null;
  const html = api?.convert ? api.convert(md, { gm: true }).html : toHTML(md);
  let p = await page();
  if (p) {
    await p.update({ "text.markdown": md, "text.content": html });
    return p;
  }
  const name = setting("pageName") || t("Page.Title");
  if (api?.createCodexNote) {
    p = await api.createCodexNote({ name, markdown: md });
  } else {
    let folder = game.folders.find(f => f.type === "JournalEntry" && f.name === PAGE_FOLDER);
    folder ??= await Folder.create({ name: PAGE_FOLDER, type: "JournalEntry" });
    const entry = await JournalEntry.create({
      name, folder: folder.id,
      ownership: { default: CONST.DOCUMENT_OWNERSHIP_LEVELS.NONE },
      pages: [{ name, type: "text", text: { format: CONST.JOURNAL_ENTRY_PAGE_FORMATS.MARKDOWN, markdown: md, content: html } }]
    });
    p = entry.pages.contents[0];
  }
  if (p?.uuid) await setSetting("pageUuid", p.uuid);
  return p;
}

let timer = null;
/** Rebuild the page 2 s after the last change (only once the page exists or something was recorded). */
export function schedulePageSync() {
  if (!game.user.isGM || !game.users.activeGM?.isSelf) return;
  clearTimeout(timer);
  timer = setTimeout(() => serial(syncPage).catch(err => console.warn(`${MODULE_ID} | page`, err)), 2000);
}
