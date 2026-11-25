/**
 * Creature layer — integration API
 * --------------------------------
 * `createCreatureLayer(options?)` returns a `CreatureLayer` (see src/render/contracts.ts).
 *
 *   init(ctx)     builds one shared skinned template per species from
 *                 ctx.art.creatures × ctx.species (morphology fractions × body.length).
 *   update(frame, agents, interactions)
 *                 spawns a SkeletonUtils clone per new agent id, removes ids that
 *                 disappeared, and poses every visible agent.
 *   pick(ray)     tests proxy boxes (body + head), not the skinned mesh.
 *   getAnchor(id) chest world position, rendered heading, shoulder height, body length.
 *                 `position` is a live vector updated each frame; copy it if you store it.
 *   setHighlight(id | null)
 *   setDebug({ skeleton, footTargets, contactPoints })
 *
 * Sim contract the renderer assumes:
 *   - `pos` / `heading` are the body origin (about the torso centre). The snout rests
 *     ~`body.headReach` forward along heading. `prevPos` / `prevHeading` are the previous
 *     fixed step; `frame.alpha` interpolates them.
 *   - Grounded feet plant on `terrain.heightAt`. `pos.y` is ignored on the ground and is
 *     the body-origin altitude while `posture === 'airborne'` (and a roost height when
 *     `perch` is clearly above the ground).
 *   - `agent.scale` is growth relative to a healthy adult (use lifeCycle.juvenileScale
 *     for young). Male bulk and horn scale come from CreatureLook.maleVariant.
 *   - Juvenile head/leg/tail proportions come from CreatureLook.juvenile when
 *     `lifeStage === 'juvenile'`.
 *   - Gait (walk / bound / crouch-walk / gallop / biped) is chosen from distance
 *     travelled, not from a clip name. `flightMode` + `bank` drive the wings.
 *   - Interactions are read from the `interactions` array (shared phase clock and
 *     `contactPoint`). `agent.lookAt` and `agent.vocalization` (open while
 *     `env.time <= until`) layer on top.
 *
 * Bone hierarchy per template: root → pelvis → spine → chest → neck → head → jaw /
 * ears / horns / crest; chest → dorsal, front legs, wing chains; pelvis → hind legs,
 * tail chain. Each leg is upper / lower / foot. Wings are upper / mid / hand / fingers.
 */
import { BoxGeometry, Mesh, MeshBasicMaterial, Raycaster, type Scene } from 'three';
// Proxy volume is shared by every agent; disposed with the layer.
import { clone as cloneSkeleton } from 'three/examples/jsm/utils/SkeletonUtils.js';
import type { AgentId, AgentState, InteractionState } from '../../sim/types';
import type { CreatureAnchor, CreatureDebugFlags, CreatureLayer, FrameState, RenderContext } from '../contracts';
import { createCreatureInstance, updateCreature, type CreatureInstance } from './animate';
import { buildSpecies, type SpeciesTemplate } from './build';
import { createCoatMaterial, nightFactor, type CoatMaterial } from './materials';

export interface CreatureLayerOptions {
  /** Full-rate IK and shadow casting inside this distance (metres). Default 48. */
  detailDistance?: number;
  /** Beyond this, agents hold a bind-pose silhouette and stop casting shadows. Default 140. */
  lodDistance?: number;
  /** Beyond this, agents are hidden. Default 340. */
  hideDistance?: number;
}

const proxyGeo = new BoxGeometry(1, 1, 1);
const proxyMat = new MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false });

export function createCreatureLayer(options: CreatureLayerOptions = {}): CreatureLayer {
  const distances = {
    detail: options.detailDistance ?? 48,
    lod: options.lodDistance ?? 140,
    hide: options.hideDistance ?? 340,
  };
  const templates = new Map<string, SpeciesTemplate>();
  const instances = new Map<AgentId, CreatureInstance>();
  const proxies: Mesh[] = [];
  let scene: Scene | null = null;
  let debug: CreatureDebugFlags = {};
  let highlight: AgentId | null = null;
  const warned = new Set<string>();

  function spawn(agent: AgentState, ctx: RenderContext): CreatureInstance | null {
    const template = templates.get(agent.speciesId);
    const look = ctx.art.creatures[agent.speciesId];
    const profile = ctx.species.get(agent.speciesId);
    if (!template || !look || !profile || !scene) {
      if (!warned.has(agent.speciesId)) {
        warned.add(agent.speciesId);
        console.warn(`[creatures] no template for species "${agent.speciesId}"`);
      }
      return null;
    }
    const material: CoatMaterial = createCoatMaterial(look, agent.lifeStage === 'juvenile' ? look.juvenile.coat : null);
    const mesh = cloneSkeleton(template.mesh) as CreatureInstance['mesh'];
    mesh.material = material;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    mesh.traverse((o) => {
      const m = o as Mesh;
      if (m.isMesh && m.userData.coat) {
        m.material = material;
        m.castShadow = true;
        m.receiveShadow = true;
      }
    });
    const inst = createCreatureInstance(template, mesh, material, agent, look, profile);
    const body = new Mesh(proxyGeo, proxyMat);
    const head = new Mesh(proxyGeo, proxyMat);
    body.name = 'pick-body';
    head.name = 'pick-head';
    body.userData.agentId = agent.id;
    head.userData.agentId = agent.id;
    body.visible = false;
    head.visible = false;
    mesh.add(body, head);
    inst.proxies.push(body, head);
    proxies.push(body, head);
    scene.add(mesh);
    for (const foot of inst.footDebug) scene.add(foot);
    if (inst.contactDebug) scene.add(inst.contactDebug);
    instances.set(agent.id, inst);
    return inst;
  }

  function remove(id: AgentId): void {
    const inst = instances.get(id);
    if (!inst || !scene) return;
    scene.remove(inst.mesh);
    inst.material.dispose();
    for (const p of inst.proxies) {
      const i = proxies.indexOf(p);
      if (i >= 0) proxies.splice(i, 1);
    }
    for (const f of inst.footDebug) scene.remove(f);
    if (inst.contactDebug) scene.remove(inst.contactDebug);
    if (inst.helper) scene.remove(inst.helper);
    instances.delete(id);
  }

  let ctxRef: RenderContext | null = null;

  return {
    async init(ctx, onProgress) {
      ctxRef = ctx;
      scene = ctx.scene;
      const entries = [...ctx.species.entries()];
      for (let i = 0; i < entries.length; i++) {
        const [id, profile] = entries[i];
        const look = ctx.art.creatures[id];
        if (!look) continue;
        templates.set(id, buildSpecies(profile, look));
        onProgress?.((i + 1) / Math.max(1, entries.length), `creature ${id}`);
      }
      onProgress?.(1, 'creatures ready');
    },

    update(frame: FrameState, agents: readonly AgentState[], interactions: readonly InteractionState[]) {
      if (!ctxRef || !scene) return;
      const night = nightFactor(frame.env.timeOfDay);
      const seen = new Set<AgentId>();
      for (const agent of agents) {
        seen.add(agent.id);
        let inst = instances.get(agent.id);
        if (!inst) inst = spawn(agent, ctxRef) ?? undefined;
        if (!inst) continue;
        if (inst.look !== ctxRef.art.creatures[agent.speciesId] && agent.lifeStage === 'juvenile') {
          /* coat tint is fixed at spawn from the life stage at first appearance */
        }
        inst.highlighted = highlight === agent.id;
        updateCreature(inst, agent, frame, ctxRef.terrain, interactions, ctxRef.camera.position, debug, distances);
        inst.material.userData.coat.uNight.value = night;
        if (inst.helper && inst.helper.parent !== scene) scene.add(inst.helper);
      }
      for (const id of [...instances.keys()]) {
        if (!seen.has(id)) remove(id);
      }
      const eyeNight = 0.15 + night * 0.7;
      for (const template of templates.values()) {
        const where = ctxRef.art.creatures[template.speciesId]?.material.emissiveWhere;
        template.eyeMat.emissiveIntensity = where === 'eyes' ? eyeNight : night * 0.28;
      }
    },

    pick(raycaster: Raycaster): AgentId | null {
      if (!proxies.length) return null;
      const hits = raycaster.intersectObjects(proxies, false);
      const id = hits[0]?.object.userData.agentId;
      return typeof id === 'number' ? id : null;
    },

    getAnchor(id: AgentId): CreatureAnchor | null {
      const inst = instances.get(id);
      if (!inst) return null;
      const s = inst.mesh.scale.x;
      return {
        position: inst.anchor,
        heading: inst.heading,
        height: inst.template.shoulderHeight * s,
        length: inst.template.bodyLength * s,
      };
    },

    setHighlight(id: AgentId | null) {
      highlight = id;
      for (const inst of instances.values()) inst.highlighted = inst.id === id;
    },

    setDebug(flags: CreatureDebugFlags) {
      debug = { ...flags };
    },

    dispose() {
      for (const id of [...instances.keys()]) remove(id);
      for (const template of templates.values()) {
        for (const d of template.disposables) d.dispose();
      }
      templates.clear();
      proxyGeo.dispose();
      proxyMat.dispose();
      scene = null;
      ctxRef = null;
    },
  };
}
