# Multiplayer design

Status: **plan only.** Nothing here is playable online yet. What already exists in the code is the
foundation every option below builds on:

| Piece                 | Where                                                   | What it gives multiplayer                                     |
| --------------------- | ------------------------------------------------------- | ------------------------------------------------------------- |
| Deterministic physics | `src/physics/**`, ESLint ban on trig and `**`           | The same shot plays out bit for bit on every machine          |
| Quantized inputs      | `ShotQ` (`src/physics/launch.ts`), 1/64-unit edit paths | A shot is a handful of integers; edits replay exactly         |
| Stateless RNG         | `rngFor(seed, purpose, ...)`                            | Spins, racks, respawns and remixes come from the seed alone   |
| `GameState`           | `src/game/serialize.ts`                                 | Snapshot/restore of everything between strokes                |
| `TurnRecord`          | `src/game/record.ts`                                    | One stroke: board before, edits, shot, log, `postHash`        |
| `hashBoard()`         | `src/game/serialize.ts`                                 | A 32-bit fingerprint of the table and every ball              |
| `PHYSICS_VERSION`     | `src/config.ts`                                         | Refuse or warn when two builds would disagree                 |
| Share codes           | `src/game/share.ts`                                     | Compressed, validated `#s=` payloads (about 1 KB)             |
| Match rules           | `src/game/match.ts`                                     | Shared-table and race rules as pure functions, plus verifiers |

## 1. Goals and non-goals

Goals:

- Play a friend, either taking turns on one table or racing the same table side by side.
- Every client can check every shot for itself: no trusted server is needed to agree on what
  happened.
- Cheap to run: turn-based traffic only, a few KB per stroke.

Non-goals (for now):

- Real-time physics sync. Shots are simulated locally from the recorded inputs; only results are
  compared.
- Accounts, rankings, matchmaking with strangers.
- More than two players at one shared table (races can have more).

## 2. Match types

Both are implemented as pure functions in `src/game/match.ts` and covered by
`tests/unit/match.test.ts`.

### Shared table (`SharedMatch`)

Two players take turns on one table, which keeps every bend either of them makes.

- The rack is split into suits: warm (1, 3, 5, 7, 9) and cool (2, 4, 6, 8, 10).
- The first ball to drop on a clean stroke (no scratch) decides the suits: the shooter gets that
  ball's suit.
- Sinking at least one of your own keeps your turn. Sinking only the other suit, missing or
  scratching passes it.
- A scratch also bolts the pocket that swallowed the cue ball and respawns the cue (the existing
  `boltOnScratch` rule).
- Balls that are broken or blown up count as gone, the same as potted.
- Clear your suit to win. Clearing the other player's last ball hands them the win. If one stroke
  clears both suits, the shooter wins.
- `applySharedTurn(match, { player, log, postHash })` returns a new match or an error:
  `not-your-turn`, `unknown-player` or `over`. It never changes the match it was given.

### Twin race (`RaceMatch`)

Everyone plays their own game from the same seed: the same remixed table, the same rack, and,
because spins come from `rngFor(seed, 'spin', stroke)`, the same spin on stroke 1, stroke 2 and
so on. Respawns are seeded the same way.

- Fewest strokes (with penalties) wins, then most style points (`beats()`); an exact tie is a dead
  heat.
- Results stay covered until everyone has finished: `raceView(match, viewer)` shows a player their
  own result and only "finished" for the others.
- `raceSetup(match)` is the `GameSetup` every racer loads; `submitRace` records a result once.

## 3. Determinism contract

A shot replayed anywhere must land every ball in the same place to the last bit. The rules that
make that true, all already enforced:

1. Simulation code uses only `+ - * /` and `Math.sqrt`, which are exactly rounded in every
   JavaScript engine. ESLint fails the build on `Math.sin/cos/atan2/hypot/pow/exp/log` or `**` in
   `src/physics`, `src/geom`, `reshape.ts` and `placement.ts`.
2. Inputs are quantized before they reach the simulation: the shot is a `ShotQ` (integer direction,
   power in thousandths, English in hundredths), and drag targets are snapped to 1/64 of a unit
   as they happen.
3. Randomness is stateless: `rngFor(seed, purpose, ...ints)`. Nothing depends on how many random
   numbers were drawn before.
4. `PHYSICS_VERSION` is bumped by any change that alters outcomes. Matches carry the version they
   started on (`pv`); clients on another version must not join (or must at least warn).
5. Every stroke carries `postHash`. A client that simulates a stroke and gets a different hash has
   diverged. It adopts the shooter's checkpoint (the `GameState` after the stroke) and reports the
   mismatch, rather than arguing.

## 4. Data

```ts
GameState; // src/game/serialize.ts: table, balls, strokes, budgets, tray, style...
TurnRecord; // src/game/record.ts:    { stroke, aim, shot: ShotQ, edits, pre: GameState, log, postHash }
SharedMatch; // src/game/match.ts:     { v, pv, seed, players, active, owners, left, strokes, turns, lastHash, over, winner }
RaceMatch; // src/game/match.ts:     { v, pv, seed, players, results, over, winner }
```

Versioning: every payload has a format version (`v`) and the physics version (`pv`). Readers
reject unknown `v`. Unknown `pv` means "will replay differently": show the result, but do not
verify it.

Measured sizes (one stroke of a remixed Free Play table, with a bend):

| Payload             | JSON   | deflate-raw                        |
| ------------------- | ------ | ---------------------------------- |
| `GameState`         | 3.9 KB |                                    |
| `TurnRecord`        | 4.4 KB | 0.95 KB                            |
| `SharedMatch`       | 0.3 KB |                                    |
| match + last record |        | 1.1 KB (about 1.5 KB as base64url) |

Budgets: keep a turn message under 4 KB compressed (a URL stays well under the 8 KB that chat apps
and browsers handle comfortably), and a full race game (20 records) under 32 KB.

## 5. Transport A: links

GamePigeon-style asynchronous play, with no server at all.

- A link carries `#m=` + base64url(deflate-raw({ match, last: TurnRecord })), built exactly like
  today's `#s=` shot links (`src/game/share.ts`) and validated just as strictly on the way in.
- Opening a link replays the last stroke (the existing replay phase), then hands the table to
  whoever is up. They play their stroke and send a new link back.
- Race: each player sends their finished game (`RaceResult` plus records) and opens the others'
  links to reveal them.
- Limits: links can be forwarded, replayed or forged. The hash proves a stroke is physically
  consistent, not who sent it. That is fine for friends, not for stakes.
- Previews: a hash URL gets no server-side preview, so the share text says it ("Your turn in
  Bendy Billiards!"). A tiny static page could add an Open Graph image later.

## 6. Transport B: rooms (the main plan)

Live play in a room both players are in.

- **Relay:** a WebSocket relay that forwards messages and keeps the latest `MatchState` per room.
  Candidates: Cloudflare Durable Objects (one object per room), PartyKit, or a small Node `ws`
  service. WebRTC data channels with a signalling server are an option, but NAT traversal
  failures make them a worse default.
- **Rooms:** four-letter codes, a lobby (pick shared table or race, see who is in), presence
  (connected / away), a turn timer (for example 60 s to bend and shoot, then an automatic soft
  shot), and reconnects (rejoin by code; the relay sends the current match and last checkpoint).
  Spectators get the same stream read-only.
- **Authority:** the active player's client is authoritative for its own stroke. It sends
  `{ record: TurnRecord, checkpoint: GameState }`. Everyone else replays the record from their own
  board. If the hash matches, they carry on. If not, they adopt the checkpoint and log it.
  `applySharedTurn` runs on every client and on the relay, so whose turn it is never depends on
  one machine.
- **Ghost bends:** while the active player drags knobs and toys, stream the quantized vertex and
  toy positions at 10 Hz so the others watch the table bend live. These are cosmetic only; the
  record's edits are the truth.

## 7. Why rooms first

- They feel like playing together: you watch your friend bend the table and wince at the shot in
  real time.
- Turn timers, rematches and a lobby need a server anyway.
- The data model is the same for both transports, so links can follow cheaply (and doubles as the
  offline fallback).

## 8. Fairness

- **Shared table:** every client replays every stroke, so a doctored shot is caught at once
  (wrong hash). Bends are part of the record, so they replay too.
- **Race:** a racer could claim a result they never played. `verifyGame(setup, records)` replays a
  whole claimed game through the real game, headless. It checks that each stroke's aim is the spin
  the seed gives that stroke, applies the recorded edits and shot, and compares every `postHash`.
  The relay (Node runs the same physics) or a suspicious opponent can run it on a submitted
  result. `verifyTurn(record)` checks a single stroke from its own starting board.
- Not covered: a racer using the chain preview to search for great shots. The preview is a game
  feature, so that is allowed.

## 9. UI flows

- Home gets **PLAY A FRIEND**, offering **CREATE ROOM** (shows a code and a share button) or
  **JOIN** (enter a code). Opening a room link goes straight to its lobby.
- **Lobby:** both names, presence dots, match type, **START**.
- **Shared table:** a banner says whose turn it is; the opponent's ghost bends are drawn in their
  colour; a timer ring sits around the SHOOT dial; suit pips appear under each name once suits are
  decided. Your stroke plays as usual; theirs arrives as a replay.
- **Race:** everyone's own game, plus a strip showing who has finished (covered results). At the end,
  the results are revealed side by side with REPLAY for any stroke.
- **End:** winner card, **REMATCH**, **LEAVE**.

## 10. Rollout and open questions

Rollout:

1. **Pass-and-play** on one device, using `match.ts` with no network: shared table first. This
   proves the rules and the UI.
2. **Links** (Transport A): no server, async, good for testing determinism across real devices.
3. **Rooms** (Transport B), starting with the shared table, then races and spectators.

Open questions:

- Hosting cost and abuse limits for the relay (rooms expire after an hour idle?).
- Moderation: free-text names only, or pick-from-a-list names and emotes instead of chat?
- Cross-version play: hard refuse on a `PHYSICS_VERSION` mismatch, or let old matches finish on
  the old version?
- Mobile: a backgrounded tab loses its socket. How long should the turn timer wait on a reconnect?
- Should a shared table use hunger (bigger pockets after dry shots), or is that too swingy with two
  players?
