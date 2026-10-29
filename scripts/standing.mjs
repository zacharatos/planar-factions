// The players' Standing window: read-only. Factions the players know, with the party's renown, each hero's renown,
// membership and rank, and the perks reached; known contacts; known debts and favours. The GM can open it as a
// preview of what the players see.
import { PALETTE, ATTITUDE_ICON } from "./constants.mjs";
import { t } from "./i18n.mjs";
import { setting } from "./settings.mjs";
import { escapeHTML as esc, isOpenEntry, RECOGNITION } from "./util.mjs";
import { view, defs, textLang, toggleLanguage } from "./state.mjs";

const { ApplicationV2 } = foundry.applications.api;
const TABS = ["factions", "contacts", "ledger"];
const TAB_ICONS = { factions: "fa-landmark-flag", contacts: "fa-address-book", ledger: "fa-scale-balanced" };

export class StandingWindow extends ApplicationV2 {
  static DEFAULT_OPTIONS = {
    id: "planar-factions-standing",
    classes: ["planar-factions", "pf-standing"],
    window: { title: "PLANAR_FACTIONS.Standing.Title", icon: "fa-solid fa-landmark-flag", resizable: true },
    position: { width: 560, height: 640 }
  };

  static #instance = null;
  static get instance() { return this.#instance; }

  static open({ preview = false, tab = null, faction = null } = {}) {
    this.#instance ??= new StandingWindow();
    const w = this.#instance;
    w.#preview = preview || false;
    if (tab) w.#tab = tab;
    if (faction) { w.#tab = "factions"; w.#focus = faction; }
    w.render({ force: true });
    w.bringToFront?.();
    return w;
  }

  #tab = "factions";
  #preview = false;
  #focus = null;
  #boundTo = null;
  #timer = null;

  refreshSoon() {
    clearTimeout(this.#timer);
    this.#timer = setTimeout(() => { if (this.rendered) this.render(); }, 200);
  }

  async _prepareContext() { return {}; }
  async _renderHTML() { return this.#html(); }
  _replaceHTML(result, content) { content.innerHTML = result; }

  /** In this user's language (Foundry's own title would follow Foundry's language). */
  get title() { return t("Standing.Title"); }

  _onRender() {
    if (this.window?.title) this.window.title.textContent = this.title;
    if (this.#focus) {
      this.element.querySelector(`[data-card="${CSS.escape(this.#focus)}"]`)?.scrollIntoView?.({ block: "nearest" });
      this.#focus = null;
    }
    if (this.#boundTo === this.element) return;
    this.#boundTo = this.element;
    this.element.addEventListener("click", ev => {
      if (ev.target.closest("[data-act=lang]")) return toggleLanguage();
      const tab = ev.target.closest("[data-tab]");
      if (tab) { this.#tab = tab.dataset.tab; this.render(); }
    });
  }

  #html() {
    const v = view({ gm: false });
    const counts = { factions: v.factions.length, contacts: v.contacts.length, ledger: v.ledger.filter(isOpenEntry).length };
    const tabs = TABS.map(k => `<a class="pf-tab ${k === this.#tab ? "active" : ""}" data-tab="${k}"><i class="fa-solid ${TAB_ICONS[k]}"></i> ${esc(t(`Standing.Tab.${k}`))}${counts[k] ? ` <span class="pf-count">${counts[k]}</span>` : ""}</a>`).join("");
    const banner = this.#preview && game.user.isGM ? `<p class="pf-banner"><i class="fa-solid fa-eye"></i> ${esc(t("Standing.Preview"))}</p>` : "";
    const body = { factions: () => this.#factions(v), contacts: () => this.#contacts(v), ledger: () => this.#ledger(v) }[this.#tab]();
    const lang = `<button type="button" class="pf-lang" data-act="lang" data-tooltip="${esc(t("Console.Language"))}"><i class="fa-solid fa-language"></i> ${textLang() === "el" ? "ΕΛ" : "EN"}</button>`;
    return `${banner}<nav class="pf-tabs">${tabs}${lang}</nav><section class="pf-body">${body}</section>`;
  }

  #factions(v) {
    if (!v.factions.length) return `<p class="pf-empty">${esc(t("Standing.NoFactions"))}</p>`;
    const party = setting("track") !== "heroes", hs = setting("track") !== "party";
    const all = defs().factions;
    const mine = new Set(game.user.character ? [game.user.character.id] : []);
    const cards = v.factions.map(f => {
      const color = f.color || PALETTE[all.findIndex(x => x.id === f.id) % PALETTE.length];
      const heroes = f.heroes.filter(h => h.score || h.member).map(h => `<li class="${mine.has(h.id) ? "me" : ""}">
        <strong>${esc(h.name)}</strong> <span class="pf-score">${h.score}</span>
        ${h.member ? `<span class="pf-tag">${esc(h.rank || t("Common.Member"))}</span>` : ""}
        ${h.recognized ? `<i class="fa-solid fa-handshake" data-tooltip="${esc(t("Standing.RecognizedHint", { n: RECOGNITION }))}"></i>` : ""}
        ${h.next && mine.has(h.id) ? `<small>${esc(t("Console.NextRank", { name: h.next.name, n: h.next.min }))}</small>` : ""}
        ${mine.has(h.id) && h.perks.length ? `<ul class="pf-perks">${h.perks.map(p => `<li>${esc(p)}</li>`).join("")}</ul>` : ""}</li>`).join("");
      return `<div class="pf-card pf-faction open" data-card="${esc(f.id)}" style="--pf-color:${esc(color)}">
        <header><span class="pf-swatch" style="background:${esc(color)}"></span>
          <div class="pf-who"><strong>${esc(f.name)}</strong>${f.epithet ? ` <small>${esc(f.epithet)}</small>` : ""}</div>
          <span class="pf-att a-${f.attitude}"><i class="fa-solid ${ATTITUDE_ICON[f.attitude]}"></i> ${esc(t(`Attitude.${f.attitude}`))}</span></header>
        ${f.motto ? `<p class="pf-motto">${esc(f.motto)}</p>` : ""}
        ${party ? `<p><strong>${esc(t("Console.PartyRenown"))}:</strong> <span class="pf-score">${f.party}</span>${f.recognized ? ` <span class="pf-tag ok">${esc(t("Console.Recognized"))}</span>` : ""}</p>
          ${f.partyPerks.length ? `<ul class="pf-perks">${f.partyPerks.map(p => `<li>${esc(p)}</li>`).join("")}</ul>` : ""}` : ""}
        ${hs && heroes ? `<ul class="pf-heroes">${heroes}</ul>` : ""}</div>`;
    }).join("");
    return `<details class="pf-help"><summary><i class="fa-solid fa-circle-question"></i> ${esc(t("Standing.HelpTitle"))}</summary><p>${esc(t("Standing.Help", { n: RECOGNITION }))}</p></details>${cards}`;
  }

  #contacts(v) {
    if (!v.contacts.length) return `<p class="pf-empty">${esc(t("Standing.NoContacts"))}</p>`;
    return v.contacts.map(c => `<div class="pf-card pf-contact"><header>
        ${c.img ? `<img src="${esc(c.img)}" alt="">` : `<i class="fa-solid fa-user pf-noimg"></i>`}
        <div class="pf-who"><strong>${esc(c.name)}</strong>${c.role ? ` <small>${esc(c.role)}</small>` : ""}${c.factionName ? `<br><small><i class="fa-solid fa-landmark-flag"></i> ${esc(c.factionName)}</small>` : ""}</div>
        <span class="pf-att a-${c.attitude}"><i class="fa-solid ${ATTITUDE_ICON[c.attitude]}"></i> ${esc(t(`Attitude.${c.attitude}`))}</span></header>
        ${c.offers ? `<p><i class="fa-solid fa-hand-holding-heart"></i> ${esc(c.offers)}</p>` : ""}</div>`).join("");
  }

  #ledger(v) {
    if (!v.ledger.length) return `<p class="pf-empty">${esc(t("Standing.NoEntries"))}</p>`;
    const card = e => `<div class="pf-card pf-entry k-${e.kind} s-${e.status}"><header>
        <i class="fa-solid ${e.kind === "debt" ? "fa-arrow-right-from-bracket" : "fa-arrow-right-to-bracket"} pf-kind"></i>
        <div class="pf-who"><strong>${esc(e.withName)}</strong> <small>${esc(t(e.kind === "debt" ? "Console.TheyAreOwed" : "Console.TheyOwe", { who: e.whoName ?? t("Common.Party") }))}</small></div>
        <span class="pf-weight w${e.weight}" data-tooltip="${esc(t(`Weight.${e.weight}`))}">${"◆".repeat(e.weight)}</span>
        <span class="pf-status s-${e.status}">${esc(t(`Status.${e.status}`))}</span></header>
        <p>${esc(e.what)}</p>${e.due ? `<p class="pf-hint">${esc(t("Console.Due"))}: ${esc(e.due)}</p>` : ""}</div>`;
    const open = v.ledger.filter(isOpenEntry), closed = v.ledger.filter(e => !isOpenEntry(e));
    return `${open.map(card).join("") || `<p class="pf-empty">${esc(t("Standing.NoOpen"))}</p>`}
      ${closed.length ? `<details class="pf-closed"><summary>${esc(t("Standing.Closed", { n: closed.length }))}</summary>${closed.map(card).join("")}</details>` : ""}`;
  }
}
