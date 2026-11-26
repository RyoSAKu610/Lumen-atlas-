/**
 * Converts a clamped render-frame duration and the active simulation speed
 * into seconds for procedural creature motion.
 *
 * Keep the upper scale in sync with the observation desk's fastest preset (20×).
 * Simulation time, environment shaders and creature secondary motion must all
 * experience the same time multiplier; only frame delta is clamped to avoid
 * large animation jumps after a suspended tab / dropped frame.
 */
export const MAX_ANIMATION_FRAME_SECONDS = 0.05;
export const MAX_SIMULATION_SPEED = 20;

export function animationDeltaSeconds(frameSeconds: number, timeScale: number): number {
  if (!Number.isFinite(frameSeconds) || !Number.isFinite(timeScale)) return 0;
  const dt = Math.min(MAX_ANIMATION_FRAME_SECONDS, Math.max(0, frameSeconds));
  const scale = Math.min(MAX_SIMULATION_SPEED, Math.max(0, timeScale));
  return dt * scale;
}
