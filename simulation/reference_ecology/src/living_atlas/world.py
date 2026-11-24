from __future__ import annotations

from dataclasses import asdict, dataclass, field
import json
import math
import random
from pathlib import Path
from typing import Any


@dataclass(frozen=True)
class Species:
    species_id: str
    name: str
    trophic_role: str
    diet: tuple[str, ...]
    preferred_temp_c: float
    cold_tolerance_c: float
    hot_tolerance_c: float
    sociality: float
    territoriality: float
    speed: float
    aggression: float
    warm_spring_affinity: float


@dataclass
class Individual:
    individual_id: str
    species_id: str
    age_days: int
    sex: str
    x: float
    y: float
    hunger: float = 20
    thirst: float = 15
    energy: float = 85
    stress: float = 5
    health: float = 100
    fear: float = 0
    warmth_need: float = 0
    life_stage: str = "adult"
    parent_ids: list[str] = field(default_factory=list)
    guardian_id: str | None = None
    relationships: dict[str, float] = field(default_factory=dict)
    memories: list[str] = field(default_factory=list)
    current_action: str = "idle"
    alive: bool = True

    def clamp(self) -> None:
        for key in ("hunger", "thirst", "energy", "stress", "health", "fear", "warmth_need"):
            setattr(self, key, max(0.0, min(100.0, float(getattr(self, key)))))


@dataclass
class ResourcePatch:
    patch_id: str
    kind: str
    x: float
    y: float
    amount: float
    capacity: float
    temperature_c: float = 12
    radius: float = 4


@dataclass
class Event:
    tick: int
    time_minutes: int
    kind: str
    participants: list[str]
    detail: str


@dataclass
class World:
    seed: int
    ambient_temp_c: float
    season: str
    weather: str
    species: dict[str, Species]
    individuals: dict[str, Individual]
    resources: dict[str, ResourcePatch]
    tick: int = 0
    time_minutes: int = 480
    events: list[Event] = field(default_factory=list)
    _rng: random.Random = field(init=False, repr=False)
    _handled_pairs: set[tuple[str, str]] = field(init=False, repr=False, default_factory=set)

    def __post_init__(self) -> None:
        self._rng = random.Random(self.seed)

    def emit(self, kind: str, ids: list[str], detail: str) -> None:
        self.events.append(Event(self.tick, self.time_minutes, kind, ids, detail))

    @staticmethod
    def distance(a: Individual, b: Individual) -> float:
        return math.hypot(a.x - b.x, a.y - b.y)

    def _move(self, c: Individual, x: float, y: float, speed: float) -> None:
        dx, dy = x - c.x, y - c.y
        d = math.hypot(dx, dy)
        if d > 0.001:
            step = min(d, max(0.05, speed) * 0.25)
            c.x += dx / d * step
            c.y += dy / d * step

    def _resource(self, c: Individual, kinds: set[str]) -> ResourcePatch | None:
        ps = [p for p in self.resources.values() if p.kind in kinds and p.amount > 0]
        return min(ps, key=lambda p: math.hypot(p.x-c.x, p.y-c.y), default=None)

    @staticmethod
    def _remember(c: Individual, note: str) -> None:
        c.memories = (c.memories + [note])[-20:]

    def _flee_if_threatened(self, c: Individual, profile: Species) -> bool:
        if profile.trophic_role == "predator":
            return False
        threats = [p for p in self.individuals.values() if p.alive and p.individual_id != c.individual_id
                   and self.species[p.species_id].trophic_role == "predator" and self.distance(c, p) < 9]
        if not threats:
            c.fear = max(0, c.fear - 3)
            return False
        threat = min(threats, key=lambda p: self.distance(c, p))
        dx, dy = c.x-threat.x, c.y-threat.y
        d = max(0.001, math.hypot(dx, dy))
        c.x += dx/d*profile.speed*0.8
        c.y += dy/d*profile.speed*0.8
        c.fear = min(100, c.fear+25)
        c.stress = min(100, c.stress+12)
        c.current_action = "flee"
        self._remember(c, f"avoided predator:{threat.individual_id}")
        self.emit("prey_fled", [c.individual_id, threat.individual_id], "Threat detected; prey fled and recorded the encounter.")
        return True

    def _predator_hunt(self, c: Individual, profile: Species) -> bool:
        if profile.trophic_role != "predator" or c.hunger < 55:
            return False
        prey = [p for p in self.individuals.values() if p.alive and p.individual_id != c.individual_id
                and self.species[p.species_id].trophic_role in ("herbivore", "omnivore")
                and p.life_stage != "newborn" and self.distance(c, p) < 16]
        if not prey:
            return False
        target = min(prey, key=lambda p: self.distance(c, p))
        self._move(c, target.x, target.y, profile.speed*0.45)
        c.current_action = "stalk"
        if self.distance(c, target) <= 2:
            prey_profile = self.species[target.species_id]
            escape = prey_profile.speed + target.fear*0.025 + target.energy*0.01
            attack = profile.speed*0.55 + profile.aggression*0.25 + self._rng.random()*0.5
            if attack > escape:
                target.health = max(0, target.health-45)
                target.stress = min(100, target.stress+40)
                if target.health == 0:
                    target.alive = False
                    c.hunger = max(0, c.hunger-65)
                    self.emit("hunt_success", [c.individual_id, target.individual_id], "Hunt succeeded; prey died and predator fed.")
                else:
                    self.emit("hunt_injured_prey", [c.individual_id, target.individual_id], "Prey was injured but escaped.")
            else:
                target.fear = min(100, target.fear+35)
                target.current_action = "flee"
                self.emit("hunt_failed", [c.individual_id, target.individual_id], "Prey escaped; predator gained no food.")
            self._remember(c, f"hunt:{target.individual_id}")
            self._remember(target, f"predator:{c.individual_id}")
        return True

    def _territorial_conflict(self, c: Individual, profile: Species) -> bool:
        if profile.territoriality < 0.55:
            return False
        rivals = [p for p in self.individuals.values() if p.alive and p.individual_id != c.individual_id
                  and p.species_id == c.species_id and p.life_stage == "adult" and self.distance(c, p) <= 1.6]
        if not rivals:
            return False
        rival = min(rivals, key=lambda p: self.distance(c, p))
        pair = tuple(sorted((c.individual_id, rival.individual_id)))
        if pair in self._handled_pairs:
            c.current_action = rival.current_action if rival.current_action != "idle" else "socialized"
            return True
        scarce = any(p.kind in profile.diet and p.amount <= p.capacity*0.25
                     and math.hypot(p.x-c.x, p.y-c.y) <= p.radius+1 for p in self.resources.values())
        if not (scarce or c.hunger >= 70 or rival.hunger >= 70):
            return False
        self._handled_pairs.add(pair)
        score = lambda p: profile.aggression*0.45 + profile.territoriality*0.35 + p.energy*0.002 + p.health*0.001
        a, b = score(c), score(rival)
        if abs(a-b) < 0.08:
            c.current_action = rival.current_action = "display"
            c.stress = min(100, c.stress+3)
            rival.stress = min(100, rival.stress+3)
            self.emit("territorial_display", [c.individual_id, rival.individual_id], "Warning displays resolved the challenge without physical contact.")
            return True
        winner, loser = (c, rival) if a > b else (rival, c)
        winner.current_action, loser.current_action = "fight", "retreat"
        loser.health = max(0, loser.health-8)
        loser.fear = min(100, loser.fear+18)
        loser.stress = min(100, loser.stress+16)
        dx, dy = loser.x-winner.x, loser.y-winner.y
        d = max(0.001, math.hypot(dx, dy))
        loser.x += dx/d*1.5
        loser.y += dy/d*1.5
        self._remember(winner, f"dominance:won:{loser.individual_id}")
        self._remember(loser, f"dominance:lost:{winner.individual_id}")
        self.emit("dominance_conflict", [winner.individual_id, loser.individual_id], "Resource-driven challenge ended in retreat; injury, fear and social memory changed.")
        return True

    def _social_encounter(self, c: Individual, profile: Species) -> bool:
        if profile.sociality < 0.35:
            return False
        peers = [p for p in self.individuals.values() if p.alive and p.individual_id != c.individual_id
                 and p.species_id == c.species_id and self.distance(c, p) <= 2.2]
        if not peers:
            return False
        partner = min(peers, key=lambda p: self.distance(c, p))
        pair = tuple(sorted((c.individual_id, partner.individual_id)))
        if pair in self._handled_pairs:
            c.current_action = partner.current_action if partner.current_action != "idle" else "socialized"
            return True
        self._handled_pairs.add(pair)
        familiarity = max(c.relationships.get(partner.individual_id, 0), partner.relationships.get(c.individual_id, 0))
        if partner.individual_id in c.parent_ids or c.individual_id in partner.parent_ids:
            familiarity = max(familiarity, 0.9)
        if c.stress > 70 or partner.stress > 70:
            c.current_action = partner.current_action = "avoid"
            self.emit("social_avoidance", list(pair), "High stress interrupted the approach; both individuals kept distance.")
        elif familiarity >= 0.5:
            c.current_action = partner.current_action = "greet"
            c.relationships[partner.individual_id] = min(1, familiarity+0.08)
            partner.relationships[c.individual_id] = min(1, familiarity+0.08)
            c.stress = max(0, c.stress-4)
            partner.stress = max(0, partner.stress-4)
            self.emit("familiar_greeting", list(pair), "Familiar individuals exchanged a calm greeting and increased reciprocal trust.")
        else:
            c.current_action = partner.current_action = "assess"
            c.relationships[partner.individual_id] = max(0.05, familiarity+0.03)
            partner.relationships[c.individual_id] = max(0.05, familiarity+0.03)
            self.emit("first_meeting", list(pair), "Unfamiliar individuals assessed each other before choosing whether to approach.")
        return True

    def _hot_spring(self, c: Individual, profile: Species) -> bool:
        c.warmth_need = max(0, min(100, (profile.preferred_temp_c-self.ambient_temp_c)*3-c.energy*0.08))
        if profile.warm_spring_affinity < 0.45 or c.warmth_need < 20:
            return False
        pool = self._resource(c, {"hot_spring"})
        if pool is None or abs(pool.temperature_c-profile.preferred_temp_c) > profile.hot_tolerance_c:
            return False
        occupants = sum(1 for p in self.individuals.values() if p.alive and p.current_action == "soak"
                        and math.hypot(p.x-pool.x, p.y-pool.y) <= pool.radius)
        if occupants >= int(pool.capacity):
            c.current_action = "wait_spring"
            c.stress = min(100, c.stress+2)
            self.emit("spring_wait", [c.individual_id], "Preferred geothermal pool is full; individual waited nearby.")
            return True
        self._move(c, pool.x, pool.y, profile.speed)
        if math.hypot(c.x-pool.x, c.y-pool.y) <= pool.radius:
            c.current_action = "soak"
            c.energy = min(100, c.energy+4)
            c.stress = max(0, c.stress-5)
            c.warmth_need = max(0, c.warmth_need-25)
            self.emit("hot_spring_use", [c.individual_id], f"Individual used geothermal pool {pool.patch_id} for warmth and rest.")
        else:
            c.current_action = "seek_spring"
        return True

    def _satisfy_needs(self, c: Individual, profile: Species) -> bool:
        if c.thirst >= 35:
            p = self._resource(c, {"freshwater"})
            if p:
                self._move(c, p.x, p.y, profile.speed)
                if math.hypot(c.x-p.x, c.y-p.y) <= p.radius:
                    used = min(3, p.amount)
                    p.amount -= used
                    c.thirst = max(0, c.thirst-35)
                    c.current_action = "drink"
                    self.emit("drank", [c.individual_id], f"Drank at {p.patch_id}; freshwater decreased by {used:.1f}.")
                else:
                    c.current_action = "seek_water"
                return True
        if c.hunger >= 35:
            p = self._resource(c, set(profile.diet))
            if p:
                self._move(c, p.x, p.y, profile.speed)
                if math.hypot(c.x-p.x, c.y-p.y) <= p.radius:
                    used = min(4, p.amount)
                    p.amount -= used
                    c.hunger = max(0, c.hunger-30)
                    c.current_action = "forage"
                    self.emit("foraged", [c.individual_id], f"Fed at {p.patch_id}; resource decreased by {used:.1f}.")
                else:
                    c.current_action = "seek_food"
                return True
        return False

    def _juvenile(self, c: Individual, profile: Species) -> bool:
        if c.life_stage not in ("newborn", "juvenile") or not c.guardian_id:
            return False
        guardian = self.individuals.get(c.guardian_id)
        if guardian is None or not guardian.alive:
            c.guardian_id = None
            c.stress = min(100, c.stress+10)
            return False
        if self.distance(c, guardian) > 3:
            self._move(c, guardian.x, guardian.y, profile.speed)
            c.current_action = "follow_guardian"
            self.emit("juvenile_reunite", [c.individual_id, guardian.individual_id], "Dependent juvenile moved toward its guardian after separation.")
            return True
        if c.energy > 55 and self._rng.random() < 0.2:
            c.current_action = "play_near_guardian"
            self.emit("juvenile_play", [c.individual_id, guardian.individual_id], "Juvenile played near its guardian.")
            return True
        return False

    def step(self, minutes: int = 10) -> None:
        if minutes <= 0:
            raise ValueError("minutes must be positive")
        self.tick += 1
        self._handled_pairs.clear()
        self.time_minutes = (self.time_minutes+minutes) % 1440
        self.ambient_temp_c += (self._rng.random()-0.5)*0.15
        for c in sorted(self.individuals.values(), key=lambda p: p.individual_id):
            if not c.alive:
                continue
            profile = self.species[c.species_id]
            c.hunger = min(100, c.hunger+minutes*0.018)
            c.thirst = min(100, c.thirst+minutes*0.012)
            c.energy = max(0, c.energy-minutes*(0.004 if c.current_action in ("idle", "rest", "soak") else 0.012))
            c.health = max(0, c.health-(0.25 if c.hunger > 95 else 0)-(0.2 if c.thirst > 95 else 0))
            c.clamp()
            c.current_action = "idle"
            if self._juvenile(c, profile): continue
            if self._flee_if_threatened(c, profile): continue
            if self._predator_hunt(c, profile): continue
            if self._territorial_conflict(c, profile): continue
            if self._social_encounter(c, profile): continue
            if self._hot_spring(c, profile): continue
            if self._satisfy_needs(c, profile): continue
            if c.energy < 25 or self.time_minutes >= 1320 or self.time_minutes < 300:
                c.current_action = "rest"
                c.energy = min(100, c.energy+2.5)
            else:
                c.current_action = "wander"
                c.x += (self._rng.random()-0.5)*profile.speed*0.12
                c.y += (self._rng.random()-0.5)*profile.speed*0.12
            if c.health <= 0 and c.alive:
                c.alive = False
                self.emit("natural_death", [c.individual_id], "Individual died after prolonged unmet needs.")

    def advance_offline(self, elapsed_minutes: int, step_minutes: int = 10) -> None:
        if elapsed_minutes < 0:
            raise ValueError("elapsed_minutes cannot be negative")
        left = elapsed_minutes
        while left:
            amount = min(step_minutes, left)
            self.step(amount)
            left -= amount

    def to_dict(self) -> dict[str, Any]:
        return {"seed":self.seed,"ambient_temp_c":self.ambient_temp_c,"season":self.season,"weather":self.weather,
                "tick":self.tick,"time_minutes":self.time_minutes,
                "species":{k:asdict(v) for k,v in self.species.items()},
                "individuals":{k:asdict(v) for k,v in self.individuals.items()},
                "resources":{k:asdict(v) for k,v in self.resources.items()},
                "events":[asdict(e) for e in self.events]}

    def to_json(self) -> str:
        return json.dumps(self.to_dict(), ensure_ascii=False, sort_keys=True, separators=(",", ":"))

    @classmethod
    def from_json(cls, payload: str) -> "World":
        raw = json.loads(payload)
        species = {k:Species(**{**v,"diet":tuple(v["diet"])}) for k,v in raw["species"].items()}
        individuals = {k:Individual(**v) for k,v in raw["individuals"].items()}
        resources = {k:ResourcePatch(**v) for k,v in raw["resources"].items()}
        return cls(raw["seed"],raw["ambient_temp_c"],raw["season"],raw["weather"],species,individuals,resources,
                   raw["tick"],raw["time_minutes"],[Event(**e) for e in raw.get("events",[])])


def create_demo_world(seed: int = 17) -> World:
    catalog = json.loads(Path(__file__).with_name("species.json").read_text(encoding="utf-8"))
    species = {k:Species(**{**v,"diet":tuple(v["diet"])}) for k,v in catalog.items()}
    individuals = {
        "fox-001":Individual("fox-001","hanabikari",900,"F",2,2,hunger=67,energy=75,relationships={"fox-002":0.85}),
        "fox-002":Individual("fox-002","hanabikari",870,"M",3,2,hunger=62,energy=75,relationships={"fox-001":0.85}),
        "fox-kit-01":Individual("fox-kit-01","hanabikari",40,"F",2.5,2.8,hunger=45,energy=90,life_stage="juvenile",parent_ids=["fox-001","fox-002"],guardian_id="fox-001"),
        "deer-001":Individual("deer-001","tsukitsuno",1400,"F",9,5,hunger=58,energy=80),
        "deer-002":Individual("deer-002","tsukitsuno",950,"M",10,5,hunger=52,energy=80),
        "rockwing-001":Individual("rockwing-001","iwabane",2200,"M",6,8,hunger=20,energy=60),
        "riverwing-001":Individual("riverwing-001","mizuhane",180,"F",11,10,hunger=62,energy=85),
        "riverwing-002":Individual("riverwing-002","mizuhane",160,"M",11.5,10.5,hunger=60,energy=85,relationships={"riverwing-001":0.75}),
        "emberwing-001":Individual("emberwing-001","kagaribi",1800,"F",16,5,hunger=78,energy=80),
    }
    resources = {
        "spring-01":ResourcePatch("spring-01","hot_spring",4,4,100,2,37,2),
        "river-01":ResourcePatch("river-01","freshwater",10,10,200,20,12,3),
        "meadow-01":ResourcePatch("meadow-01","grass",12,5,180,180,15,4),
        "orchard-01":ResourcePatch("orchard-01","fruit",4,1,100,100,16,3),
        "reef-01":ResourcePatch("reef-01","shellfish",12,12,80,80,18,3),
        "insect-bed-01":ResourcePatch("insect-bed-01","insects",8,7,120,120,17,3),
        "scavenge-01":ResourcePatch("scavenge-01","carrion",17,7,30,30,15,2.5),
        "prey-01":ResourcePatch("prey-01","small_prey",15,5.5,50,50,18,2),
    }
    return World(seed,7,"winter","clear",species,individuals,resources)
