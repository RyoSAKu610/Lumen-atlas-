import argparse
from .world import create_demo_world


def main() -> None:
    parser = argparse.ArgumentParser(description="Run the LIVING ATLAS reference ecology simulation")
    parser.add_argument("--minutes", type=int, default=180, help="simulated minutes")
    parser.add_argument("--seed", type=int, default=17)
    args = parser.parse_args()
    world = create_demo_world(args.seed)
    world.advance_offline(args.minutes)
    alive = sum(1 for c in world.individuals.values() if c.alive)
    print(f"LIVING ATLAS reference simulation | seed={args.seed} | tick={world.tick} | minute={world.time_minutes}")
    print(f"individuals={alive} alive / {len(world.individuals)} total | events={len(world.events)}")
    for event in world.events[-12:]:
        print(f"[{event.tick:04d}] {event.kind:<22} {', '.join(event.participants)}: {event.detail}")


if __name__ == "__main__":
    main()
