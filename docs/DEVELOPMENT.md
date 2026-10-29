# Development

## Layout

```
module.json              manifest (id = planar-factions; the id is permanent once published)
scripts/
  main.mjs               hooks: init (settings, enricher, keybinding), ready (default pack, socket, clicks, seeding, api), toolbar
  constants.mjs  settings.mjs  i18n.mjs
  util.mjs               pure rules (no Foundry globals), all unit-tested: renown ladder, packs (validate, merge),
                         finding factions/contacts/heroes by name, parsing journal buttons, state changes, seeding,
                         the players' view (buildView), the journal page Markdown
  state.mjs              definitions (shipped + imported pack + the world's own factions), the state, mutate(), serial(), seeding
  actions.mjs            one call per GM action (renown, attitude, reveal, member, contacts, ledger, missions) + chat posts
  console.mjs            GM console (ApplicationV2): Factions, Contacts, Ledger, History, Pack
  standing.mjs           the players' Standing window (ApplicationV2), read-only; also the GM's preview
  enrichers.mjs          @Faction @Renown @Attitude @Debt @Favour @Ledger, and the one click listener for them
  page.mjs               the journal page (a Planar Codex note when the Codex is active) and history sentences
  rpc.mjs                socket: GM -> players "open the Standing window"
data/default-pack.json   the shipped pack: generic ranks, perks and missions (en + el), no factions
styles/factions.css      scoped to .planar-factions, .planar-factions-card (chat) and .pf-ref (journal chips)
lang/en.json el.json     interface strings (keys under PLANAR_FACTIONS.*)
tests/                   util (rules), manifest + languages + content guard, link (main.mjs against stubbed globals), tools
tools/                   stamp-manifest, package, release-api, check-syntax
.github/workflows/       ci.yml, release.yml
```

There is no build step: Foundry loads `scripts/main.mjs` directly.

## How it fits together

- **Who writes.** Only the GM's client writes, always through `mutate(fn)` (`state.mjs`): it clones the state, runs `fn(state, defs)`, saves the `state` setting and schedules the journal page. Writes are queued by `serial()`; never call `mutate()` or `serial()` inside a `serial()` block.
- **Who reads.** Every client reads the `state` and `pack` settings. The players' side only ever goes through `buildView(..., { gm: false })`, which drops unknown factions, contacts and entries and every GM note.
- **Definitions vs state.** The pack says what a faction *is*; the state says what the heroes have *done* with it. A faction with no entry in `state.factions` takes its starting attitude and `known` from the pack.
- **Seeding.** Pack contacts and ledger entries are copied into the state once (ids `seed-<pack id>`), on `ready` and after an import. `state.seeded` remembers them, so a deleted seed isn't recreated.
- **Journal buttons.** One enricher with one pattern. GM buttons carry what they will do in `data-*` attributes; a single capturing click listener on `document` (`registerClicks`) runs them. "Already used" is decided by `source`: the page uuid plus the exact button text, stored on the history entry or the ledger entry.
- **Data.**
  - Hidden world settings: `state`, `pack`, `session`, `pageUuid`.
  - `state = { schema, factions: { [id]: { known, attitude, party, heroes: { [actorId]: { score, member } }, notes } }, custom: [faction], contacts: [contact], ledger: [entry], history: [entry], seeded: [key] }`.
  - Contact: `{ id, name, faction, actorUuid, img, attitude, role, offers, notes, known, met, seed }`.
  - Ledger entry: `{ id, kind: "debt"|"favour", with: { faction }|{ contact }|{ name }, who: [actorId], what, weight: 1-3, status, known, notes, due, date, session, source, seed, log: [{ date, session, from, to, note }] }`.
  - History entry: `{ id, date, session, by, kind: "renown"|"attitude"|"known"|"member"|"contact"|"ledger", factionId, target, heroName, delta, asked, from, to, reason, source, contactId, entryId, text }`; the last 400 are kept.

## Run the checks

```
npm test
```

Syntax check on every `.mjs`, then: the rules in `util.mjs`, the manifest, language parity and every key used in code, a content guard, a link test of `main.mjs` (settings, enricher pattern, api, a ledger entry through the GM queue, the journal page), and the release tools.

These tests do not start Foundry. Anything touching windows, chat, journals, the socket or drag and drop has to be tried by hand.

## Try it in Foundry

Symlink the repo into your user data and restart the world:

```
ln -s /path/to/repo /path/to/FoundryData/Data/modules/planar-factions
```

Reload the browser (F5) after each change. Use a second browser logged in as a player for the Standing window.

### Manual test checklist

**Setup**
- Enable the module: no console errors; the flag icon is in the GM's Tokens toolbar, and in a player's (setting on). Turn the setting off: the player's button goes.
- Console → Pack shows the generic ladder (ranks at 1/10/25/50, perks at 3/10/50) and no factions. Import a broken JSON: error toast, details in the console, nothing saved. Import a valid pack: factions, contacts and ledger entries appear; import it again: nothing is duplicated.

**Factions**
- Open a faction: attitude, party renown, heroes table (one row per player character), allies/rivals links jump to that faction.
- +1/+2/+3/−1 buttons: the score changes, never below 0; a toast; a GM whisper in chat (with the reason typed in the bar, which then clears). Type a number in the field: same.
- Tick *Member* for a hero and raise their renown past a rank threshold: the rank shows, the chat says "is now …". At 3+ the handshake (recognized) appears; downtime days and level-based renown show.
- Change the attitude: the face icon and colour change; chat line.
- The eye: the faction appears in the player's Standing window (live) and in the chat announcements for everyone (setting "to everyone").
- *Roll a mission*: a d-roll whispered to the GM with the mission text.
- Add a faction at the bottom; it appears under its own group with a delete button.
- Search and the filter (known / with any standing) narrow the list.

**Contacts**
- Add by name; drop an NPC actor on the drop zone: name, portrait and a sheet button. Edit fields; the eye shows them to players.
- Delete a contact that a ledger entry uses: the entry keeps the name.

**Ledger**
- Add a debt with a faction, a favour with a typed name, one for two heroes, one GM-only (untick *The players know*).
- *Call in*: chat post (public only if the players know it). *Paid*: the entry greys out and moves to *Closed*; the log line shows on the card. *Reopen* works.
- The player's Standing window shows known entries only; closed ones under *Settled*.

**Journal buttons** (write them in a journal page or a Codex note, view as GM and as a player)
- `@Faction[x]`: chip with colour, face and score (GM); the player sees it only once the faction is known.
- `@Renown[x +2]{why}`: click → confirm → applied; the button shows ✓; a second click asks "Again?". A player sees nothing.
- `@Renown[x +1 Name]`: applies to that hero; a wrong name shows a dashed red chip with a tooltip (GM only).
- `@Attitude[x hostile]`: sets the attitude.
- `@Debt[x Name w2]{what}`: click → *Add, the players know* / *GM only*; the button becomes a status chip; after a reload it is still a chip.
- `@Ledger[seed-id]`: chip with status; GM click opens the console on the entry.

**Page**
- After any change the page appears (with Planar Codex: a Codex note; without: "Planar Factions" folder, GM only) and updates ~2 s after each change. *Copy as Markdown* pastes the same.

**Players**
- The frame-eye button in the console opens the Standing window on every connected player's screen (toast says how many). The eye button shows the GM the same window with a "what the players see" banner.
- EN/ΕΛ button (GM console, top right; players' Standing window, next to the tabs): the window, its title and faction names switch language for that user only; another user's window doesn't change. Settings → *My language for Planar Factions* shows the same choice.
- With the GM on EN and the world default on Greek: change renown, an attitude and a ledger status: the chat cards and the «Factions & Favours» page stay in Greek.

## Changing things

- **New user-facing text:** add the key to `lang/en.json` and `lang/el.json`. The language test fails if they differ.
- **Pack format:** `validatePack` checks what the engine relies on. A breaking change bumps `PACK_SCHEMA` and needs a note in the README and the changelog.
- **State:** add fields freely (`normalizeState`, `standingOf`, `normalizeContact` and `normalizeEntry` fill defaults); a change of meaning bumps `STATE_SCHEMA` with a migration in `normalizeState`.

## Versions

Follow [SemVer](https://semver.org/). Update `CHANGELOG.md` first, then tag. Compatibility lives in `module.json` (`minimum`, `verified`); raise `verified` only after testing on that Foundry build.
