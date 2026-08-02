# dc-npc-patrols

Bring your NPCs to life — guards who patrol and challenge intruders, shopkeepers who open up in the morning and go home at night, bartenders who chat with players, critters that flee from danger.

NPCs navigate intelligently around walls and obstacles, hold branching conversations with players, react to the time of day and weather, and participate in combat — all driven by a visual behaviour tree editor that requires no scripting.

---

## What Can This Module Do?

Here are some things you can build:

| Scenario | How |
|----------|-----|
| **A town guard** who patrols three posts, faces players who approach, challenges them with a line of dialog, and attacks hostiles in combat | A patrol loop with a vision check that branches into greeting or combat |
| **A shopkeeper** who walks to their counter at dawn, greets customers, locks up at dusk, and goes home to sleep | A day/night schedule that switches between work and home behaviour |
| **A saloon bartender** who stays behind the bar, chats with players, and kicks out troublemakers | An idle loop with proximity-triggered dialog and a condition check for hostile actors |
| **A wandering merchant** who drifts between town regions, offers to trade, and flees from danger | A wander loop with a flee-on-combat branch |
| **A night watchman** who patrols after dark, carries a lantern, and sleeps during the day | A schedule-gated patrol with a light-equipment action |
| **A guard dog** that runs to investigate sounds, barks at strangers, and retreats if outmatched | A vision-triggered approach with a condition check for nearby threats |

If you can describe what an NPC should do in plain English, you can probably build it with this module.

---

## What Is a Behaviour Tree?

A behaviour tree is a **decision flowchart** for an NPC. It's a visual way of saying "try this, and if that doesn't work, try this instead" — the same way you'd describe NPC behaviour to another GM at the table.

You build trees in a drag-and-drop editor using **nodes** — building blocks that each do one thing. There are four kinds:

### The Four Node Types

| Type | What it does | Think of it as... |
|------|-------------|-------------------|
| **Composite** | Controls the flow — decides which child runs next | A manager delegating tasks |
| **Condition** | Asks a yes/no question about the world | An "if" statement |
| **Action** | Makes the NPC do something | A verb — move, talk, wait |
| **Decorator** | Wraps another node and changes how it behaves | A modifier — "but only once a minute" |

### How Composites Work (the only jargon you need)

You'll use two composites 90% of the time:

**Sequence — "Do all of these, in order"**

Like a to-do list. Runs each child left to right. If any child fails, the whole sequence stops.

```
Sequence
  ├─ Move to Saloon        ← do this first
  ├─ Wait 30 seconds        ← then do this
  └─ Move to General Store  ← then do this
```

If the NPC can't reach the saloon (e.g. the path is blocked), it won't bother trying to wait or move to the store. The sequence failed.

**Selector — "Try these until one works"**

Like a priority list. Tries each child top to bottom. The first one that succeeds wins, and the rest are skipped.

```
Selector
  ├─ Is it raining? → Go inside     ← try this first
  └─ Wander around outside          ← fallback if not raining
```

If it's raining, the NPC goes inside and the selector is done — it never tries wandering. If it's not raining, the first child fails (the condition returns "no"), so the selector falls through to the second child.

### That's the Foundation

Every behaviour tree is just sequences and selectors nested inside each other, with conditions checking the world and actions making the NPC do things. The editor handles all the plumbing — you drag nodes around and fill in fields.

> **Reactive conditions:** If a condition that's *before* a running action stops being true (e.g. it was daytime when the NPC started walking, but now it's night), the NPC will abort what it was doing and re-evaluate. You don't have to build this — it's automatic.

---

## Quick Start: Your First NPC

Let's build a simple guard who patrols between two posts. This takes about 5 minutes.

### Step 1: Create Scene Regions

On your scene, create two regions and name them:
- `Guard Post 1`
- `Guard Post 2`

(Foundry → scene controls → Regions → Create Region. Draw a small area and name it in the region config.)

### Step 2: Open the Patrol Hub

Click the **NPC Patrols** button in the scene controls bar (it looks like a route/footprint icon). This opens the **NPC Patrol Hub** — your command center for everything in this module.

### Step 3: Create a Behaviour Tree

In the hub, go to **World Content → Behaviour Trees** and click **New Tree**. Name it "Simple Patrol."

You'll see a single root node. Build this structure:

```
Root
  └─ Sequence
       ├─ Move To Region (region: "Guard Post 1")
       └─ Move To Region (region: "Guard Post 2")
```

Drag a **Sequence** composite from the palette onto the root. Then drag two **Move To Region** actions onto the sequence. In each one, type the region name.

### Step 4: Assign the Tree to an NPC

In the hub, go to **NPCs in Scene** and select your guard token. Under **Behaviour**, pick "Simple Patrol" from the dropdown. Click **Save**.

### Step 5: Watch It Go

That's it. The NPC will now walk to Guard Post 1, then to Guard Post 2, then back to Post 1, and loop forever. Open the path debug overlay (hub → Scene view → toggle, or press **Alt+Shift+P**) to see the path on the canvas.

### What Just Happened?

The sequence runs its children in order: move to Post 1, then move to Post 2. When it reaches the end, it starts over from the top — so the NPC walks back to Post 1. This loop continues until you unassign the tree or pause the engine.

---

## Cookbook

Ready-to-build recipes for common NPC types. Each one lists the tree structure and the nodes you need. Mix and match — these are starting points, not rigid templates.

### The Patrol Guard

A guard who walks between posts and challenges players they spot.

```
Root
  └─ Selector
       ├─ Sequence                    ← "Am I in combat?"
       │    ├─ Condition: Combat (active)
       │    └─ ...combat actions...   ← see Combat section
       └─ Sequence                    ← "Not in combat — patrol"
            ├─ Sequence               ← "Can I see a player?"
            │    ├─ Update Visible Tokens (filter: players)
            │    ├─ Condition: Visible Tokens (min: 1)
            │    └─ Sequence
            │         ├─ Face (source: scene scan, filter: players, range: 4)
            │         └─ Chat ("Halt! State your business.")
            └─ Sequence               ← "Nobody around — keep walking"
                 ├─ Move To Region ("Guard Post 1")
                 └─ Move To Region ("Guard Post 2")
```

**How it works:** The outer selector tries combat first (fails if not in combat), then tries spotting a player (fails if nobody visible), then falls through to the patrol loop. The NPC always does the most important thing it can.

### The Shopkeeper

Opens up at dawn, greets customers, closes at dusk, goes home to sleep.

```
Root
  └─ Selector
       ├─ Sequence                     ← "Nighttime — go home"
       │    ├─ Condition: Schedule (time: 20:00–08:00)
       │    ├─ Move To Region ("Shopkeeper's Home")
       │    └─ Set Visible (hidden, image: "sleeping.png")
       └─ Sequence                     ← "Daytime — work"
            ├─ Move To Region ("Shop Counter")
            ├─ Face (source: scene scan, filter: players, range: 3)
            └─ Chat (lines: "Welcome!;How can I help you?;Take your time.")
```

**How it works:** The schedule condition checks the current game time. At night, the NPC goes home and disappears (with a sleeping image). During the day, it walks to the counter and greets customers.

> **Tip:** Use the Marshal Time tab (on the Marshal sheet) to advance game time and test day/night transitions.

### The Wandering Merchant

Drifts between town regions and flees from danger.

```
Root
  └─ Selector
       ├─ Sequence                      ← "Danger! Run!"
       │    ├─ Condition: Combat (active)
       │    └─ Move To Region ("Safe House", mode: flee)
       └─ Sequence                      ← "All clear — wander"
            ├─ Wander Region ("Town Square")
            └─ Wait (5 seconds)
```

**How it works:** If combat starts, the NPC flees to a safe house (flee mode gives extra movement budget). Otherwise, it picks a random spot in the town square, walks there, waits a moment, then picks another.

### The Night Watchman

Patrols after dark, carries a lantern, sleeps during the day.

```
Root
  └─ Selector
       ├─ Sequence                      ← "Night — patrol with lantern"
       │    ├─ Condition: Schedule (time: 20:00–06:00)
       │    ├─ Condition: Light (position darkness > 0.5)
       │    ├─ Inverter
       │    │    └─ Condition: Light (token is lit)
       │    ├─ Condition: Character (has gear: "lantern")
       │    ├─ Use Item ("lantern")
       │    └─ Move To Region ("Watchtower")
       └─ Sequence                      ← "Day — sleep"
            ├─ Set Visible (hidden, image: "sleeping.png")
            └─ Wait (60 seconds)
```

**How it works:** At night, if it's dark and the NPC isn't already lit and has a lantern in their gear, they use it and head to the watchtower. During the day, they go invisible and "sleep."

### The Tavern Bartender

Stays behind the bar, chats with customers, faces whoever's talking.

```
Root
  └─ Sequence
       ├─ Condition: In Region ("Behind Bar")
       ├─ Selector
       │    ├─ Cooldown (30 seconds)
       │    │    └─ Sequence
       │    │         ├─ Update Visible Tokens (filter: players)
       │    │         ├─ Condition: Visible Tokens (min: 1)
       │    │         ├─ Face (source: scene scan, filter: players, range: 3)
       │    │         └─ Chat (lines: "What'll it be?;The usual?;Coming right up.")
       │    └─ Succeed               ← "Nobody here, just wait"
       └─ Wait (3 seconds)
```

**How it works:** The NPC stays behind the bar. Every 30 seconds (the cooldown), it checks for players. If it sees one, it faces them and says a random line. If nobody's around, it does nothing (the `Succeed` node is just a "do nothing and move on" placeholder).

---

## Core Concepts

Now that you've seen some examples, here's a bit more detail on how things work.

### The Tick

The behaviour tree engine "ticks" every couple of seconds (configurable — see [Module Settings](#module-settings)). On each tick, it runs the tree from the root and each node reports back:

| Result | Meaning |
|--------|---------|
| **Success** | "I'm done, it worked." |
| **Failure** | "I couldn't do this." |
| **Running** | "I'm still working on it — check back next tick." |

Movement actions (move to region, wander, close on target) return "running" while the NPC is walking, and "success" when they arrive. The tree remembers where it was and resumes from there — so an NPC that's mid-walk doesn't restart from the beginning every tick.

### The Blackboard

Each NPC has a "blackboard" — a memory space where nodes can read and write information. You mostly interact with it indirectly:

- **Vision nodes** write lists of visible tokens to the blackboard
- **Targeting nodes** write a target token and its range to the blackboard
- **Condition nodes** read from the blackboard (e.g. "is there at least 1 visible token?")
- **Action nodes** read from the blackboard (e.g. "face the token I acquired as a target")

You don't need to manage the blackboard manually — the nodes handle it. But knowing it exists helps you understand why you need to run `Update Visible Tokens` before checking `Condition: Visible Tokens`.

### Template Variables

Behaviour tree fields can use `{{variable_name}}` placeholders instead of hardcoded values. This lets you write one tree and customise it per NPC.

For example, instead of hardcoding `"Guard Post 1"` in a Move To Region node, you'd:
1. Declare a variable called `patrol_region_1` (type: `region_select`) on the tree
2. Use `{{patrol_region_1}}` in the node's region field
3. When assigning the tree to an NPC, pick the region from a dropdown

Now you can assign the same "Simple Patrol" tree to five different guards, each patrolling different posts.

Variable types: `text`, `number`, `boolean`, `region_select` (dropdown of scene regions), `foundry_id` (dropdown of door wall IDs), `dialog_tree_select`, `ambient_set_select`, `fragment_select`, `direction_select`.

### Fragments — Reusable Building Blocks

A **fragment** is a saved subtree you can reuse across multiple trees. There are two ways to use one:

| Mode | What happens |
|------|-------------|
| **Insert (Copy)** | Deep-clones the fragment into your tree. The copy is independent — editing the original fragment later won't change your tree. Variables are merged in at insert time. |
| **Link** | Inserts a live reference. The engine uses the fragment's current content at runtime — edit the fragment and all linked trees update immediately. |

Use **Insert** when you want a starting point you'll customise. Use **Link** when you want shared behaviour that stays in sync across trees.

> The module ships a library of pre-built fragments for common patterns (patrol loops, greet behaviour, day/night schedules, etc.) so you can assemble trees from proven components instead of building from scratch.

### Built-in Fragments

The BT editor's node palette has a **Built-in Fragments** section (below the node categories, separated by a divider). Each fragment is a draggable chip — drag it onto a tree node to insert a deep clone, just like dragging a node from the palette. Variables are namespaced automatically so each insert gets independent configuration.

User-created fragments appear in a **Fragments** section in the same palette area. Dragging a user fragment chip also inserts a deep clone. To *link* a fragment (live reference that updates when the original changes), use the **Link Fragment** button in the structure panel toolbar.

| Fragment | Description |
|----------|-------------|
| **Scheduled Relocate** | At a set time on set days, walk to a region. |
| **Wander and Pause** | Amble around a region, pausing between moves. |
| **Greet Nearby Players** | When a player is visible, face them and say hello (rate-limited). |
| **Challenge Intruder** | Same structure as Greet, guard-flavoured defaults. |
| **Flee to Safety** | When combat starts, run to a safe region. |
| **Sleep/Wake Cycle** | At night: walk home, swap to sleeping sprite. By day: restore original image. |
| **Weather Shelter** | If it's raining, go inside. |
| **Door Keeper** | Open a door during set hours, close it otherwise. |

### Building with Fragments — Shopkeeper Example

A shopkeeper's day can be assembled entirely from built-in fragments:

1. Start with a **Selector** root.
2. Insert **Sleep/Wake Cycle** — walks home at 22:00, sleeps; wakes at 06:00, restores image.
3. Insert **Scheduled Relocate** — at 08:00 on weekdays, go to the shop region.
4. Insert **Greet Nearby Players** — when customers arrive, face them and say hello (30s cooldown).
5. Insert **Wander and Pause** — amble around the shop area while waiting.
6. Insert **Flee to Safety** — if combat breaks out, run to the back room.

Each fragment's variables (times, regions, greeting lines) are configured independently in the tree's Variables panel. The assembled tree is six fragments in one selector — no manual node-by-node construction needed.

---

## Dialog Trees

NPCs can hold branching conversations with players. When a player walks into an NPC's proximity region, a dialog panel opens showing the NPC's text and a list of possible responses.

### Setting Up a Dialog

1. **Create a dialog tree** — Hub → World Content → Dialog Trees → New. Add nodes with NPC text and response options.
2. **Attach it to an NPC** — Hub → select NPC → Interactions → attach the dialog tree. A proximity region is created automatically.
3. **Link responses to other nodes** — each response can divert to a different conversation node, creating branching paths.

### Quest Flags

Dialogs can read and write **quest flags** — persistent values stored on the actor (or shared across a posse). This lets conversations remember what happened:

- **Set flags on responses** — when a player picks a response, you can set a flag (e.g. `met_the_mayor = true`)
- **Flag conditions on nodes** — show a different conversation branch if a flag is set (e.g. if `persuaded_guard` is true, the guard lets you through)
- **Flag conditions on responses** — hide response options that don't apply (e.g. don't show "Ask about the murder" if the player hasn't learned about it yet)

Flags use **actor scope** (stored on the NPC) or **posse scope** (shared across all players in the same posse, so any member can read them). The same flag namespace is shared with the module's boon system — flags set by boons can be read by dialog conditions and vice versa.

### Ambient Lines

Ambient sets are short flavour lines whispered to a player when they enter an NPC's proximity region (with a per-player cooldown so they don't repeat too often). Use these for background NPCs who don't need full conversations but should feel alive — a bar patron muttering, a preacher rambling, a child laughing.

---

## Regions and Movement

### Creating Regions

Foundry scene regions are how you tell NPCs where to go. Create named regions on your scene (Foundry → scene controls → Regions) and reference them by name in BT nodes, or bind them via `region_select` template variables.

### How NPCs Navigate

NPCs use **A\* pathfinding** — they find the shortest route around walls, furniture, and other obstacles. You don't need to draw navigation meshes or waypoints. Just place regions and the NPC figures out how to get there.

- **Move To Region** — finds a path to the nearest walkable spot inside the region
- **Wander Region** — picks a random reachable spot inside the region and walks there
- **Move To** — paths to specific grid coordinates (use regions instead when possible — they're easier to manage)
- **Close On Target** — walks toward a target token until within a specified range

### Doors

NPCs automatically open regular doors during pathfinding and close them behind. Locked and secret doors block NPCs unless they have a matching key (see below).

Use the **Door Interact** action for explicit control — open, close, or lock a specific door by wall ID.

### Key Items

The module adds a `keys` gear type. A key links to a specific door wall (copy the wall UUID from Foundry's wall copy-ID button).

- **Players** use keys to unlock doors (right-click the key in their sheet — the module handles the socket call to the GM)
- **NPCs** with keys in their gear can path through locked and secret doors automatically, and re-lock them behind

### Terrain Cost Regions

Place a `dcTerrainCost` region behavior on a scene region to make the terrain harder to cross. The A\* pathfinder will prefer cheaper routes when alternatives exist. Cost is a multiplier: `1.0` = normal, `2.0` = twice as expensive. Useful for mud, undergrowth, steep slopes, etc.

### Path Debug

Toggle the path debug overlay from the hub (Scene view) or press **Alt+Shift+P**. It shows the last computed path, blocked cells, and navigation grid subdivision.

---

## Combat

NPCs can participate in combat using Deadlands Classic's combat system.

### Combat Nodes

| Node | What it does |
|------|-------------|
| **Fire Weapon** | Fires the equipped weapon at a blackboard target |
| **Reload Weapon** | Reloads the equipped weapon (auto-detects speed loading in combat) |
| **End Turn** | Marks the NPC's combat turn as finished |
| **Close On Target** | Moves toward a target until within range |
| **Condition: Combat** | Checks if combat is active, if it's the NPC's turn, or if they can still move |

### How It Works

The module hooks into the Deadlands Classic combat pipeline. When a combat round starts, the NPC's behaviour tree takes over — your combat nodes (fire weapon, reload, etc.) drive the NPC's turn. The `Freeze NPCs in Combat` setting (default on) prevents non-combat movement during fights, so only NPCs with combat handling in their trees will act.

A typical combat tree looks like:

```
Sequence
  ├─ Condition: Combat (my turn)
  ├─ Selector
  │    ├─ Sequence           ← "Am I in range?"
  │    │    ├─ Acquire Target
  │    │    ├─ Condition: Range (≤ 6)
  │    │    └─ Fire Weapon
  │    └─ Sequence           ← "Not in range — move closer"
  │       ├─ Close On Target (range: 6)
  │       └─ Succeed         ← let the next tick handle firing
  └─ End Turn
```

---

## Module Settings

Configure in Game Settings → Configure Settings → NPC Patrols & Dialog.

| Setting | Default | Description |
|---------|---------|-------------|
| Enable NPC Behaviour Trees | On | Master toggle. When off, NPCs stand still. |
| BT Tick Interval (ms) | 2000 | How often the engine checks each NPC's tree. Lower = more responsive, higher = less CPU. |
| Default Proximity Radius | 2 | Grid squares for auto-generated dialog/ambient regions. |
| Ambient Dialog Cooldown | 30 | Seconds before an NPC repeats ambient dialog to the same player. |
| Freeze NPCs in Combat | On | NPCs stop moving during combat unless their tree handles combat. |
| Pathfinding Resolution | 4 | Subdivides each grid square into N×N nav cells. Higher = better routing in tight spaces, more memory. |
| Block Tokens in Pathfinding | On | NPCs route around other tokens instead of walking through them. |
| NPC Door Sounds | Off | Play door sounds when NPCs use doors. |
| BT Combat Debug | Off | Show GM notifications when combat behaviour trees fail. |
| BT Debug Logging | Off | Verbose console logging for troubleshooting. |
| Chat Bubble Scale | 150 | Enlarge chat bubbles so NPC dialog is easier to read. 100% = Foundry default. |

**Hub-only controls** (not in settings — accessed from the hub):

- **Pause/Resume BT** — pauses all behaviour trees world-wide
- **Scene weather** — affects schedule weather conditions
- **Path debug toggle** — show/hide path overlay

---

## Marshal Time Tab

The module adds a **Time** tab to the Marshal sheet for managing game time. You can manually set the time, advance it, or enable auto-advancement at a configurable speed. This is useful for testing schedule-based behaviours and for campaigns where time matters.

---

## Troubleshooting

**My NPC isn't moving.**
- Check that BT is enabled (hub → Scene view → not paused)
- Check that the NPC has a tree assigned (hub → select NPC → Behaviour)
- Check that regions referenced in the tree exist on the current scene
- Enable BT Debug Logging (settings) and check the console (F12)

**My NPC is walking into walls.**
- Increase Pathfinding Resolution (settings) — try 6 or 8 for tight corridors
- Check that walls are drawn correctly (Foundry wall layer)
- Toggle path debug (Alt+Shift+P) to see the navigation grid

**My NPC keeps repeating the same chat line.**
- Wrap the chat action in a **Cooldown** decorator
- For ambient lines, increase the Ambient Dialog Cooldown setting

**My NPC isn't responding to players.**
- Check that the vision node (`Update Visible Tokens`) runs before the condition check
- Check the filter setting (players vs. all vs. NPCs)
- Check the max_range on the vision/face/scan nodes

**My dialog tree isn't triggering.**
- Check that the proximity region exists and covers the right area
- Check the Default Proximity Radius setting
- Make sure the dialog tree is attached to the NPC (hub → Interactions)

---

# Reference

*The sections below are technical reference material for power users and module developers.*

---

## Appendix A: Node Reference

38 node types across five categories. Node IDs are prefixed with `action_`, `condition_`, or use the bare composite/decorator/reference name.

### Composites

| Node | Description |
|------|-------------|
| `sequence` | Runs children in order. Fails on first failure. Resumes running children; re-checks upstream conditions each tick. |
| `selector` | Tries children in order. Succeeds on first success. Reactive — re-checks upstream conditions. |
| `random_sequence` | Like sequence, but shuffles children each pass. |
| `random_selector` | Like selector, but shuffles children each pass. |
| `parallel` | Runs children simultaneously. Succeeds when N succeed (`required`, default all). Re-checks condition children each tick. |

### Decorators

| Node | Description | Key fields |
|------|-------------|------------|
| `inverter` | Inverts child result (success↔failure). Running stays running. | — |
| `cooldown` | Prevents child re-execution for N seconds after a success. Wall-clock time. | `seconds` (default 60) |

### References

| Node | Description | Key fields |
|------|-------------|------------|
| `subtree` | Live reference to a fragment. | `bt_id` |

### Utility

| Node | Description | Key fields |
|------|-------------|------------|
| `comment` | Documentation only — skipped by the engine. Composites filter comment nodes out before iterating children. Use to annotate sections of your tree (e.g. "Morning routine", "Afternoon wander"). | `text` |

### Conditions

All conditions return instantly — never "running."

| Node | Description | Key fields |
|------|-------------|------------|
| `condition_flag` | Checks an actor flag with a comparison operator. | `scope`, `flag_path`, `flag_key`, `operator`, `expected_value` |
| `condition_schedule` | Checks time-of-day, day-of-week, or weather via `check` dropdown. | `check` (`time_window`/`day_of_week`/`weather`), `start_time`, `end_time`, `days`, `weather`, `match` |
| `condition_combat` | Checks combat state via `check` dropdown. | `check` (`active`/`my_turn`/`can_move`) |
| `condition_in_region` | True if NPC is inside the named region. | `region_name` |
| `condition_location` | True if token is at a grid coordinate within N squares. | `dest_x`, `dest_y`, `radius` |
| `condition_visible_tokens` | True if enough visible tokens match the filter. Optionally refreshes first. | `blackboard_key`, `min_count`, `filter`, `name_contains`, `refresh`, `max_range`, `include_self`, `exclude_hidden` |
| `condition_range` | True if distance to a blackboard target matches the threshold. | `target_key`, `operator`, `value`, `measure_mode` |
| `condition_variable` | True if a tree template variable matches. | `variable_key`, `operator`, `expected_value` |
| `condition_character` | Checks pools, traits, skills, gear, flags, edges, equipment, statuses, or scalar stats. | `check_type` + type-specific fields |
| `condition_light` | Checks scene darkness, campaign darkness, position darkness, or token light state. | `mode`, `operator`, `threshold`, `match` |

**Flag operators:** `exists`, `not_exists`, `equals`, `not_equals`, `greater`, `less`, `greater_eq`, `less_eq`, `contains`, `starts_with`.

### Actions

Actions may return "running" while work is in progress.

| Node | Description | Key fields |
|------|-------------|------------|
| `action_move_to` | A* pathfind to grid coordinates. Handles level changes. | `dest_x`, `dest_y`, `dest_level_id` |
| `action_move_to_region` | A* pathfind to nearest cell in a region. Supports flee mode (3× Pace in combat). | `region_name`, `movement_mode` (`normal`/`flee`) |
| `action_wander_region` | Picks a random reachable point in a region and walks there. | `region_name` |
| `action_door_interact` | Path to a door and set its state (open/closed/locked). | `wall_id`, `target_state` |
| `action_close_on_target` | Path toward a target until within range. `approach` chases, `maintain` trails. | `target_key`, `range`, `mode`, `measure_mode` |
| `action_set_visible` | Show/hide token. When hiding, optionally swap to an alternate image. | `visible`, `alternate_image` |
| `action_set_token_image` | Set, restore, or reset token texture. | `mode`, `image_path`, `store_original` |
| `action_face` | Rotate toward a blackboard target, nearest matching token, or compass direction. | `face_direction`, `direction`, `source`, `target_key`, `blackboard_key`, `filter`, `actor_type`, `disposition`, `max_range`, `name_contains`, `exclude_hidden` |
| `action_succeed` | Does nothing; succeeds immediately. Useful as a selector fallback. | — |
| `action_chat` | Sends a chat message and/or speech bubble. Single text or random lines. | `text`, `lines`, `post_to_chat`, `post_as_bubble` |
| `action_set_flag` | Sets a flag on the NPC actor. | `scope`, `flag_path`, `flag_key`, `flag_value` |
| `action_equip_item` | Equip or unequip gear by partial label. | `item_label`, `mode`, `equip_slot` |
| `action_use_item` | Fire the `on_use` boon for a usable item. | `item_label` |
| `action_modify_item` | Add or remove gear on self or a target actor. | `item_label`, `mode`, `quantity`, `target_key` |
| `action_update_visible_tokens` | Scan token vision from NPC's perspective, write to blackboard. | `blackboard_key`, `filter`, `max_range`, `include_self`, `exclude_hidden` |
| `action_acquire_target` | Find closest matching token, store on blackboard. `measure_only` mode measures distance to existing target. | `measure_only`, `target_key`, `measure_mode`, `source`, `blackboard_key`, `filter`, `actor_type`, `disposition`, `max_range`, `name_contains`, `exclude_hidden`, `prefer_same_level` |
| `action_fire_weapon` | Fire equipped weapon at blackboard target. | `target_key`, `slot_key`, `weapon_label` |
| `action_reload_weapon` | Reload equipped weapon. Auto-detects speed loading in combat. Returns failure after success so selectors break out. | `slot_key`, `weapon_label`, `mode`, `only_if_empty` |
| `action_end_turn` | Mark this NPC's combat turn complete. | — |
| `action_set_dialog` | Swap the NPC's dialog tree and/or ambient set at runtime. | `attachment_type`, `tree_id`, `set_id`, `time_start`, `time_end`, `region_radius` |
| `action_wait` | Return "running" for N real-world seconds, then succeed. Wall-clock time. | `seconds` (default 5) |

### Blackboard Fields

| Key | Written by | Read by |
|-----|-----------|---------|
| `visible_tokens` / custom key | `action_update_visible_tokens` | `condition_visible_tokens`, `action_acquire_target` |
| `target` / custom key | `action_acquire_target` | `action_fire_weapon`, `action_close_on_target`, `condition_range`, `action_face` |
| `{key}_range` | `action_acquire_target` (measure) | `condition_range` |
| `combat_active` | Engine | `condition_combat` |
| `is_my_turn` | Engine | `condition_combat` |
| `combat_turn_ended` | `action_end_turn` | Engine |
| `movement_mode` | `action_move_to_region` (flee) | Engine |
| `attack_bonus_dice`, `attack_roll_mod` | Custom (via blackboard) | Combat flow (npc_bonuses step) |
| `weather`, `scene_darkness`, `current_minutes`, `weekday` | Engine | `condition_schedule`, `condition_light` |

### Chat Placeholders

| Placeholder | Value |
|-------------|-------|
| `{name}` | Token or actor name |
| `{actor_name}` | Actor name |
| `{time}` | Current game time (HH:MM) |
| `{weekday}` | Day name |

---

## Appendix B: Boons

The module registers two boon types with the Deadlands-Classic boon pipeline. Both share the `quest_flags` / `posse_quest_flags` namespace with dialog tree flag conditions.

### modify_flag

Create, destroy, or change a quest flag on an actor or posse. Works inside `roll_gate` boon lists.

| Field | Description |
|-------|-------------|
| `mode` | `set` (overwrite), `increment` (add to numeric), or `delete` (remove) |
| `scope_type` | `actor` or `posse` |
| `flag_key` | Flag name |
| `flag_value` | Value to set or delta to increment (ignored in delete mode) |

### flag_condition

Two-sided conditional gate. Checks a quest flag with 9 operators. Satisfied → `satisfied_boons` run; not satisfied → `unsatisfied_boons` run.

| Field | Description |
|-------|-------------|
| `scope_type` | `actor` or `posse` |
| `flag_key` | Flag name |
| `operator` | `exists`, `not_exists`, `equals`, `not_equals`, `greater`, `less`, `greater_eq`, `less_eq`, `contains`, `starts_with` |
| `expected_value` | Expected value |
| `satisfied_boons` | Boons to run if condition met |
| `unsatisfied_boons` | Boons to run if not met |

---

## Appendix C: Node Migration

When nodes are renamed or merged, old trees are automatically migrated on load. No manual editing needed.

| Old node | New node | Notes |
|----------|----------|-------|
| `condition_time` | `condition_schedule` | `check` = `time_window` |
| `condition_day` | `condition_schedule` | `check` = `day_of_week` |
| `condition_weather` | `condition_schedule` | `check` = `weather` |
| `condition_my_turn` | `condition_combat` | `check` = `my_turn` |
| `condition_can_move` | `condition_combat` | `check` = `can_move` |
| `action_emote` | `action_chat` | `lines` joined with `;` |
| `action_face_player` | `action_face` | source/filter/range mapped |
| `action_face_target` | `action_face` | source = `blackboard` |
| `action_measure_range` | `action_acquire_target` | `measure_only` = true |
| `action_flee` | `action_move_to_region` | `movement_mode` = `flee` |
| `action_sleep` | `action_set_visible` | `visible` = false |
| `action_wake` | `action_set_visible` | `visible` = true |
| `action_idle` | `action_succeed` | Direct rename |

Short-name aliases (e.g. `chat` → `action_chat`) are also auto-migrated.

---

## Appendix D: Combat Integration

The module registers three flow steps on the Deadlands-Classic combat pipeline:

| Flow ID | Step ID | Priority | Description |
|---------|---------|----------|-------------|
| `combat.attack.register` | `dc-npc-patrols.npc_bonuses` | 30 | Applies `attack_bonus_dice` and `attack_roll_mod` from the BT blackboard to the combat action. |
| `combat.damage.route` | `dc-npc-patrols.npc_auto_wounds` | 40 | Auto-applies wounds to NPC targets without showing the player damage sheet. |
| `combat.advance` | `dc-npc-patrols.bt_continue` | 200 | Signals the BT engine that the combat action is complete. |

---

## Appendix E: Module API

For module developers and the [dc-agent-bridge](../dc-agent-bridge/README.md) tool pack.

```js
const api = game.modules.get('dc-npc-patrols').api;

// Engine instances
api.engine;            // PatrolEngine (movement helpers)
api.bt_engine;         // BTEngine
api.pathfinding;       // Pathfinding instance
api.region_manager;    // RegionManager
api.run_combat_turn(entry);

// Hub / editors
api.open_panel();
api.open_hub_for_actor(actor_id, { bt_id });
api.close_panel();
api.get_hub();
api.dialog_editor();
api.ambient_editor();
api.bt_editor();

// BT node + variable type registration (for external modules)
api.register_node(node_id, definition);
api.register_variable_type(type_def);
api.init_bt_nodes();
api.get_all_nodes();

// BT validation, import/export
api.validate_bt_tree(tree);
api.serialize_bt_export(tree);
api.parse_bt_import(json);
api.prepare_imported_tree(tree);

// Fragment operations
api.list_fragments();
api.clone_subtree(tree, fragment_id);
api.would_create_cycle(tree, fragment_id);
api.collect_variable_defs(tree);
api.make_subtree_node(fragment_id);
api.generate_fragment_prefix();
api.prefix_fragment_variables(tree, prefix);

// Tree repair
api.migrate_node_types(tree);
api.repair_misplaced_child_nodes(tree);

// Key items
api.key.request_key_unlock(wall_uuid);
api.key.normalize_key_data(data);
api.key.key_data_defaults();

// Path debug (also on window.dcNpcPatrols)
window.dcNpcPatrols.path_debug.toggle();
```

### External Module Extensibility

```js
Hooks.on('dcBtNodesReady', () => {
  game.modules.get('dc-npc-patrols').api.register_node('my_module.my_node', {
    category: 'action',
    label: 'My Custom Action',
    icon: 'fa-solid fa-star',
    description: 'Does something cool.',
    tick: async (node, bb, engine) => { /* ... */ return Status.SUCCESS; },
    editor: {
      fields: [
        { key: 'my_field', type: 'text', label: 'My Field', default: '' },
      ],
    },
  });
});
```

The `dcBtNodesReady` hook fires after all core node registrations are complete.

---

## Appendix F: Architecture

For those who want to understand the internals.

| Component | File | Description |
|-----------|------|-------------|
| BTEngine | `lib/bt_engine.js` | Ticks on configurable interval (default 2s) on GM client. Stateful composites resume running children. Reactive composites re-check upstream conditions. |
| BT Editor | `lib/bt_editor.js` | Visual tree builder: drag-and-drop node palette, structure panel, detail panel, fragment insert/link, import/export. |
| Pathfinding | `lib/pathfinding.js` | Multi-level A* with wall rasterization (Amanatides & Woo). `nav_resolution` setting subdivides grid squares. Token footprints as dynamic obstacles (at query time). Cache invalidated on wall/region/token changes. |
| Template Variables | `lib/bt_variables.js` | `{{var}}` placeholder resolution. Variable types: text, number, boolean, region_select, foundry_id, dialog_tree_select, ambient_set_select, fragment_select, direction_select. |
| Fragments | `lib/bt_subtree.js` | Reusable subtrees. Insert = deep clone. Link = live reference. Circular references blocked. |
| Built-in Fragments | `lib/fragments/builtin_fragments.js` | 8 pre-built fragment definitions (scheduled relocate, wander, greet, challenge, flee, sleep/wake, weather shelter, door keeper). |
| Patrol Hub | `lib/patrol_hub.js` | Unified GM window: scene controls, world content editors, per-NPC config. |
| Combat | `lib/combat_actions.js`, `lib/combat_turn.js`, `lib/combat_movement.js` | Fire weapon, combat turn integration, combat-aware movement. |
| Vision | `lib/token_vision.js` | Scans Foundry token vision, writes to blackboard. Auto-detected per tree. |
| Doors | `lib/doors.js` | Auto-open/close during pathfinding. Key-gated locked/secret doors. |
| Key Items | `lib/key_register.js`, `lib/key_socket.js` | `keys` gear type, GM-brokered unlock for players, NPC key-gated pathfinding. |
| Reactive Composites | `lib/reactive_composite.js` | Upstream condition re-evaluation. Movement path clearing on gate failure. |
| Caching | `lib/bt_tree_cache.js`, `lib/bt_var_def_cache.js`, `lib/bt_active_tokens.js` | Tree hashing, variable def caching, active token tracking. |
| Region Behaviors | `lib/region_behaviors.js` | `dcDialogTree`, `dcAmbient`, `dcTerrainCost` Foundry region behavior types. |
| Marshal Time | `lib/marshal_time_tab.js`, `lib/auto_time.js` | Time management tab on Marshal sheet with auto-advancement. |
| Tree Repair | `lib/bt_tree_repair.js` | Auto-migrates deprecated node types on load. `NODE_MIGRATIONS` map. |

## License

MIT