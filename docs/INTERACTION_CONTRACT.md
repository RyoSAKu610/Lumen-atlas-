# LIVING ATLAS — Interaction Contract

This defines the shared contract between Creature AI, Animation / Character TD, UE5 gameplay engineering, and ecology simulation. It is an interface specification, not proof that animations or physical interactions already exist.

## Interaction lifecycle
Observe → Assess → Signal → AwaitResponse → Approach → Align → Contact → Resolve → Cooldown → Separate.

Any phase may be interrupted by threat, pain, fatigue, partner refusal, resource loss, environmental danger, or target loss. Interruption must produce a valid recovery / separation path for both participants.

## Required encounter context
Every interaction request carries:
- interaction_id: stable unique event ID.
- interaction_type: greeting, play, grooming, warning, dominance, conflict, courtship, parental_care, cooperative_feeding, avoidance, submission, retreat or predation.
- initiator_id and partner_id (or participant array for group interactions).
- relationship_snapshot: familiarity, kinship, trust, affection, dominance, rivalry, fear and cooperation at decision time.
- motivation: hunger, social_need, stress, threat, territory_pressure, reproductive_drive, juvenile_dependency, thermal_need or resource_competition.
- phase, phase_started_at, expected_duration, and interruption reason where applicable.
- animation_contract_id: paired clip / animation set selected by Animation TD.
- outcome: completed, declined, interrupted, escalated, retreated or unresolved.

## Animation hand-off contract
Every paired / group animation asset defines:
1. Participant roles and compatible anatomical / skeleton families.
2. Entry distance, facing angle and approach arc.
3. Root-motion ownership and movement authority.
4. Sync markers for anticipation, signal, contact, reaction, release and exit.
5. Contact sockets / surfaces and tolerance ranges.
6. Partner reaction pose / clip; never animate only the initiator.
7. Interrupt windows and safe recovery pose.
8. Separation distance and cooldown.
9. In-engine captures of both participants at normal speed and slow playback.

## Behavioral acceptance rules
- Familiarity and kinship affect approach and signal.
- Fear or refusal prevents forced contact.
- Play requires a reciprocal invitation; a fleeing animal is not a play partner.
- Grooming requires the recipient to offer / permit a body region.
- Warning displays are valid outcomes; conflict is not the default result of proximity.
- Resource competition, territoriality, age, health, fatigue, body size and social memory affect escalation.
- Predation is a distinct encounter family, not generic social interaction.
- Juveniles need age-appropriate movement and guardian response.

## Event authority and de-duplication
Only one authoritative interaction may exist for an unordered participant pair and channel during a simulation tick, unless the interaction explicitly supports a group. The interaction coordinator owns phase progression; AI proposes and accepts / declines, animation reports phase markers and completion, and ecology applies consequences.

## Consequences
- Greeting: relationship / stress changes.
- Play: social learning, energy expenditure and affiliation.
- Grooming: bond / comfort changes; parasite effects only when species biology supports them.
- Warning: fear / territorial pressure / distance changes without forced damage.
- Conflict: dominance memory, injury, fatigue and resource / territory consequences.
- Retreat: fear and avoidance memory.
- Parental care: juvenile safety, bond, nutrition and development effects.
- Cooperative feeding: shared resource depletion and relationship changes.

## Test matrix
Validate familiar greeting, stranger assessment, fearful refusal, play invitation / response, grooming permission / interruption, warning-only dominance display, conflict with retreat, parent / juvenile reunion, and predator / prey chase interruption. Each scenario must be reproducible with a seeded world and record decision, animation contract, phase trace and outcome.
