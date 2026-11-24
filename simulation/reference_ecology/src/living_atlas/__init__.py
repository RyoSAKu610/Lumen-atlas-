"""Deterministic, engine-independent ecology reference model for LIVING ATLAS."""
from .world import World, create_demo_world
from .interactions import InteractionCoordinator

__all__ = ["World", "create_demo_world", "InteractionCoordinator"]
