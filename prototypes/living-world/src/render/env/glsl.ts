/** Shared GLSL snippets. Shaders are classic GLSL1; Three r187 promotes ShaderMaterial to GLSL3. */

export const NOISE_GLSL = /* glsl */ `
float laHash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float laNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = laHash(i);
  float b = laHash(i + vec2(1.0, 0.0));
  float c = laHash(i + vec2(0.0, 1.0));
  float d = laHash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
float laFbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  vec2 shift = vec2(13.1, 7.7);
  for (int i = 0; i < 4; i++) {
    v += a * laNoise(p);
    p = p * 2.03 + shift;
    shift = vec2(shift.y, -shift.x);
    a *= 0.5;
  }
  return v;
}
`;

/** Height-weighted valley mist on top of the art exponential fog. `uMist` is already weather-scaled. */
export const FOG_GLSL = /* glsl */ `
uniform vec3 uFogColor;
uniform float uFogDensity;
uniform float uFloorY;
uniform float uMist;
float laFogAmount(vec3 worldPos) {
  float dist = distance(worldPos, cameraPosition);
  float base = 1.0 - exp(-uFogDensity * uFogDensity * dist * dist);
  float basin = exp(-max(worldPos.y - uFloorY, 0.0) * 0.048);
  float aerial = 1.0 - exp(-dist * max(uFogDensity, 0.0004) * 3.6);
  return clamp(base + basin * aerial * uMist, 0.0, 0.94);
}
vec3 laApplyFog(vec3 color, vec3 worldPos) {
  return mix(color, uFogColor, laFogAmount(worldPos));
}
`;

export const FOG_UNIFORMS_DECL = /* glsl */ `
uniform vec3 uFogColor;
uniform float uFogDensity;
uniform float uFloorY;
uniform float uMist;
`;
