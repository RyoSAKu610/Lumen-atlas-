# Interaction Coordinator — Reference Implementation

## Purpose

The Python reference coordinator gives Creature AI and Animation / Character TD a shared, executable interaction lifecycle. It models the decision and event contract only; it is not an animation player.

## API

- `InteractionCoordinator.start(world, type, initiator_id, partner_id)`: validates participants, current locks, relationship threshold, consent / stress / fear gates and interaction preconditions. Returns an interaction ID or `None` with a decline event.
- `InteractionCoordinator.advance(world, ticks)`: advances each active interaction through its defined phases and emits phase / completion events.
- `InteractionCoordinator.interrupt(world, interaction_id, reason)`: safely ends an active pair and returns both individuals to recovery.
- `to_json()` / `from_json()`: serializes active instances and reconstructs participant locks after restore.

## Default phase contracts

| Type | Phases | Gate / outcome |
|---|---|---|
| Greeting | observe → signal → approach → align → contact → resolve → cooldown → separate | Familiarity / kinship informs bond changes; no physical damage |
| Play | observe → signal → await_response → approach → align → contact → resolve → cooldown → separate | Requires familiarity, energy and low fear / stress; costs energy |
| Grooming | observe → signal → await_response → align → contact → resolve → cooldown → separate | Requires a stronger relationship threshold |
| Warning | observe → assess → signal → await_response → resolve → cooldown → separate | Adds fear / stress to the partner, no damage |
| Conflict | observe → assess → signal → await_response → approach → contact → resolve → cooldown → separate | Aggressive initiator required; resolves winner / retreat, injury and memory |

## Animation integration boundary

The current reference uses action state strings such as `interaction_greeting_contact` and phase events. The production UE5 Animation TD must map each phase to actual animation assets and add:
- root motion and movement ownership,
- participant role and orientation,
- sync markers / notify windows,
- contact sockets and distance tolerances,
- partner reaction poses,
- interruption windows, recovery and exit spacing.

Never mark physical interaction as implemented until both participants play synchronized clips and contact / root motion has been inspected in-engine.

## Current automated validation

The test suite verifies:
- completion of the greeting phase sequence and relationship consequence,
- refusal of play under high partner stress,
- interruption and lock release when fear crosses threshold,
- restoration of active interaction and participant locks,
- duplicate pair interaction prevention,
- warning consequence without damage,
- conflict resolution to retreat with memory records.

See `simulation/reference_ecology/tests/test_ecosystem.py`.
