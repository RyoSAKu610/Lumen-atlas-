import unittest

from living_atlas import create_demo_world, World
from living_atlas.world import Individual
from living_atlas.interactions import InteractionCoordinator


class LivingAtlasSimulationTests(unittest.TestCase):
    def test_seeded_world_is_reproducible(self):
        a = create_demo_world(123)
        b = create_demo_world(123)
        a.advance_offline(180)
        b.advance_offline(180)
        self.assertEqual(a.to_json(), b.to_json())

    def test_snapshot_round_trip_preserves_world_state(self):
        world = create_demo_world(22)
        world.advance_offline(60)
        self.assertEqual(world.to_json(), World.from_json(world.to_json()).to_json())

    def test_familiar_individuals_greet_once_per_tick(self):
        world = create_demo_world()
        a, b = world.individuals["fox-001"], world.individuals["fox-002"]
        a.x, a.y, b.x, b.y = 0, 0, 0.5, 0
        a.hunger = b.hunger = a.thirst = b.thirst = 10
        world.step()
        events = [e for e in world.events if e.kind == "familiar_greeting" and set(e.participants) == {a.individual_id, b.individual_id}]
        self.assertEqual(len(events), 1)

    def test_juvenile_seeks_guardian_when_separated(self):
        world = create_demo_world()
        kit, guardian = world.individuals["fox-kit-01"], world.individuals["fox-001"]
        kit.x, kit.y, guardian.x, guardian.y = -20, -20, 2, 2
        kit.hunger = 5
        world.step()
        self.assertEqual(kit.current_action, "follow_guardian")
        self.assertLess(world.distance(kit, guardian), 32)
        self.assertTrue(any(e.kind == "juvenile_reunite" for e in world.events))

    def test_parent_offspring_kinship_is_recognized(self):
        world = create_demo_world()
        kit, parent = world.individuals["fox-kit-01"], world.individuals["fox-001"]
        kit.x, kit.y, parent.x, parent.y = 2, 2, 2.5, 2
        kit.guardian_id = None
        kit.hunger = parent.hunger = kit.thirst = parent.thirst = 0
        world.step()
        self.assertTrue(any(e.kind == "familiar_greeting" and set(e.participants) == {kit.individual_id, parent.individual_id} for e in world.events))

    def test_cold_sensitive_species_uses_hot_spring(self):
        world = create_demo_world()
        creature = world.individuals["riverwing-001"]
        creature.x = creature.y = 4
        creature.hunger = creature.thirst = 0
        world.ambient_temp_c = 0
        world.step()
        self.assertEqual(creature.current_action, "soak")
        self.assertTrue(any(e.kind == "hot_spring_use" and creature.individual_id in e.participants for e in world.events))

    def test_hot_spring_capacity_limits_occupancy(self):
        world = create_demo_world(41)
        for c in world.individuals.values():
            c.x, c.y, c.hunger, c.thirst = 100+c.x, 100+c.y, 0, 0
        warm = [
            Individual("warm-fox", "hanabikari", 500, "F", 4, 4, hunger=0, thirst=0),
            Individual("warm-rock", "iwabane", 800, "M", 4, 4, hunger=0, thirst=0),
            Individual("warm-river", "mizuhane", 90, "F", 4, 4, hunger=0, thirst=0),
        ]
        world.individuals.update({c.individual_id: c for c in warm})
        world.ambient_temp_c = -10
        world.step()
        actions = [c.current_action for c in warm]
        self.assertEqual(actions.count("soak"), 2)
        self.assertEqual(actions.count("wait_spring"), 1)

    def test_prey_flees_from_nearby_predator(self):
        world = create_demo_world()
        prey, predator = world.individuals["deer-001"], world.individuals["emberwing-001"]
        prey.x, prey.y, predator.x, predator.y = 0, 0, 2, 0
        world.step()
        self.assertEqual(prey.current_action, "flee")
        self.assertGreater(prey.fear, 0)
        self.assertTrue(any(e.kind == "prey_fled" for e in world.events))

    def test_herbivore_consumes_grass_when_hungry(self):
        world = create_demo_world()
        deer = world.individuals["deer-001"]
        deer.x, deer.y = 12, 5
        world.individuals["deer-002"].x = world.individuals["deer-002"].y = 40
        world.individuals["emberwing-001"].x = world.individuals["emberwing-001"].y = 50
        deer.hunger, deer.thirst = 95, 0
        before = world.resources["meadow-01"].amount
        world.step()
        self.assertLess(world.resources["meadow-01"].amount, before)
        self.assertLess(deer.hunger, 95)
        self.assertTrue(any(e.kind == "foraged" for e in world.events))

    def test_resource_pressure_can_trigger_territorial_conflict(self):
        world = create_demo_world(5)
        first = world.individuals["rockwing-001"]
        second = Individual("rockwing-002", "iwabane", 1600, "F", 6.5, 8, hunger=90, energy=20, health=55)
        first.x, first.y, first.hunger, first.energy, first.health = 6, 8, 85, 100, 100
        world.individuals[second.individual_id] = second
        orchard = world.resources["orchard-01"]
        orchard.x, orchard.y, orchard.amount = 6, 8, 5
        world.step()
        self.assertTrue(any(e.kind in ("territorial_display", "dominance_conflict") for e in world.events))
        self.assertIn(first.current_action, ("fight", "display"))

    def test_offline_catchup_advances_clock_and_emits_events(self):
        world = create_demo_world(19)
        world.advance_offline(120)
        self.assertEqual(world.tick, 12)
        self.assertEqual(world.time_minutes, 600)
        self.assertGreater(len(world.events), 0)

    def test_offline_snapshot_continues_deterministically(self):
        world = create_demo_world(88)
        world.advance_offline(90)
        snapshot = world.to_json()
        a, b = World.from_json(snapshot), World.from_json(snapshot)
        a.advance_offline(240)
        b.advance_offline(240)
        self.assertEqual(a.to_json(), b.to_json())

    def test_species_catalog_is_data_driven(self):
        world = create_demo_world()
        self.assertEqual(set(world.species), {"hanabikari", "tsukitsuno", "iwabane", "mizuhane", "kagaribi"})
        self.assertTrue(all(0 <= s.sociality <= 1 for s in world.species.values()))
        self.assertTrue(all(s.hot_tolerance_c >= s.cold_tolerance_c for s in world.species.values()))

    def test_greeting_runs_coordinated_phases_and_releases_pair(self):
        world = create_demo_world()
        coordinator = InteractionCoordinator()
        a, b = world.individuals["fox-001"], world.individuals["fox-002"]
        before = a.relationships[b.individual_id]
        interaction_id = coordinator.start(world, "greeting", a.individual_id, b.individual_id)
        self.assertIsNotNone(interaction_id)
        self.assertEqual(a.current_action, "interaction_greeting_observe")
        a_energy, b_energy = a.energy, b.energy
        coordinator.advance(world, 8)
        instance = coordinator.active[interaction_id]
        self.assertEqual(instance.outcome, "completed")
        self.assertNotIn(a.individual_id, coordinator.busy)
        self.assertGreater(a.relationships[b.individual_id], before)
        self.assertEqual(a.energy, a_energy)
        self.assertEqual(b.energy, b_energy)
        self.assertEqual(a.current_action, "recover")
        self.assertTrue(any(e.kind == "interaction_phase" for e in world.events))
        self.assertTrue(any(e.kind == "interaction_completed" for e in world.events))

    def test_play_is_declined_when_partner_is_stressed(self):
        world = create_demo_world()
        coordinator = InteractionCoordinator()
        a, b = world.individuals["fox-001"], world.individuals["fox-002"]
        b.stress = 85
        self.assertIsNone(coordinator.start(world, "play", a.individual_id, b.individual_id))
        self.assertFalse(coordinator.active)
        self.assertTrue(any(e.kind == "interaction_declined" for e in world.events))

    def test_fear_interrupts_both_participants_and_unlocks_them(self):
        world = create_demo_world()
        coordinator = InteractionCoordinator()
        a, b = world.individuals["fox-001"], world.individuals["fox-002"]
        interaction_id = coordinator.start(world, "greeting", a.individual_id, b.individual_id)
        self.assertIsNotNone(interaction_id)
        b.fear = 95
        coordinator.advance(world, 1)
        self.assertEqual(coordinator.active[interaction_id].outcome, "interrupted")
        self.assertNotIn(a.individual_id, coordinator.busy)
        self.assertNotIn(b.individual_id, coordinator.busy)
        self.assertEqual(a.current_action, "recover")
        self.assertTrue(any(e.kind == "interaction_interrupted" for e in world.events))

    def test_active_interaction_snapshot_restores_pair_locks(self):
        world = create_demo_world()
        coordinator = InteractionCoordinator()
        a, b = world.individuals["fox-001"], world.individuals["fox-002"]
        interaction_id = coordinator.start(world, "greeting", a.individual_id, b.individual_id)
        coordinator.advance(world, 2)
        restored = InteractionCoordinator.from_json(coordinator.to_json())
        self.assertEqual(restored.active[interaction_id].phase, coordinator.active[interaction_id].phase)
        self.assertEqual(restored.busy[a.individual_id], interaction_id)
        self.assertEqual(restored.busy[b.individual_id], interaction_id)

    def test_busy_individual_cannot_start_duplicate_interaction(self):
        world = create_demo_world()
        coordinator = InteractionCoordinator()
        a, b = world.individuals["fox-001"], world.individuals["fox-002"]
        self.assertIsNotNone(coordinator.start(world, "greeting", a.individual_id, b.individual_id))
        self.assertIsNone(coordinator.start(world, "greeting", b.individual_id, a.individual_id))

    def test_warning_interaction_changes_partner_fear_without_damage(self):
        world = create_demo_world()
        coordinator = InteractionCoordinator()
        initiator, partner = world.individuals["rockwing-001"], world.individuals["fox-001"]
        before_health, before_fear = partner.health, partner.fear
        interaction_id = coordinator.start(world, "warning", initiator.individual_id, partner.individual_id)
        self.assertIsNotNone(interaction_id)
        coordinator.advance(world, 7)
        self.assertEqual(coordinator.active[interaction_id].outcome, "completed")
        self.assertEqual(partner.health, before_health)
        self.assertGreater(partner.fear, before_fear)

    def test_conflict_interaction_records_winner_and_retreat(self):
        world = create_demo_world()
        coordinator = InteractionCoordinator()
        initiator, partner = world.individuals["rockwing-001"], world.individuals["fox-001"]
        interaction_id = coordinator.start(world, "conflict", initiator.individual_id, partner.individual_id)
        self.assertIsNotNone(interaction_id)
        coordinator.advance(world, 9)
        self.assertEqual(coordinator.active[interaction_id].outcome, "retreated")
        self.assertTrue(any(note.startswith("conflict:") for c in (initiator, partner) for note in c.memories))

    def test_positive_step_validation(self):
        world = create_demo_world()
        with self.assertRaises(ValueError):
            world.step(0)
        with self.assertRaises(ValueError):
            world.advance_offline(-1)


if __name__ == "__main__":
    unittest.main()
