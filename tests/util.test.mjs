import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  rankFor, nextRank, perksFor, recognized, downtimeDays, levelRenown, clampRenown, validatePack, mergePacks,
  localText, fold, slugify, findFaction, findContact, findHero, tokenize, parseRenown, parseAttitude, parseLedger,
  parseAttitudeWord, emptyState, normalizeState, standingOf, changeRenown, setRenown, setAttitude, setKnown, setMember,
  addContact, updateContact, removeContact, addEntry, updateEntry, setEntryStatus, removeEntry, sortLedger, seedFromPack,
  addCustomFaction, removeCustomFaction, buildView, pageMarkdown, withLabel, whoLabel, escapeHTML, HISTORY_CAP, ranksOf
} from "../scripts/util.mjs";

const base = JSON.parse(readFileSync(new URL("../data/default-pack.json", import.meta.url), "utf8"));

/** A small made-up pack, like a campaign would import. */
const pack = {
  schema: 1, id: "test",
  name: { en: "Test", el: "Δοκιμή" },
  ranks: [{ min: 1, name: { en: "Sworn", el: "Ορκισμένος" } }, { min: 10, name: "Captain" }],
  factions: [
    { id: "lamplighters", name: { en: "The Lamplighters", el: "Οι Λαμπαδηφόροι" }, epithet: { en: "Wicks", el: "Φιτίλια" }, aliases: ["lamps"], kind: "faction", allies: ["ferrymen"], rivals: ["gloom"] },
    { id: "ferrymen", name: "Ferrymen's Guild", kind: "minor", attitude: "friendly", known: true },
    { id: "gloom", name: "The Gloom", kind: "faction", attitude: "hostile", ranks: [{ min: 2, name: "Shade" }] }
  ],
  missions: [{ text: "Find the missing lamp." }],
  contacts: [{ id: "old-wick", name: "Old Wick", faction: "lamplighters", attitude: "friendly" }],
  ledger: [{ id: "toll", kind: "debt", with: { faction: "ferrymen" }, who: ["Ilka", "Nobody Known"], what: { en: "The crossing toll", el: "Το εισιτήριο" }, weight: 2 },
           { id: "favor", kind: "favour", with: { contact: "old-wick" }, what: "A lamp lit in time", known: true }]
};
const defs = () => mergePacks(base, pack);
const def = id => defs().factions.find(f => f.id === id);
const heroes = [{ id: "a1", name: "Ilka Thorn" }, { id: "a2", name: "Bram" }];
let n = 0;
const ctx = (extra = {}) => ({ id: `h${++n}`, historyId: `hh${n}`, date: "2026-10-16T20:00:00Z", session: "S01", ...extra });

test("the shipped pack is valid, generic, and has text in both languages", () => {
  assert.deepEqual(validatePack(base), []);
  assert.equal(base.factions.length, 0);
  for (const list of [base.ranks, base.perks, base.missions]) for (const x of list) {
    const text = x.name ?? x.text;
    assert.ok(text.en && text.el, JSON.stringify(x));
  }
  assert.deepEqual(base.ranks.map(r => r.min), [1, 10, 25, 50]);
  assert.deepEqual(base.perks.map(r => r.min), [3, 10, 50]);
});

test("DMG renown rules: ranks, perks, recognition, downtime, level-based", () => {
  const ranks = base.ranks;
  assert.equal(rankFor(0, ranks), null);
  assert.equal(rankFor(1, ranks).name.en, "Associate");
  assert.equal(rankFor(24, ranks).name.en, "Trusted");
  assert.equal(rankFor(99, ranks).name.en, "Inner circle");
  assert.equal(nextRank(3, ranks).min, 10);
  assert.equal(nextRank(50, ranks), null);
  assert.equal(perksFor(2, base.perks).length, 0);
  assert.equal(perksFor(10, base.perks).length, 2);
  assert.equal(recognized(2), false);
  assert.equal(recognized(3), true);
  assert.equal(downtimeDays(0), null);
  assert.equal(downtimeDays(4), 40);
  assert.deepEqual([0, 1, 2, 3, 4, 5, 10, 11, 16, 17, 20].map(levelRenown), [0, 1, 1, 3, 3, 10, 10, 25, 25, 50, 50]);
  assert.equal(clampRenown(-3), 0);
  assert.equal(clampRenown("7"), 7);
});

test("pack validation catches what the engine relies on", () => {
  assert.deepEqual(validatePack(pack), []);
  assert.deepEqual(validatePack(null), ["not an object"]);
  const bad = structuredClone(pack);
  bad.schema = 2;
  bad.factions.push({ id: "lamplighters", name: "dupe" }, { id: "bad id!", name: "" }, { id: "x", name: "X", kind: "cult", attitude: "angry" });
  bad.factions[0].allies.push("nobody");
  bad.ledger.push({ id: "toll", kind: "loan", with: {}, what: "", weight: 7 });
  bad.contacts.push({ id: "c2", name: "C", faction: "ghost" });
  const errors = validatePack(bad).join("\n");
  for (const bit of ["schema must be 1", "duplicate id", "id must be letters", "name is missing", "kind must be", "attitude must be", "unknown faction \"nobody\"", "kind must be debt or favour", "what is missing", "with needs", "weight must be", "unknown faction \"ghost\"", "duplicate id toll"]) {
    assert.ok(errors.includes(bit), bit);
  }
});

test("merging: pack factions on top of the shipped ones, then the world's own; ladders from the pack", () => {
  const d = mergePacks(base, pack, [{ id: "my-club", name: "My Club" }]);
  assert.deepEqual(d.factions.map(f => f.id), ["lamplighters", "ferrymen", "gloom", "my-club"]);
  assert.equal(d.factions.find(f => f.id === "my-club").custom, true);
  assert.equal(d.ranks[0].name.en, "Sworn", "pack ranks replace the generic ones");
  assert.equal(d.perks.length, 3, "generic perks stay when the pack has none");
  assert.equal(d.missions.length, 1);
  assert.equal(ranksOf(def("gloom"), d)[0].name, "Shade", "a faction's own ladder wins");
  const plain = mergePacks(base, null);
  assert.equal(plain.factions.length, 0);
  assert.equal(plain.ranks.length, 4);
});

test("finding factions, contacts and heroes by what the GM types", () => {
  const fs = defs().factions;
  assert.equal(findFaction(fs, "lamplighters").id, "lamplighters");
  assert.equal(findFaction(fs, "LAMPS").id, "lamplighters");
  assert.equal(findFaction(fs, "Οι Λαμπαδηφόροι").id, "lamplighters");
  assert.equal(findFaction(fs, "οι λαμπαδηφοροι").id, "lamplighters", "accents and case don't matter");
  assert.equal(findFaction(fs, "wicks").id, "lamplighters", "by epithet");
  assert.equal(findFaction(fs, "Λαμπαδηφόροι").id, "lamplighters", "without the article");
  assert.equal(findFaction(fs, "gloom").id, "gloom");
  assert.equal(findFaction(fs, "the gloom").id, "gloom");
  assert.equal(findFaction(fs, "ferry").id, "ferrymen", "by prefix of 3+ letters");
  assert.equal(findFaction(fs, "fe"), null);
  assert.equal(findFaction(fs, ""), null);
  const contacts = [{ id: "c1", name: "Old Wick" }];
  assert.equal(findContact(contacts, "old wick").id, "c1");
  assert.equal(findContact(contacts, "Old").id, "c1");
  assert.equal(findHero(heroes, "ilka").id, "a1");
  assert.equal(findHero(heroes, "Ilka Thorn").id, "a1");
  assert.equal(findHero(heroes, "party"), null);
  assert.equal(findHero(heroes, "nobody"), null);
  assert.equal(fold("Ζοφερή  Σύναξη"), "ζοφερη συναξη");
  assert.equal(slugify("Bleak Cabal"), "bleak-cabal");
});

test("parsing journal buttons", () => {
  assert.deepEqual(tokenize('athar +2 "Ilka Thorn"'), ["athar", "+2", "Ilka Thorn"]);
  assert.deepEqual(parseRenown("athar +2"), { target: "athar", delta: 2, who: null });
  assert.deepEqual(parseRenown("bleak cabal -1 Ilka"), { target: "bleak cabal", delta: -1, who: "Ilka" });
  assert.deepEqual(parseRenown('athar 3 "Ilka Thorn"'), { target: "athar", delta: 3, who: "Ilka Thorn" });
  assert.equal(parseRenown("athar"), null);
  assert.equal(parseRenown("athar +0"), null);
  assert.equal(parseRenown("+2"), null);
  assert.deepEqual(parseAttitude("harmonium hostile"), { target: "harmonium", attitude: "hostile" });
  assert.deepEqual(parseAttitude("ring givers φιλική"), { target: "ring givers", attitude: "friendly" });
  assert.equal(parseAttitude("harmonium"), null);
  assert.equal(parseAttitudeWord("-"), "hostile");
  assert.deepEqual(parseLedger("shemeshka Nanouk w2"), { target: "shemeshka", who: ["Nanouk"], weight: 2 });
  assert.deepEqual(parseLedger('"The Lady" Ilka Bram'), { target: "The Lady", who: ["Ilka", "Bram"], weight: null });
  assert.deepEqual(parseLedger("ferrymen"), { target: "ferrymen", who: null, weight: null });
  assert.equal(parseLedger(""), null);
});

test("renown: party and heroes, never below 0, rank-ups, recognition, history", () => {
  const s = emptyState();
  const d = defs();
  const r1 = changeRenown(s, def("lamplighters"), "party", 2, ctx({ reason: "lit the street", defs: d }));
  assert.equal(r1.after, 2);
  assert.equal(r1.rankUp?.name.en, "Sworn", "rank thresholds are reported (the view only shows ranks to members)");
  const r2 = changeRenown(s, def("lamplighters"), "party", 1, ctx({ defs: d }));
  assert.equal(r2.recognizedNow, true);
  const r3 = changeRenown(s, def("lamplighters"), "a1", -4, ctx({ heroName: "Ilka", defs: d }));
  assert.equal(r3.after, 0, "never below 0");
  assert.equal(r3.entry.delta, 0);
  assert.equal(r3.entry.asked, -4);
  const r4 = changeRenown(s, def("lamplighters"), "a1", 10, ctx({ defs: d }));
  assert.equal(r4.rankUp.name, "Captain");
  const r5 = changeRenown(s, def("lamplighters"), "a1", -2, ctx({ defs: d }));
  assert.equal(r5.rankDown.name.en, "Sworn");
  const r6 = setRenown(s, def("lamplighters"), "party", 7, ctx({ defs: d }));
  assert.equal(r6.after, 7);
  assert.equal(s.factions.lamplighters.party, 7);
  assert.equal(s.factions.lamplighters.heroes.a1.score, 8);
  assert.equal(s.history.length, 6);
  assert.equal(s.history[0].reason, "lit the street");
  assert.equal(s.history[0].session, "S01");
});

test("attitude, known, membership and the defaults from the pack", () => {
  const s = emptyState();
  assert.equal(standingOf(s, def("gloom")).attitude, "hostile", "the pack's starting attitude");
  assert.equal(standingOf(s, def("ferrymen")).known, true, "the pack's starting known");
  assert.equal(standingOf(s, def("lamplighters")).touched, false);
  assert.ok(setAttitude(s, def("gloom"), "indifferent", ctx({ reason: "truce" })));
  assert.equal(setAttitude(s, def("gloom"), "indifferent", ctx()), null, "no change, no history");
  assert.throws(() => setAttitude(s, def("gloom"), "angry", ctx()));
  assert.ok(setKnown(s, def("gloom"), true, ctx()));
  assert.equal(setKnown(s, def("gloom"), true, ctx()), null);
  assert.ok(setMember(s, def("gloom"), "a2", true, ctx()));
  assert.equal(s.factions.gloom.heroes.a2.member, true);
  assert.equal(s.factions.gloom.heroes.a2.score, 0);
  assert.equal(standingOf(s, def("gloom")).touched, true);
});

test("contacts and the ledger", () => {
  const s = emptyState();
  const c = addContact(s, { name: "Mira", faction: "ferrymen", attitude: "nope" }, ctx());
  assert.equal(c.attitude, "indifferent");
  updateContact(s, c.id, { offers: "a boat at night", attitude: "friendly" });
  assert.equal(s.contacts[0].offers, "a boat at night");
  const e = addEntry(s, { kind: "favour", with: { contact: c.id }, who: ["a1"], what: "She owes Ilka a crossing", weight: 2, known: true }, ctx());
  const debt = addEntry(s, { kind: "debt", with: { faction: "gloom" }, what: "A name, given in the dark", weight: 3 }, ctx());
  assert.equal(debt.known, false, "unknown unless said");
  assert.equal(withLabel(e, defs(), s), "Mira");
  assert.equal(withLabel(debt, defs(), s), "The Gloom");
  assert.equal(whoLabel(e, heroes), "Ilka Thorn");
  assert.equal(whoLabel(debt, heroes), null, "the party");
  assert.ok(setEntryStatus(s, debt.id, "called", ctx({ reason: "midnight" })));
  assert.equal(setEntryStatus(s, debt.id, "called", ctx()), null);
  assert.equal(s.ledger[1].log[0].to, "called");
  assert.throws(() => setEntryStatus(s, debt.id, "lost", ctx()));
  setEntryStatus(s, e.id, "paid", ctx());
  assert.deepEqual(sortLedger(s.ledger).map(x => x.id), [debt.id, e.id], "open first");
  updateEntry(s, e.id, { weight: 9 });
  assert.equal(s.ledger[0].weight, 1, "bad weight falls back");
  assert.ok(removeContact(s, c.id));
  assert.deepEqual(s.ledger[0].with, { name: "Mira" }, "the entry keeps the name");
  assert.ok(removeEntry(s, debt.id));
  assert.equal(removeEntry(s, debt.id), false);
});

test("seeding from the pack happens once, and deleted seeds stay deleted", () => {
  const s = emptyState();
  assert.equal(seedFromPack(s, defs(), heroes), 3);
  assert.deepEqual(s.ledger[0].who, ["a1", "Nobody Known"], "hero names become actor ids when they match");
  assert.equal(whoLabel(s.ledger[0], heroes), "Ilka Thorn, Nobody Known");
  assert.equal(s.contacts[0].id, "seed-old-wick");
  assert.equal(s.ledger[1].with.contact, "seed-old-wick", "contact references follow the seed id");
  assert.equal(s.ledger[0].known, false);
  assert.equal(s.ledger[1].known, true);
  assert.equal(seedFromPack(s, defs()), 0, "idempotent");
  removeEntry(s, "seed-toll");
  assert.equal(seedFromPack(s, defs()), 0, "not resurrected");
});

test("factions made in the world get unique ids", () => {
  const s = emptyState();
  const a = addCustomFaction(s, { name: "Lamplighters" }, ["lamplighters"]);
  const b = addCustomFaction(s, { name: "Lamplighters" }, ["lamplighters"]);
  assert.equal(a.id, "lamplighters-2");
  assert.equal(b.id, "lamplighters-3");
  assert.ok(removeCustomFaction(s, a.id));
  assert.equal(removeCustomFaction(s, a.id), false);
});

test("the players' view hides everything they don't know, and GM notes", () => {
  const s = emptyState();
  seedFromPack(s, defs());
  changeRenown(s, def("lamplighters"), "party", 4, ctx());
  s.factions.lamplighters.notes = "secret plans";
  addContact(s, { name: "Hidden", known: false }, ctx());
  const gm = buildView(s, defs(), { gm: true, heroes, lang: "el" });
  const pl = buildView(s, defs(), { gm: false, heroes, lang: "el" });
  assert.equal(gm.factions.length, 3);
  assert.deepEqual(pl.factions.map(f => f.id), ["ferrymen"], "only known factions");
  assert.equal(gm.factions[0].name, "Οι Λαμπαδηφόροι");
  assert.equal(gm.factions[0].notes, "secret plans");
  assert.equal(gm.factions[0].recognized, true);
  assert.equal(gm.factions[0].partyPerks.length, 1);
  assert.ok(pl.factions.every(f => f.notes === "" && f.gmNotes === ""));
  assert.equal(pl.contacts.length, 0);
  assert.deepEqual(pl.ledger.map(e => e.id), ["seed-favor"]);
  assert.equal(pl.ledger[0].withName, "Old Wick");
  assert.equal(gm.ledger.find(e => e.id === "seed-toll").what, "Το εισιτήριο");
  const hero = gm.factions[0].heroes[0];
  assert.equal(hero.member, false);
  assert.equal(hero.rank, "", "no rank without membership");
});

test("history is capped", () => {
  const s = emptyState();
  for (let i = 0; i < HISTORY_CAP + 25; i++) changeRenown(s, def("ferrymen"), "party", 1, ctx());
  assert.equal(s.history.length, HISTORY_CAP);
  assert.equal(s.factions.ferrymen.party, HISTORY_CAP + 25);
});

test("normalizeState fills in what's missing and keeps what's there", () => {
  assert.deepEqual(normalizeState(null), emptyState());
  const s = normalizeState({ schema: 1, factions: { x: { party: 2 } }, ledger: "bad" });
  assert.equal(s.factions.x.party, 2);
  assert.deepEqual(s.ledger, []);
  assert.deepEqual(s.contacts, []);
});

test("the journal page: tables with escaped cells, known marks, history lines", () => {
  const s = emptyState();
  seedFromPack(s, defs());
  changeRenown(s, def("lamplighters"), "a1", 3, ctx({ heroName: "Ilka Thorn" }));
  setMember(s, def("lamplighters"), "a1", true, ctx());
  addEntry(s, { kind: "debt", with: { name: "A | B" }, what: "line one\nline two", known: true }, ctx());
  const L = {
    title: "Factions", intro: "intro", sections: { standing: "Standing", contacts: "Contacts", ledger: "Ledger", history: "History" },
    cols: Object.fromEntries(["faction", "attitude", "party", "heroes", "known", "contact", "offers", "kind", "with", "who", "what", "weight", "status", "session"].map(c => [c, c])),
    attitude: { hostile: "H", indifferent: "I", friendly: "F" }, kind: { debt: "Debt", favour: "Favour" },
    status: { open: "Open", called: "Called", paid: "Paid", broken: "Broken", forgiven: "Forgiven" },
    party: "party", none: "—", yes: "✓", member: "member", weight: w => "◆".repeat(w), history: h => h.kind
  };
  const md = pageMarkdown(buildView(s, defs(), { gm: true, heroes, lang: "en" }), s.history, L);
  assert.match(md, /^# Factions/);
  assert.match(md, /\| The Lamplighters \| I \| 0 \| Ilka Thorn 3 \(Sworn\) \|/);
  assert.match(md, /\| Ferrymen's Guild \| F \| 0 \|  \| ✓ \|/, "known but untouched factions are listed");
  assert.ok(!md.includes("The Gloom"), "untouched unknown factions are left out");
  assert.ok(md.includes("A \\| B"), "pipes escaped");
  assert.ok(md.includes("line one line two"), "newlines flattened");
  assert.match(md, /## History\n\n- 2026-10-16 · S01 · ledger/);
});

test("escapeHTML and localText", () => {
  assert.equal(escapeHTML(`<a href="x">'&'</a>`), "&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;");
  assert.equal(localText({ en: "a", el: "α" }, "el"), "α");
  assert.equal(localText({ en: "a" }, "el"), "a");
  assert.equal(localText("plain", "el"), "plain");
  assert.equal(localText(null), "");
});
