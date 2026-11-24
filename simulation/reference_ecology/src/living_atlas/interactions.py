"""Paired interaction phase coordinator used as a reference for UE5 integration.

This module coordinates state and event phases only. It does not play skeletal
animations, move root bones, resolve collision, or prove physical contact.
"""
from __future__ import annotations

from dataclasses import asdict, dataclass
import json
from typing import Any

from .world import World


@dataclass(frozen=True)
class InteractionContract:
    interaction_type: str
    phases: tuple[str, ...]
    phase_ticks: tuple[int, ...]
    min_familiarity: float = 0.0
    reciprocal: bool = True


@dataclass
class InteractionInstance:
    interaction_id: str
    interaction_type: str
    participants: tuple[str, str]
    initiator_id: str
    partner_id: str
    phases: tuple[str, ...]
    phase_ticks: tuple[int, ...]
    phase_index: int = 0
    phase_elapsed: int = 0
    status: str = "active"
    outcome: str = "pending"
    interrupt_reason: str = ""

    @property
    def phase(self) -> str:
        return self.phases[self.phase_index]


DEFAULT_CONTRACTS = {
    "greeting": InteractionContract(
        "greeting", ("observe", "signal", "approach", "align", "contact", "resolve", "cooldown", "separate"),
        (1, 1, 1, 1, 1, 1, 1, 1), min_familiarity=0.0,
    ),
    "play": InteractionContract(
        "play", ("observe", "signal", "await_response", "approach", "align", "contact", "resolve", "cooldown", "separate"),
        (1, 1, 1, 1, 1, 2, 1, 1, 1), min_familiarity=0.15,
    ),
    "grooming": InteractionContract(
        "grooming", ("observe", "signal", "await_response", "align", "contact", "resolve", "cooldown", "separate"),
        (1, 1, 1, 1, 2, 1, 1, 1), min_familiarity=0.45,
    ),
    "warning": InteractionContract(
        "warning", ("observe", "assess", "signal", "await_response", "resolve", "cooldown", "separate"),
        (1, 1, 1, 1, 1, 1, 1), reciprocal=False,
    ),
    "conflict": InteractionContract(
        "conflict", ("observe", "assess", "signal", "await_response", "approach", "contact", "resolve", "cooldown", "separate"),
        (1, 1, 1, 1, 1, 1, 1, 1, 1), reciprocal=False,
    ),
}


class InteractionCoordinator:
    """Owns paired interaction state, phase progression, and participant locks."""

    def __init__(self, contracts: dict[str, InteractionContract] | None = None) -> None:
        self.contracts = contracts or DEFAULT_CONTRACTS
        self.active: dict[str, InteractionInstance] = {}
        self.busy: dict[str, str] = {}
        self.sequence = 0
        self.clock_tick = 0

    @staticmethod
    def _familiarity(world: World, a_id: str, b_id: str) -> float:
        a, b = world.individuals[a_id], world.individuals[b_id]
        familiarity = max(a.relationships.get(b_id, 0.0), b.relationships.get(a_id, 0.0))
        if b_id in a.parent_ids or a_id in b.parent_ids:
            familiarity = max(familiarity, 0.9)
        return familiarity

    @staticmethod
    def _remember(creature: Any, note: str) -> None:
        creature.memories = (creature.memories + [note])[-20:]

    def _decline(self, world: World, kind: str, a_id: str, b_id: str, reason: str) -> None:
        world.emit("interaction_declined", [a_id, b_id], f"{kind} declined: {reason}")

    def start(self, world: World, interaction_type: str, initiator_id: str, partner_id: str) -> str | None:
        if interaction_type not in self.contracts:
            raise ValueError(f"Unknown interaction type: {interaction_type}")
        if initiator_id == partner_id:
            raise ValueError("An interaction requires two distinct individuals")
        if initiator_id not in world.individuals or partner_id not in world.individuals:
            self._decline(world, interaction_type, initiator_id, partner_id, "participant missing")
            return None
        a, b = world.individuals[initiator_id], world.individuals[partner_id]
        if not a.alive or not b.alive:
            self._decline(world, interaction_type, initiator_id, partner_id, "participant not alive")
            return None
        if initiator_id in self.busy or partner_id in self.busy:
            self._decline(world, interaction_type, initiator_id, partner_id, "participant already engaged")
            return None

        contract = self.contracts[interaction_type]
        familiarity = self._familiarity(world, initiator_id, partner_id)
        if familiarity < contract.min_familiarity:
            self._decline(world, interaction_type, initiator_id, partner_id, "relationship threshold not met")
            return None
        if interaction_type == "conflict" and world.species[a.species_id].aggression < 0.5:
            self._decline(world, interaction_type, initiator_id, partner_id, "initiator lacks a conflict trigger")
            return None
        if contract.reciprocal:
            if b.stress >= 75 or b.fear >= 70:
                self._decline(world, interaction_type, initiator_id, partner_id, "partner signaled fear or high stress")
                return None
            if interaction_type == "play" and (a.energy < 30 or b.energy < 30 or a.fear >= 35 or b.fear >= 35):
                self._decline(world, interaction_type, initiator_id, partner_id, "play conditions not safe for both participants")
                return None

        self.sequence += 1
        interaction_id = f"ix-{world.tick:06d}-{self.sequence:04d}"
        participants = tuple(sorted((initiator_id, partner_id)))
        instance = InteractionInstance(interaction_id, interaction_type, participants, initiator_id, partner_id, contract.phases, contract.phase_ticks)
        self.active[interaction_id] = instance
        self.busy[initiator_id] = interaction_id
        self.busy[partner_id] = interaction_id
        a.current_action = b.current_action = f"interaction_{interaction_type}_{instance.phase}"
        world.emit("interaction_started", list(participants), f"{interaction_id} started: {interaction_type}; phase={instance.phase}.")
        return interaction_id

    def _release(self, world: World, instance: InteractionInstance, outcome: str, reason: str = "") -> None:
        instance.status = "completed" if outcome in ("completed", "retreated") else "interrupted"
        instance.outcome = outcome
        instance.interrupt_reason = reason
        a_id, b_id = instance.participants
        for participant_id in instance.participants:
            self.busy.pop(participant_id, None)
            creature = world.individuals.get(participant_id)
            if creature and creature.alive:
                creature.current_action = "recover"
        if outcome == "completed":
            a, b = world.individuals[a_id], world.individuals[b_id]
            if instance.interaction_type in ("greeting", "play", "grooming"):
                bond = {"greeting": 0.06, "play": 0.10, "grooming": 0.08}[instance.interaction_type]
                a.relationships[b_id] = min(1.0, a.relationships.get(b_id, 0.0) + bond)
                b.relationships[a_id] = min(1.0, b.relationships.get(a_id, 0.0) + bond)
                relief = 4 if instance.interaction_type in ("greeting", "grooming") else 1
                a.stress = max(0.0, a.stress-relief)
                b.stress = max(0.0, b.stress-relief)
                if instance.interaction_type == "play":
                    a.energy = max(0.0, a.energy-6)
                    b.energy = max(0.0, b.energy-6)
            elif instance.interaction_type == "warning":
                initiator, partner = world.individuals[instance.initiator_id], world.individuals[instance.partner_id]
                partner.fear = min(100.0, partner.fear+8)
                partner.stress = min(100.0, partner.stress+4)
                self._remember(initiator, f"warning:signaled:{partner.individual_id}")
                self._remember(partner, f"warning:received:{initiator.individual_id}")
            elif instance.interaction_type == "conflict":
                a, b = world.individuals[a_id], world.individuals[b_id]
                pa, pb = world.species[a.species_id], world.species[b.species_id]
                score_a = pa.aggression+pa.territoriality*0.5+a.energy*0.002+a.health*0.002
                score_b = pb.aggression+pb.territoriality*0.5+b.energy*0.002+b.health*0.002
                winner, loser = (a, b) if score_a >= score_b else (b, a)
                loser.health = max(0.0, loser.health-10)
                loser.fear = min(100.0, loser.fear+18)
                loser.stress = min(100.0, loser.stress+18)
                winner.energy = max(0.0, winner.energy-5)
                winner.current_action, loser.current_action = "recover", "retreat"
                self._remember(winner, f"conflict:won:{loser.individual_id}")
                self._remember(loser, f"conflict:lost:{winner.individual_id}")
                outcome = "retreated"
        instance.outcome = outcome
        instance.status = "completed" if outcome in ("completed", "retreated") else "interrupted"
        world.emit("interaction_completed" if outcome in ("completed", "retreated") else "interaction_interrupted",
                   list(instance.participants),
                   f"{instance.interaction_id} {outcome}; type={instance.interaction_type}; reason={reason or 'normal completion' }.")

    def interrupt(self, world: World, interaction_id: str, reason: str) -> bool:
        instance = self.active.get(interaction_id)
        if instance is None or instance.status != "active":
            return False
        self._release(world, instance, "interrupted", reason)
        return True

    def advance(self, world: World, ticks: int = 1) -> None:
        if ticks < 0:
            raise ValueError("ticks cannot be negative")
        for _ in range(ticks):
            self.clock_tick += 1
            for interaction_id in sorted(self.active):
                instance = self.active[interaction_id]
                if instance.status != "active":
                    continue
                a_id, b_id = instance.participants
                a, b = world.individuals.get(a_id), world.individuals.get(b_id)
                if a is None or b is None or not a.alive or not b.alive:
                    self._release(world, instance, "interrupted", "participant unavailable")
                    continue
                if max(a.stress, b.stress) >= 90 or max(a.fear, b.fear) >= 90:
                    self._release(world, instance, "interrupted", "fear / stress threshold reached")
                    continue
                a.current_action = b.current_action = f"interaction_{instance.interaction_type}_{instance.phase}"
                instance.phase_elapsed += 1
                if instance.phase_elapsed >= instance.phase_ticks[instance.phase_index]:
                    instance.phase_index += 1
                    instance.phase_elapsed = 0
                    if instance.phase_index >= len(instance.phases):
                        self._release(world, instance, "completed")
                    else:
                        world.emit("interaction_phase", list(instance.participants),
                                   f"{interaction_id} entered phase={instance.phase}.")

    def to_json(self) -> str:
        payload = {
            "sequence": self.sequence,
            "clock_tick": self.clock_tick,
            "active": {k: asdict(v) for k, v in self.active.items()},
        }
        return json.dumps(payload, ensure_ascii=False, sort_keys=True)

    @classmethod
    def from_json(cls, payload: str) -> "InteractionCoordinator":
        raw = json.loads(payload)
        coordinator = cls()
        coordinator.sequence = raw["sequence"]
        coordinator.clock_tick = raw["clock_tick"]
        for key, value in raw["active"].items():
            value["participants"] = tuple(value["participants"])
            value["phases"] = tuple(value["phases"])
            value["phase_ticks"] = tuple(value["phase_ticks"])
            instance = InteractionInstance(**value)
            coordinator.active[key] = instance
            if instance.status == "active":
                for participant_id in instance.participants:
                    coordinator.busy[participant_id] = key
        return coordinator
