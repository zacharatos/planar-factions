// The GM console: Factions (attitude, renown, membership, ranks, perks), Contacts, Ledger (debts and favours),
// History (and the journal page), Pack (import/export, the GM's own factions).
import { MODULE_ID, PALETTE, ATTITUDE_ICON } from "./constants.mjs";
import { t, warn, info } from "./i18n.mjs";
import { setting, setSetting } from "./settings.mjs";
import {
  escapeHTML as esc, ATTITUDES, LEDGER_KINDS, LEDGER_STATUS, WEIGHTS, AWARDS, isOpenEntry, levelRenown, fold, localText, RECOGNITION
} from "./util.mjs";
import { state, defs, view, heroes, importedPack, importPack, resetPack, local, textLang, serial } from "./state.mjs";
import * as act from "./actions.mjs";
import { markdown, page, syncPage, historyLine } from "./page.mjs";
import { showToPlayers } from "./rpc.mjs";

const { ApplicationV2, DialogV2 } = foundry.applications.api;
const TABS = ["factions", "contacts", "ledger", "history", "pack"];
const TAB_ICONS = { factions: "fa-landmark-flag", contacts: "fa-address-book", ledger: "fa-scale-balanced", history: "fa-clock-rotate-left", pack: "fa-box-archive" };

const btn = (actName, icon, label, data = "", cls = "", extra = "") =>
  `<button type="button" class="${cls}" data-act="${actName}" ${data} ${extra}><i class="fa-solid ${icon}"></i>${label ? ` ${esc(label)}` : ""}</button>`;
const tip = s => `data-tooltip="${esc(s)}"`;
const options = (values, current, label) => values.map(v => `<option value="${esc(v)}" ${String(v) === String(current) ? "selected" : ""}>${esc(label(v))}</option>`).join("");
const tracks = () => setting("track");
const showParty = () => tracks() !== "heroes";
const showHeroes = () => tracks() !== "party";

export class FactionsConsole extends ApplicationV2 {
  static DEFAULT_OPTIONS = {
    id: "planar-factions-console",
    classes: ["planar-factions"],
    window: { title: "PLANAR_FACTIONS.Console.Title", icon: "fa-solid fa-landmark-flag", resizable: true },
    position: { width: 820, height: 760 }
  };

  static #instance = null;
  static get instance() { return this.#instance; }

  static open({ tab = null, faction = null, entry = null } = {}) {
    if (!game.user.isGM) return warn("Notify.OnlyGM");
    this.#instance ??= new FactionsConsole();
    const c = this.#instance;
    if (tab) c.#tab = tab;
    if (faction) { c.#tab = "factions"; c.#open.add(faction); c.#focus = faction; c.#search = ""; }
    if (entry) { c.#tab = "ledger"; c.#focus = entry; c.#ledgerFilter = "all"; }
    c.render({ force: true });
    c.bringToFront?.();
    return c;
  }

  #tab = "factions";
  #open = new Set();
  #focus = null;
  #search = "";
  #filter = "all";
  #ledgerFilter = "open";
  #reason = "";
  #searchTimer = null;
  #boundTo = null;
  #timer = null;

  refreshSoon() {
    clearTimeout(this.#timer);
    this.#timer = setTimeout(() => {
      if (!this.rendered) return;
      // Don't redraw under the GM's typing.
      const active = document.activeElement;
      if (active && this.element.contains(active) && ["INPUT", "TEXTAREA"].includes(active.tagName) && active.type !== "checkbox") return this.refreshSoon();
      this.render();
    }, 150);
  }

  async _prepareContext() { return {}; }
  async _renderHTML() { return this.#html(); }
  _replaceHTML(result, content) {
    const scroll = content.querySelector(".pf-body")?.scrollTop ?? 0;
    content.innerHTML = result;
    const body = content.querySelector(".pf-body");
    if (body) body.scrollTop = scroll;
  }

  _onRender() {
    if (this.#focus) {
      const el = this.element.querySelector(`[data-card="${CSS.escape(this.#focus)}"]`);
      el?.scrollIntoView?.({ block: "nearest" });
      this.#focus = null;
    }
    if (this.#boundTo === this.element) return;
    this.#boundTo = this.element;
    this.element.addEventListener("click", ev => this.#onClick(ev));
    this.element.addEventListener("change", ev => this.#onChange(ev));
    this.element.addEventListener("input", ev => this.#onInput(ev));
    this.element.addEventListener("dragover", ev => { if (ev.target.closest(".pf-drop")) ev.preventDefault(); });
    this.element.addEventListener("drop", ev => this.#onDrop(ev));
  }

  /* ---------------- markup ---------------- */

  #html() {
    const v = view({ gm: true });
    const open = v.ledger.filter(isOpenEntry).length;
    const tabs = TABS.map(k => `<a class="pf-tab ${k === this.#tab ? "active" : ""}" data-tab="${k}"><i class="fa-solid ${TAB_ICONS[k]}"></i> ${esc(t(`Console.Tab.${k}`))}${k === "ledger" && open ? ` <span class="pf-count">${open}</span>` : ""}</a>`).join("");
    const bar = `<div class="pf-bar">
      <label class="pf-field" ${tip(t("Console.SessionHint"))}><i class="fa-solid fa-calendar-day"></i> <input type="text" name="session" value="${esc(setting("session"))}" placeholder="${esc(t("Console.SessionPlaceholder"))}"></label>
      <label class="pf-field pf-grow" ${tip(t("Console.ReasonHint"))}><i class="fa-solid fa-feather"></i> <input type="text" name="reason" value="${esc(this.#reason)}" placeholder="${esc(t("Console.ReasonPlaceholder"))}"></label>
      ${btn("preview", "fa-eye", "", "", "icon", tip(t("Console.Preview")))}
      ${btn("show-players", "fa-users-viewfinder", "", "", "icon", tip(t("Console.ShowPlayers")))}</div>`;
    const body = { factions: () => this.#factions(v), contacts: () => this.#contacts(v), ledger: () => this.#ledger(v), history: () => this.#history(), pack: () => this.#pack(v) }[this.#tab]();
    return `<nav class="pf-tabs">${tabs}</nav>${bar}<section class="pf-body">${body}</section>`;
  }

  /* ---------- factions ---------- */

  #factions(v) {
    const all = v.factions;
    if (!all.length) return `<p class="pf-empty">${esc(t("Console.NoFactions"))}</p>${this.#addFactionForm()}`;
    const q = fold(this.#search);
    const shown = all.filter(f => (!q || fold(`${f.name} ${f.epithet} ${f.id}`).includes(q))
      && (this.#filter === "all" || (this.#filter === "known" && f.known) || (this.#filter === "active" && (f.touched || f.party || f.heroes.some(h => h.score || h.member)))));
    const groups = new Map();
    for (const f of shown) {
      const g = f.group || t(`Kind.${f.kind}`) || "";
      if (!groups.has(g)) groups.set(g, []);
      groups.get(g).push(f);
    }
    const toolbar = `<div class="pf-row">
      <input type="search" name="search" value="${esc(this.#search)}" placeholder="${esc(t("Console.Search"))}">
      <select name="filter">${options(["all", "known", "active"], this.#filter, k => t(`Console.Filter.${k}`))}</select>
      <span class="pf-hint">${esc(t("Console.FactionsHint"))}</span></div>`;
    const list = [...groups.entries()].map(([g, list]) => `<h3 class="pf-sub">${esc(g)}</h3>${list.map((f, i) => this.#factionCard(f, all.indexOf(f))).join("")}`).join("");
    return `${toolbar}${list || `<p class="pf-empty">${esc(t("Console.NoMatch"))}</p>`}${this.#addFactionForm()}`;
  }

  #factionCard(f, index) {
    const open = this.#open.has(f.id);
    const color = f.color || PALETTE[index % PALETTE.length];
    const d = `data-faction="${esc(f.id)}"`;
    const members = f.heroes.filter(h => h.member);
    const head = `<header class="pf-fhead" data-act="toggle" ${d}>
      <span class="pf-swatch" style="background:${esc(color)}"></span>
      <div class="pf-who"><strong>${esc(f.name)}</strong>${f.epithet ? ` <small>${esc(f.epithet)}</small>` : ""}</div>
      <span class="pf-att a-${f.attitude}" ${tip(t(`Attitude.${f.attitude}`))}><i class="fa-solid ${ATTITUDE_ICON[f.attitude]}"></i></span>
      ${showParty() ? `<span class="pf-score" ${tip(t("Console.PartyRenown"))}>${f.party}</span>` : ""}
      ${members.length ? `<span class="pf-chip" ${tip(members.map(h => h.name).join(", "))}><i class="fa-solid fa-id-badge"></i> ${members.length}</span>` : ""}
      ${btn("known", f.known ? "fa-eye" : "fa-eye-slash", "", d, `icon ${f.known ? "on" : ""}`, tip(t(f.known ? "Console.KnownOn" : "Console.KnownOff")))}
      <i class="fa-solid ${open ? "fa-chevron-up" : "fa-chevron-down"} pf-caret"></i></header>`;
    if (!open) return `<div class="pf-card pf-faction" data-card="${esc(f.id)}" style="--pf-color:${esc(color)}">${head}</div>`;
    const def = f.def;
    const facts = [
      def.leader && `<span><i class="fa-solid fa-crown"></i> ${esc(local(def.leader))}</span>`,
      def.base && `<span><i class="fa-solid fa-building-columns"></i> ${esc(local(def.base))}</span>`,
      def.plane && `<span><i class="fa-solid fa-circle-nodes"></i> ${esc(local(def.plane))}</span>`
    ].filter(Boolean).join("");
    const name = id => local(defs().factions.find(x => x.id === id)?.name) || id;
    const rel = [
      f.allies.length && `<span class="pf-rel ally"><i class="fa-solid fa-handshake-simple"></i> ${f.allies.map(id => `<a data-act="goto" data-faction="${esc(id)}">${esc(name(id))}</a>`).join(", ")}</span>`,
      f.rivals.length && `<span class="pf-rel rival"><i class="fa-solid fa-hand-fist"></i> ${f.rivals.map(id => `<a data-act="goto" data-faction="${esc(id)}">${esc(name(id))}</a>`).join(", ")}</span>`
    ].filter(Boolean).join("");
    const awards = (target, data) => AWARDS.map(a => btn("award", a.delta > 0 ? "fa-plus" : "fa-minus", `${a.delta > 0 ? "+" : ""}${a.delta}`, `${data} data-delta="${a.delta}" data-award="${a.key}"`, `pf-award ${a.delta < 0 ? "neg" : ""}`, tip(t(`Award.${a.key}`)))).join("");
    const party = showParty() ? `<div class="pf-block"><h4>${esc(t("Console.PartyRenown"))}</h4>
      <div class="pf-row"><input type="number" min="0" class="pf-num" data-renown="party" ${d} value="${f.party}">
        ${awards("party", `${d} data-target="party"`)}
        ${f.recognized ? `<span class="pf-tag ok" ${tip(t("Console.RecognizedHint", { n: RECOGNITION }))}>${esc(t("Console.Recognized"))}</span>` : ""}</div>
      ${f.partyPerks.length ? `<ul class="pf-perks">${f.partyPerks.map(p => `<li>${esc(p)}</li>`).join("")}</ul>` : ""}</div>` : "";
    const heroRows = f.heroes.map(h => {
      const hd = `${d} data-target="${h.id}"`;
      const actor = game.actors.get(h.id);
      const lvl = Number(actor?.system?.details?.level) || 0;
      return `<tr>
        <td><strong>${esc(h.name)}</strong></td>
        <td><input type="checkbox" data-member="${h.id}" ${d} ${h.member ? "checked" : ""} ${tip(t("Console.Member"))}></td>
        <td class="pf-scorecell"><input type="number" min="0" class="pf-num" data-renown="${h.id}" ${d} value="${h.score}">
          ${btn("award", "fa-minus", "", `${hd} data-delta="-1"`, "icon neg")}${btn("award", "fa-plus", "", `${hd} data-delta="1"`, "icon")}${btn("award", "fa-angles-up", "", `${hd} data-delta="2" data-award="mission"`, "icon", tip(t("Award.mission")))}</td>
        <td>${h.member ? esc(h.rank || "—") : `<span class="pf-hint">${esc(t("Console.NotMember"))}</span>`}${h.next ? `<br><small>${esc(t("Console.NextRank", { name: h.next.name, n: h.next.min }))}</small>` : ""}</td>
        <td><small>${h.recognized ? `<i class="fa-solid fa-handshake" ${tip(t("Console.RecognizedHint", { n: RECOGNITION }))}></i> ` : ""}${h.downtime ? esc(t("Console.Downtime", { n: h.downtime })) : ""}</small>
          ${lvl ? `<br><small class="pf-hint" ${tip(t("Console.LevelRenownHint"))}>${esc(t("Console.LevelRenown", { n: levelRenown(lvl) }))}</small>` : ""}</td></tr>`;
    }).join("");
    const heroes = showHeroes() ? `<div class="pf-block"><h4>${esc(t("Console.Heroes"))}</h4>
      ${heroRows ? `<table class="pf-grid"><thead><tr><th></th><th>${esc(t("Console.Member"))}</th><th>${esc(t("Console.Renown"))}</th><th>${esc(t("Console.Rank"))}</th><th></th></tr></thead><tbody>${heroRows}</tbody></table>` : `<p class="pf-hint">${esc(t("Console.NoHeroes"))}</p>`}</div>` : "";
    const missions = def.missions?.length || defs().missions.length;
    return `<div class="pf-card pf-faction open" data-card="${esc(f.id)}" style="--pf-color:${esc(color)}">${head}
      ${f.motto ? `<p class="pf-motto">${esc(f.motto)}</p>` : ""}
      ${facts ? `<p class="pf-facts">${facts}</p>` : ""}${rel ? `<p class="pf-facts">${rel}</p>` : ""}
      <div class="pf-row"><label class="pf-field">${esc(t("Console.Attitude"))} <select data-attitude ${d}>${options(ATTITUDES, f.attitude, a => t(`Attitude.${a}`))}</select></label>
        ${missions ? btn("mission", "fa-dice", t("Console.RollMission"), d) : ""}
        ${def.custom ? btn("delete-faction", "fa-trash", "", d, "icon", tip(t("Console.DeleteFaction"))) : ""}</div>
      ${party}${heroes}
      ${f.gmNotes ? `<p class="pf-gmnotes"><i class="fa-solid fa-user-secret"></i> ${esc(f.gmNotes)}</p>` : ""}
      <label class="pf-field pf-col">${esc(t("Console.Notes"))}<textarea rows="2" data-notes ${d}>${esc(f.notes)}</textarea></label></div>`;
  }

  #addFactionForm() {
    return `<details class="pf-card pf-add"><summary><i class="fa-solid fa-plus"></i> ${esc(t("Console.AddFaction"))}</summary>
      <div class="pf-row"><input type="text" name="newFactionName" placeholder="${esc(t("Console.FactionName"))}">
      <input type="text" name="newFactionEpithet" placeholder="${esc(t("Console.FactionEpithet"))}">
      <input type="color" name="newFactionColor" value="#8a6d3b">
      ${btn("add-faction", "fa-plus", t("Console.Add"), "", "primary")}</div></details>`;
  }

  /* ---------- contacts ---------- */

  #factionSelect(name, current, data = "", empty = "—") {
    const fs = defs().factions;
    return `<select name="${name}" ${data}><option value="">${esc(empty)}</option>${fs.map(f => `<option value="${esc(f.id)}" ${f.id === current ? "selected" : ""}>${esc(local(f.name))}</option>`).join("")}</select>`;
  }

  #contacts(v) {
    const add = `<div class="pf-card pf-add-open"><div class="pf-row">
      <input type="text" name="newContactName" placeholder="${esc(t("Console.ContactName"))}">
      ${this.#factionSelect("newContactFaction", "", "", t("Console.NoFaction"))}
      ${btn("add-contact", "fa-plus", t("Console.Add"), "", "primary")}</div>
      <div class="pf-drop" data-drop="contact"><i class="fa-solid fa-user-plus"></i> ${esc(t("Console.DropActor"))}</div></div>`;
    const cards = v.contacts.map(c => {
      const d = `data-contact="${esc(c.id)}"`;
      const img = c.img || (c.actorUuid ? fromUuidSync?.(c.actorUuid)?.img : null);
      return `<div class="pf-card pf-contact" data-card="${esc(c.id)}"><header>
        ${img ? `<img src="${esc(img)}" alt="">` : `<i class="fa-solid fa-user pf-noimg"></i>`}
        <div class="pf-who"><input type="text" class="pf-title" data-cfield="name" ${d} value="${esc(c.name)}">
          <input type="text" data-cfield="role" ${d} value="${esc(c.role)}" placeholder="${esc(t("Console.Role"))}"></div>
        <span class="pf-att a-${c.attitude}"><i class="fa-solid ${ATTITUDE_ICON[c.attitude]}"></i></span>
        ${btn("contact-known", c.known ? "fa-eye" : "fa-eye-slash", "", d, `icon ${c.known ? "on" : ""}`, tip(t(c.known ? "Console.KnownOn" : "Console.KnownOff")))}
        ${c.actorUuid ? btn("contact-sheet", "fa-id-card", "", d, "icon", tip(t("Console.OpenSheet"))) : ""}
        ${btn("contact-delete", "fa-trash", "", d, "icon", tip(t("Console.Delete")))}</header>
        <div class="pf-row">
          <label class="pf-field">${esc(t("Console.Faction"))} ${this.#factionSelect("", c.faction, `data-cfield="faction" ${d}`, t("Console.NoFaction"))}</label>
          <label class="pf-field">${esc(t("Console.Attitude"))} <select data-cfield="attitude" ${d}>${options(ATTITUDES, c.attitude, a => t(`Attitude.${a}`))}</select></label>
          <label class="pf-field">${esc(t("Console.Met"))} <input type="text" class="pf-short" data-cfield="met" ${d} value="${esc(c.met)}" placeholder="${esc(t("Console.SessionPlaceholder"))}"></label></div>
        <label class="pf-field pf-col">${esc(t("Console.Offers"))}<input type="text" data-cfield="offers" ${d} value="${esc(c.offers)}" placeholder="${esc(t("Console.OffersPlaceholder"))}"></label>
        <label class="pf-field pf-col">${esc(t("Console.Notes"))}<textarea rows="2" data-cfield="notes" ${d}>${esc(c.notes)}</textarea></label></div>`;
    }).join("");
    return `${add}${cards || `<p class="pf-empty">${esc(t("Console.NoContacts"))}</p>`}`;
  }

  /* ---------- ledger ---------- */

  #withSelect() {
    const fs = defs().factions, cs = state().contacts;
    return `<select name="newEntryWith"><option value="">${esc(t("Console.WithOther"))}</option>
      ${cs.length ? `<optgroup label="${esc(t("Console.Tab.contacts"))}">${cs.map(c => `<option value="contact:${esc(c.id)}">${esc(local(c.name))}</option>`).join("")}</optgroup>` : ""}
      ${fs.length ? `<optgroup label="${esc(t("Console.Tab.factions"))}">${fs.map(f => `<option value="faction:${esc(f.id)}">${esc(local(f.name))}</option>`).join("")}</optgroup>` : ""}</select>`;
  }

  #ledger(v) {
    const hs = heroes();
    const add = `<details class="pf-card pf-add" ${v.ledger.length ? "" : "open"}><summary><i class="fa-solid fa-plus"></i> ${esc(t("Console.AddEntry"))}</summary>
      <div class="pf-row"><select name="newEntryKind">${options(LEDGER_KINDS, "debt", k => t(`Kind.${k}Long`))}</select>
        ${this.#withSelect()}<input type="text" name="newEntryName" placeholder="${esc(t("Console.WithName"))}"></div>
      <div class="pf-row pf-who-pick"><span class="pf-hint">${esc(t("Console.Who"))}</span>${hs.map(h => `<label><input type="checkbox" name="newEntryWho" value="${h.id}"> ${esc(h.name)}</label>`).join("")}<span class="pf-hint">${esc(t("Console.WhoHint"))}</span></div>
      <div class="pf-row"><input type="text" class="pf-grow" name="newEntryWhat" placeholder="${esc(t("Console.What"))}">
        <select name="newEntryWeight">${options(WEIGHTS, 1, n => t(`Weight.${n}`))}</select>
        <label ${tip(t("Console.KnownHint"))}><input type="checkbox" name="newEntryKnown" checked> ${esc(t("Console.Known"))}</label>
        ${btn("add-entry", "fa-plus", t("Console.Add"), "", "primary")}</div></details>`;
    const filter = `<div class="pf-row"><select name="ledgerFilter">${options(["open", "all", "closed"], this.#ledgerFilter, k => t(`Console.LedgerFilter.${k}`))}</select>
      <span class="pf-hint">${esc(t("Console.LedgerHint"))}</span></div>`;
    const list = v.ledger.filter(e => this.#ledgerFilter === "all" || (this.#ledgerFilter === "open") === isOpenEntry(e));
    const cards = list.map(e => {
      const d = `data-entry="${esc(e.id)}"`;
      const next = { open: ["called", "paid", "broken", "forgiven"], called: ["paid", "broken", "forgiven", "open"] }[e.status] ?? ["open"];
      const icons = { open: "fa-rotate-left", called: "fa-bell", paid: "fa-check", broken: "fa-heart-crack", forgiven: "fa-dove" };
      return `<div class="pf-card pf-entry k-${e.kind} s-${e.status}" data-card="${esc(e.id)}"><header>
        <i class="fa-solid ${e.kind === "debt" ? "fa-arrow-right-from-bracket" : "fa-arrow-right-to-bracket"} pf-kind" ${tip(t(`Kind.${e.kind}Long`))}></i>
        <div class="pf-who"><strong>${esc(e.withName)}</strong> <small>${esc(t(e.kind === "debt" ? "Console.TheyAreOwed" : "Console.TheyOwe", { who: e.whoName ?? t("Common.Party") }))}</small></div>
        <span class="pf-weight w${e.weight}" ${tip(t(`Weight.${e.weight}`))}>${"◆".repeat(e.weight)}</span>
        <span class="pf-status s-${e.status}">${esc(t(`Status.${e.status}`))}</span>
        ${btn("entry-known", e.known ? "fa-eye" : "fa-eye-slash", "", d, `icon ${e.known ? "on" : ""}`, tip(t(e.known ? "Console.KnownOn" : "Console.KnownOff")))}
        ${btn("entry-delete", "fa-trash", "", d, "icon", tip(t("Console.Delete")))}</header>
        <input type="text" class="pf-what" data-efield="what" ${d} value="${esc(e.what)}">
        <div class="pf-row small">${next.map(s => btn("entry-status", icons[s], t(`Console.To.${s}`), `${d} data-status="${s}"`, s === "called" ? "primary" : "")).join("")}
          <select data-efield="weight" ${d}>${options(WEIGHTS, e.weight, n => t(`Weight.${n}`))}</select>
          <input type="text" class="pf-short" data-efield="due" ${d} value="${esc(e.due)}" placeholder="${esc(t("Console.Due"))}">
          <small class="pf-hint">${esc(String(e.date ?? "").slice(0, 10))}${e.session ? ` · ${esc(e.session)}` : ""}</small></div>
        <textarea rows="1" data-efield="notes" ${d} placeholder="${esc(t("Console.EntryNotes"))}">${esc(e.notes)}</textarea>
        ${e.log?.length ? `<p class="pf-log">${e.log.map(l => `${esc(String(l.date).slice(0, 10))}${l.session ? ` (${esc(l.session)})` : ""}: ${esc(t(`Status.${l.from}`))} → ${esc(t(`Status.${l.to}`))}`).join(" · ")}</p>` : ""}</div>`;
    }).join("");
    return `${add}${filter}${cards || `<p class="pf-empty">${esc(t("Console.NoEntries"))}</p>`}`;
  }

  /* ---------- history ---------- */

  #history() {
    const rows = [...state().history].reverse().slice(0, 150).map(h => `<tr><td>${esc(String(h.date ?? "").slice(0, 10))}</td><td>${esc(h.session ?? "")}</td><td>${esc(historyLine(h))}</td></tr>`).join("");
    return `<div class="pf-row">${btn("page-open", "fa-book-open", t("Console.OpenPage"))}${btn("page-sync", "fa-arrows-rotate", t("Console.SyncPage"))}${btn("page-copy", "fa-copy", t("Console.CopyMarkdown"))}</div>
      <p class="pf-hint">${esc(t("Console.PageHint"))}</p>
      <table class="pf-grid"><thead><tr><th>${esc(t("Page.Col.date"))}</th><th>${esc(t("Page.Col.session"))}</th><th></th></tr></thead>
      <tbody>${rows || `<tr><td colspan="3">${esc(t("Page.None"))}</td></tr>`}</tbody></table>`;
  }

  /* ---------- pack ---------- */

  #pack(v) {
    const d = defs();
    const pack = importedPack();
    const custom = state().custom;
    const ranks = d.ranks.map(r => `<li><strong>${r.min}+</strong> ${esc(local(r.name))}</li>`).join("");
    const perks = d.perks.map(p => `<li><strong>${p.min}+</strong> ${esc(local(p.text ?? p.name))}</li>`).join("");
    return `<div class="pf-card"><h3>${esc(local(d.name) || d.id)}</h3>
        <p class="pf-hint">${esc(pack ? t("Pack.Imported", { name: local(pack.name) || pack.id }) : t("Pack.Default"))}</p>
        ${d.description ? `<p>${esc(local(d.description))}</p>` : ""}
        <p class="pf-hint">${esc(t("Pack.Counts", { factions: d.factions.length, contacts: d.contacts.length, ledger: d.ledger.length, missions: d.missions.length }))}</p>
        <div class="pf-row">${btn("pack-pick", "fa-file-import", t("Pack.Import"))}${btn("pack-export", "fa-file-export", t("Pack.Export"))}${pack ? btn("pack-reset", "fa-rotate", t("Pack.Reset")) : ""}${btn("state-export", "fa-floppy-disk", t("Pack.Backup"))}</div></div>
      <div class="pf-card"><h3>${esc(t("Pack.Ranks"))}</h3><ul class="pf-list">${ranks || `<li>${esc(t("Page.None"))}</li>`}</ul>
        <h3>${esc(t("Pack.Perks"))}</h3><ul class="pf-list">${perks || `<li>${esc(t("Page.None"))}</li>`}</ul>
        <p class="pf-hint">${esc(t("Pack.RanksHint"))}</p></div>
      ${custom.length ? `<div class="pf-card"><h3>${esc(t("Pack.Custom"))}</h3><ul class="pf-list">${custom.map(f => `<li>${esc(local(f.name))} <code>${esc(f.id)}</code></li>`).join("")}</ul></div>` : ""}`;
  }

  /* ---------------- events ---------------- */

  #takeReason() {
    const r = this.#reason;
    this.#reason = "";
    return r;
  }

  #onInput(ev) {
    const el = ev.target;
    if (el.name === "reason") this.#reason = el.value;
    if (el.name === "search") {
      this.#search = el.value;
      clearTimeout(this.#searchTimer);
      this.#searchTimer = setTimeout(() => this.render().then(() => {
        const s = this.element.querySelector("[name=search]");
        if (s) { s.focus(); s.setSelectionRange(s.value.length, s.value.length); }
      }), 250);
    }
  }

  async #onChange(ev) {
    const el = ev.target;
    const fid = el.dataset.faction;
    try {
      if (el.name === "session") { await setSetting("session", el.value.trim()); return; }
      if (el.name === "filter") { this.#filter = el.value; return this.render(); }
      if (el.name === "ledgerFilter") { this.#ledgerFilter = el.value; return this.render(); }
      if (el.dataset.renown && fid) {
        await act.renownTo(fid, el.dataset.renown, Number(el.value), { reason: this.#takeReason() });
        return this.refreshSoon();
      }
      if (el.hasAttribute("data-attitude") && fid) { await act.attitude(fid, el.value, { reason: this.#takeReason() }); return this.refreshSoon(); }
      if (el.dataset.member && fid) { await act.member(fid, el.dataset.member, el.checked, { reason: this.#takeReason() }); return this.refreshSoon(); }
      if (el.hasAttribute("data-notes") && fid) { await act.notes(fid, el.value); return; }
      if (el.dataset.cfield && el.dataset.contact) {
        await act.contactUpdate(el.dataset.contact, { [el.dataset.cfield]: el.value.trim() || (el.dataset.cfield === "faction" ? null : "") });
        if (["faction", "attitude"].includes(el.dataset.cfield)) this.refreshSoon();
        return;
      }
      if (el.dataset.efield && el.dataset.entry) {
        const value = el.dataset.efield === "weight" ? Number(el.value) : el.value.trim();
        await act.entryUpdate(el.dataset.entry, { [el.dataset.efield]: value });
        if (el.dataset.efield === "weight") this.refreshSoon();
      }
    } catch (err) { console.warn(`${MODULE_ID} |`, err); ui.notifications.warn(err.message); this.refreshSoon(); }
  }

  async #onClick(ev) {
    const tab = ev.target.closest("[data-tab]");
    if (tab) { this.#tab = tab.dataset.tab; return this.render(); }
    const el = ev.target.closest("[data-act]");
    if (!el || el.disabled) return;
    // Clicks on inputs inside the header must not fold the card.
    if (el.dataset.act === "toggle" && ev.target.closest("button, input, select, a")) return;
    ev.preventDefault();
    const fid = el.dataset.faction;
    const q = sel => this.element.querySelector(sel);
    try {
      switch (el.dataset.act) {
        case "toggle": this.#open.has(fid) ? this.#open.delete(fid) : this.#open.add(fid); return this.render();
        case "goto": this.#open.add(fid); this.#focus = fid; this.#search = ""; this.#filter = "all"; return this.render();
        case "known": {
          const f = view({ gm: true }).factions.find(x => x.id === fid);
          await act.reveal(fid, !f?.known);
          break;
        }
        case "award": {
          const reason = this.#takeReason() || (el.dataset.award ? t(`Award.${el.dataset.award}`) : "");
          await act.renown(fid, el.dataset.target, Number(el.dataset.delta), { reason });
          break;
        }
        case "mission": await act.rollMission(fid); break;
        case "delete-faction":
          if (await DialogV2.confirm({ window: { title: t("Console.DeleteFaction") }, content: `<p>${esc(t("Console.DeleteFactionConfirm"))}</p>` })) await act.deleteFaction(fid);
          break;
        case "add-faction": {
          const name = q("[name=newFactionName]")?.value.trim();
          if (!name) return warn("Notify.NeedName");
          const f = await act.addFaction({ name, epithet: q("[name=newFactionEpithet]")?.value.trim() || null, color: q("[name=newFactionColor]")?.value || null });
          this.#open.add(f.id); this.#focus = f.id;
          break;
        }
        case "add-contact": {
          const name = q("[name=newContactName]")?.value.trim();
          if (!name) return warn("Notify.NeedName");
          const c = await act.contactAdd({ name, faction: q("[name=newContactFaction]")?.value || null, met: setting("session") });
          this.#focus = c.id;
          break;
        }
        case "contact-known": {
          const c = state().contacts.find(x => x.id === el.dataset.contact);
          await act.contactUpdate(el.dataset.contact, { known: !c?.known });
          break;
        }
        case "contact-sheet": {
          const c = state().contacts.find(x => x.id === el.dataset.contact);
          (await fromUuid(c?.actorUuid))?.sheet?.render(true);
          break;
        }
        case "contact-delete":
          if (await DialogV2.confirm({ window: { title: t("Console.Delete") }, content: `<p>${esc(t("Console.DeleteContactConfirm"))}</p>` })) await act.contactDelete(el.dataset.contact);
          break;
        case "add-entry": {
          const what = q("[name=newEntryWhat]")?.value.trim();
          if (!what) return warn("Notify.NeedWhat");
          const pick = q("[name=newEntryWith]")?.value ?? "";
          const typed = q("[name=newEntryName]")?.value.trim();
          const [type, id] = pick.split(":");
          const withData = type === "faction" ? { faction: id } : type === "contact" ? { contact: id } : { name: typed };
          if (!withData.faction && !withData.contact && !typed) return warn("Notify.NeedWith");
          const who = [...this.element.querySelectorAll("[name=newEntryWho]:checked")].map(x => x.value);
          const e = await act.entryAdd({
            kind: q("[name=newEntryKind]")?.value, with: withData, who, what,
            weight: Number(q("[name=newEntryWeight]")?.value) || 1, known: !!q("[name=newEntryKnown]")?.checked, notes: this.#takeReason()
          });
          this.#focus = e.id;
          this.#ledgerFilter = isOpenEntry(e) ? this.#ledgerFilter : "all";
          break;
        }
        case "entry-status": await act.entryStatus(el.dataset.entry, el.dataset.status, { reason: this.#takeReason() }); break;
        case "entry-known": {
          const e = state().ledger.find(x => x.id === el.dataset.entry);
          await act.entryUpdate(el.dataset.entry, { known: !e?.known });
          break;
        }
        case "entry-delete":
          if (await DialogV2.confirm({ window: { title: t("Console.Delete") }, content: `<p>${esc(t("Console.DeleteEntryConfirm"))}</p>` })) await act.entryDelete(el.dataset.entry);
          break;
        case "preview": {
          const { StandingWindow } = await import("./standing.mjs");
          StandingWindow.open({ preview: true });
          break;
        }
        case "show-players": {
          const n = showToPlayers();
          info(n ? "Notify.Shown" : "Notify.NoPlayers", { n });
          break;
        }
        case "page-open": { const p = await page() ?? await serial(syncPage); p?.parent?.sheet?.render(true, { pageId: p.id }); break; }
        case "page-sync": await serial(syncPage); info("Notify.Synced"); break;
        case "page-copy": {
          const md = markdown();
          if (game.clipboard?.copyPlainText) await game.clipboard.copyPlainText(md); else await navigator.clipboard.writeText(md);
          info("Notify.Copied");
          break;
        }
        case "pack-pick": this.#pickPack(); break;
        case "pack-export": this.#save(importedPack() ?? { schema: 1, id: "my-factions", name: "My factions", factions: [], contacts: [], ledger: [], missions: [] }, "factions-pack"); break;
        case "pack-reset": if (await DialogV2.confirm({ window: { title: t("Pack.Reset") }, content: `<p>${esc(t("Pack.ResetConfirm"))}</p>` })) await resetPack(); break;
        case "state-export": this.#save(state(), `factions-state-${new Date().toISOString().slice(0, 10)}`); break;
      }
    } catch (err) {
      console.warn(`${MODULE_ID} |`, err);
      ui.notifications.warn(err.message);
    }
    this.refreshSoon();
  }

  /** Drop an Actor (an NPC) on the contacts tab: a contact with its name, portrait and a link to the sheet. */
  async #onDrop(ev) {
    const zone = ev.target.closest(".pf-drop");
    if (!zone) return;
    ev.preventDefault();
    const TE = foundry.applications?.ux?.TextEditor?.implementation ?? globalThis.TextEditor;
    let data;
    try { data = TE?.getDragEventData ? TE.getDragEventData(ev) : JSON.parse(ev.dataTransfer.getData("text/plain")); }
    catch { return; }
    if (data?.type !== "Actor") return warn("Notify.DropActor");
    const actor = data.uuid ? await fromUuid(data.uuid) : null;
    if (!actor) return;
    const sel = this.element.querySelector("[name=newContactFaction]")?.value || null;
    const c = await act.contactAdd({ name: actor.name, img: actor.img, actorUuid: actor.uuid, faction: sel, met: setting("session") });
    this.#focus = c.id;
    info("Notify.ContactAdded", { name: actor.name });
    this.refreshSoon();
  }

  /** The file input lives outside the panel: a re-render would replace it before the change event. */
  #pickPack() {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json,application/json";
    input.style.display = "none";
    input.addEventListener("change", async () => {
      const file = input.files?.[0];
      input.remove();
      if (!file) return;
      try {
        const data = JSON.parse(await file.text());
        const errors = await importPack(data);
        if (errors.length) {
          ui.notifications.error(t("Pack.Invalid", { n: errors.length }));
          console.warn(`${MODULE_ID} | pack problems:\n- ${errors.join("\n- ")}`);
        } else info("Pack.Loaded", { name: localText(data.name, textLang()) || data.id });
      } catch (err) {
        ui.notifications.error(t("Pack.BadJSON"));
        console.warn(`${MODULE_ID} | pack import failed`, err);
      }
      this.refreshSoon();
    }, { once: true });
    document.body.append(input);
    input.click();
  }

  #save(data, name) {
    const save = foundry.utils.saveDataToFile ?? globalThis.saveDataToFile;
    save?.(JSON.stringify(data, null, 2), "application/json", `${data?.id && name === "factions-pack" ? data.id : name}.json`);
  }
}
