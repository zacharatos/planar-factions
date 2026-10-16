# Planar Factions

Factions, renown, contacts and a ledger of debts and favours, for **Foundry VTT v14** and the **dnd5e** system (6.x). Track how every group in your world feels about the party, how far each hero has risen in the ones they joined, who they know, and who owes whom.

Built on the optional **Renown** rule of the 2024 *Dungeon Master's Guide*: a score per group that never drops below 0, members who treat you as a friend at 3+, ranks and perks at thresholds you set.

## Features

- **Standing with every faction.**
  - An **attitude** toward the party: Hostile, Indifferent or Friendly.
  - **Renown** for the party as a whole, for each hero, or both (a world setting).
  - **Membership** per hero, with a **rank** from the faction's ladder and the **next rank** to aim for.
  - **Recognition** at renown 3+, the **perks** each threshold unlocks, the **downtime** needed for the next point (10 days × current renown), and the **level-based renown** a hero of that level would have.
  - Quick buttons for the DMG awards: +1 (advanced the group's interests), +2 (a mission for the group), +3 (a hugely significant quest), −1 (an offense).
  - Allies and rivals, leader, headquarters, motto, a mission table to roll on, and notes.
- **Contacts.** Name, faction, role, attitude, what they can offer, when the heroes met them. Drop an NPC actor to make one with its portrait and a link to the sheet.
- **The ledger.** Debts (the heroes owe) and favours (owed to the heroes), with whom, which heroes or the whole party, what, how heavy (small, heavy, life and death), a due date and a status: open, called in, paid, broken, forgiven. Every status change is logged on the entry.
- **Secrets stay secret.** Factions, contacts and ledger entries are hidden from the players until you show them. A debt can stay GM-only for good: someone believes the heroes owe them, and the heroes don't know it yet.
- **The players' window.** A read-only *Standing* window: the factions they know, their renown and ranks, the perks they've earned, their contacts, and their open debts and favours. One click opens it on every player's screen.
- **Journal buttons for your prep notes** (work in any journal page, and in Planar Codex notes):

  | Write | You get |
  |---|---|
  | `@Faction[lamplighters]` | a chip with the faction's colour, attitude and party renown; click to open it |
  | `@Renown[lamplighters +2]{lit the old quarter}` | a GM button: +2 renown for the party, with the reason |
  | `@Renown[lamplighters +1 Ilka]` | the same for one hero (first name, or the full name in quotes) |
  | `@Attitude[the-gloom hostile]{they saw us}` | a GM button: set the attitude (hostile / indifferent / friendly) |
  | `@Debt[ferrymen Ilka w2]{the crossing toll}` | a GM button that adds the debt to the ledger (asks whether the players know); after that it shows the entry's status |
  | `@Favour[old-wick]{a lamp lit in time}` | the same for a favour owed to the heroes |
  | `@Ledger[entry-id]` | a chip for an existing entry |

  Factions are found by id, name, alias or epithet, in any language, accents ignored. Players never see the GM buttons; they see a faction chip or a ledger chip only once they know about it. A button that was already used shows a ✓ and asks before applying again.
- **History and a journal page.** Every change (who, what, from → to, why, which session) goes into the history. A GM-only page with the standing, the ledger, the contacts and the latest changes is rebuilt after every change. With Planar Codex it is a Codex note, so it exports with your vault.
- **Chat.** Renown changes, rank-ups, attitude changes and called-in debts are posted to the GM, or to everyone for things the players know (a setting).
- **Your own factions.** Add factions in the console, or import a JSON pack with factions, ranks, perks, missions, contacts and ledger entries. Pack contacts and entries are seeded into the world once; deleting one doesn't bring it back.
- English and Greek interface.

The module ships no publisher content: no setting text, art or audio. The shipped pack has a generic renown ladder and no factions.

## Install

In Foundry: **Add-on Modules → Install Module**, paste this manifest URL and press Install:

```
https://github.com/zacharatos/planar-factions/releases/latest/download/module.json
```

Enable **Planar Factions** in your world (Game Settings → Manage Modules). It needs the **dnd5e** system.

## Use

1. **Before play.** Open the console from the flag icon in the Tokens toolbar. Import your pack in **Pack**, or add factions at the bottom of **Factions**. Set the session label at the top ("S01"): every change is stamped with it.
2. **During play.**
   - Open a faction and use the award buttons, the renown fields, the attitude and the member boxes. Type a reason in the bar first if you want one in the history.
   - The eye shows a faction, a contact or a ledger entry to the players.
   - In **Ledger**, add what's owed; **Call in** posts it to chat; **Paid / Broken / Forgive** close it.
   - Or click the buttons you wrote into your prep notes.
3. **For the players.** The eye-in-a-frame icon at the top of the console opens the Standing window on every player's screen; players also have the flag icon in their toolbar (a setting). The eye icon shows you what they see.
4. **After the session.** **History** lists every change with its session; the journal page has the same in tables, ready for your session log.

## Settings

| Setting | What it does |
|---|---|
| Track renown for | The party and each hero (default), the party only, or each hero only |
| Chat announcements | To the GM only (default), to everyone (only what the players know), or off |
| Toolbar button for players | Players get the button that opens their Standing window |
| Pack language | Faction names and pack text in English, Greek, or each user's language |
| Journal page name | The name of the GM page |

## Packs

A pack is a JSON file:

```json
{
  "schema": 1,
  "id": "my-world",
  "name": { "en": "My world", "el": "Ο κόσμος μου" },
  "ranks": [{ "min": 1, "name": "Sworn" }, { "min": 10, "name": "Captain" }],
  "perks": [{ "min": 3, "text": "A bed and a meal at any guildhall" }],
  "missions": [{ "text": "Find the missing lamp." }],
  "groups": [],
  "factions": [
    {
      "id": "lamplighters",
      "name": { "en": "The Lamplighters", "el": "Οι Λαμπαδηφόροι" },
      "epithet": "Wicks",
      "motto": "No street stays dark",
      "kind": "faction",
      "group": "City guilds",
      "leader": "Mother Tallow",
      "base": "The Wickhouse",
      "color": "#c9a24a",
      "attitude": "indifferent",
      "known": false,
      "allies": ["ferrymen"],
      "rivals": ["the-gloom"],
      "aliases": ["lamps"],
      "ranks": [],
      "perks": [],
      "missions": [],
      "notes": "GM-only notes"
    }
  ],
  "contacts": [
    { "id": "old-wick", "name": "Old Wick", "faction": "lamplighters", "role": "night warden", "attitude": "friendly", "offers": "a lamp and a shortcut", "known": false }
  ],
  "ledger": [
    { "id": "toll", "kind": "debt", "with": { "faction": "ferrymen" }, "who": [], "what": "The crossing toll", "weight": 2, "known": true }
  ]
}
```

- Any text can be a plain string or `{ "en": …, "el": … }`.
- `kind` is `faction`, `minor`, `power` or `other`; `group` (optional) heads the list the faction is shown under.
- A faction's own `ranks`, `perks` and `missions` replace the pack's for that faction.
- Ledger entries are with a `faction`, a `contact` (a pack contact id) or a `name`. `who` lists heroes by name (matched to the player characters when the entry is seeded); leave it empty for the party. `weight` is 1, 2 or 3.
- **Export pack** in the console writes the imported pack (or an empty template). **Back up the state** saves everything recorded in this world.

## Macro API

```js
const pf = game.modules.get("planar-factions").api;
pf.open();                                           // GM console (players: their Standing window)
pf.showToPlayers();                                  // open the Standing window on every player's screen
await pf.renown("lamplighters", "party", 2, { reason: "lit the old quarter" });
await pf.renown("lamplighters", actor.id, 1);
await pf.attitude("the-gloom", "hostile", { reason: "they saw us" });
await pf.reveal("lamplighters");                     // show it to the players
await pf.member("lamplighters", actor.id, true);
await pf.addEntry({ kind: "debt", with: { faction: "ferrymen" }, who: [], what: "The crossing toll", weight: 2, known: true });
await pf.entryStatus(entryId, "called");
await pf.addContact({ name: "Old Wick", faction: "lamplighters", attitude: "friendly" });
await pf.rollMission("lamplighters");
pf.view({ gm: false });                              // what the players see, as data
pf.markdown();                                       // the journal page as Markdown
```

Changes run on the GM's client only.

## Notes

- World data is kept in world settings, which every client receives: a player who opens the browser console could read hidden entries. The module never shows them anything you haven't revealed.
- Requires Foundry v14 and dnd5e 6.x.

## Development

See [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) (file map, tests, manual checklist) and [docs/PUBLISHING.md](docs/PUBLISHING.md).

## License

MIT. See [LICENSE](LICENSE).
