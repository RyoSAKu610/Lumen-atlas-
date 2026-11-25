/**
 * Coat shader. One MeshStandardMaterial per agent so highlight and juvenile tint
 * are independent; the compiled program is shared (customProgramCacheKey).
 *
 * Vertex colour R carries a region id (region / 8). Bind-pose position and normal
 * drive pattern and belly countershade so marks stay on the skin.
 */
import { BackSide, Color, DoubleSide, MeshStandardMaterial, type WebGLProgramParametersWithUniforms } from 'three';
import type { CreatureLook } from '../../data/schema';

export const REG_BODY = 0;
export const REG_BELLY = 1;
export const REG_DORSAL = 2;
export const REG_HORN = 3;
export const REG_WING = 4;
export const REG_PRIMARY = 5;
export const REG_MANE = 6;

const PATTERN_ID: Record<CreatureLook['material']['pattern'], number> = {
  none: 0,
  stripes: 1,
  spots: 2,
  dapples: 3,
  rosettes: 4,
  gradient: 5,
  bands: 6,
};

const EM_WHERE: Record<CreatureLook['material']['emissiveWhere'], number> = {
  none: 0,
  markings: 1,
  horns: 2,
  dorsal: 3,
  eyes: 4,
  wings: 5,
};

export interface CoatUniforms {
  uBase: { value: Color };
  uBelly: { value: Color };
  uPattern: { value: Color };
  uAccent: { value: Color };
  uDorsal: { value: Color };
  uHorn: { value: Color };
  uEmissive: { value: Color };
  uEmIntensity: { value: number };
  uNight: { value: number };
  uPatternScale: { value: number };
  uPatternId: { value: number };
  uEmWhere: { value: number };
  uHighlight: { value: number };
  uSheen: { value: number };
}

export interface CoatMaterial extends MeshStandardMaterial {
  userData: { coat: CoatUniforms };
}

/** 0 at noon, 1 in full night. Markings use this to strengthen emissive. */
export function nightFactor(hour: number): number {
  const h = ((hour % 24) + 24) % 24;
  if (h < 4.6 || h > 20.2) return 1;
  if (h < 6.6) return 1 - (h - 4.6) / 2;
  if (h > 18.2) return (h - 18.2) / 2;
  return 0;
}

const COAT_VERT = /* glsl */ `
varying vec3 vBind;
varying vec3 vBindN;
varying float vRegion;
`;

const COAT_FRAG = /* glsl */ `
varying vec3 vBind;
varying vec3 vBindN;
varying float vRegion;
uniform vec3 uBase;
uniform vec3 uBelly;
uniform vec3 uPattern;
uniform vec3 uAccent;
uniform vec3 uDorsal;
uniform vec3 uHorn;
uniform vec3 uEmissive;
uniform float uEmIntensity;
uniform float uNight;
uniform float uPatternScale;
uniform float uPatternId;
uniform float uEmWhere;
uniform float uHighlight;
uniform float uSheen;

float laHash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

float laStripes(vec3 p, float s) {
  float t = 0.5 + 0.5 * sin(p.z * s * 2.15 + sin(p.y * s * 0.7) * 0.35);
  return smoothstep(0.42, 0.72, t);
}

float laBands(vec3 p, float s) {
  float t = 0.5 + 0.5 * sin(p.z * s * 3.1);
  return smoothstep(0.55, 0.78, t);
}

float laSpots(vec3 p, float s) {
  vec2 cell = floor(p.xz * s);
  vec2 f = fract(p.xz * s) - 0.5;
  float h = laHash(cell);
  vec2 o = vec2(laHash(cell + 1.7), laHash(cell + 4.2)) - 0.5;
  float d = length(f - o * 0.45);
  return smoothstep(0.28, 0.12, d) * step(0.42, h);
}

float laDapples(vec3 p, float s) {
  vec2 cell = floor(p.xz * s * 0.55);
  vec2 f = fract(p.xz * s * 0.55) - 0.5;
  float h = laHash(cell);
  float d = length(f);
  float blob = smoothstep(0.48, 0.12, d) * (0.45 + 0.55 * h);
  float n = laHash(floor(p.xy * s * 1.3));
  return clamp(blob * 0.85 + smoothstep(0.72, 0.9, n) * 0.35, 0.0, 1.0);
}

float laRosettes(vec3 p, float s) {
  vec2 cell = floor(p.xz * s);
  vec2 f = fract(p.xz * s) - 0.5;
  float h = laHash(cell);
  vec2 o = vec2(laHash(cell + 2.3), laHash(cell + 8.1)) - 0.5;
  float d = length(f - o * 0.35);
  float ring = smoothstep(0.34, 0.26, d) * (1.0 - smoothstep(0.16, 0.08, d));
  return ring * step(0.38, h);
}

float laMask(vec3 p) {
  float s = max(0.35, uPatternScale);
  if (uPatternId < 0.5) return 0.0;
  if (uPatternId < 1.5) return laStripes(p, s);
  if (uPatternId < 2.5) return laSpots(p, s);
  if (uPatternId < 3.5) return laDapples(p, s * 0.85);
  if (uPatternId < 4.5) return laRosettes(p, s * 0.8);
  if (uPatternId < 5.5) {
    float g = clamp(p.y * 0.35 + 0.5, 0.0, 1.0);
    return smoothstep(0.25, 0.85, g);
  }
  return laBands(p, s);
}
`;

export function createCoatMaterial(look: CreatureLook, coatTint: string | null): CoatMaterial {
  const mat = new MeshStandardMaterial({
    color: '#ffffff',
    roughness: look.material.roughness,
    metalness: 0.02,
    vertexColors: true,
    side: DoubleSide,
  }) as CoatMaterial;
  mat.shadowSide = BackSide;
  const base = new Color(look.material.base);
  const belly = new Color(look.material.belly);
  if (coatTint) {
    const tint = new Color(coatTint);
    base.lerp(tint, 0.72);
    belly.lerp(tint, 0.45);
  }
  const uniforms: CoatUniforms = {
    uBase: { value: base },
    uBelly: { value: belly },
    uPattern: { value: new Color(look.material.patternColor) },
    uAccent: { value: new Color(look.material.accent) },
    uDorsal: { value: new Color(look.material.dorsalColor) },
    uHorn: { value: new Color(look.material.hornColor) },
    uEmissive: { value: new Color(look.material.emissive ?? '#000000') },
    uEmIntensity: { value: look.material.emissiveIntensity },
    uNight: { value: 0 },
    uPatternScale: { value: look.material.patternScale },
    uPatternId: { value: PATTERN_ID[look.material.pattern] ?? 0 },
    uEmWhere: { value: EM_WHERE[look.material.emissiveWhere] ?? 0 },
    uHighlight: { value: 0 },
    uSheen: { value: look.material.sheen },
  };
  mat.userData = { coat: uniforms };
  mat.customProgramCacheKey = () => 'living-atlas-coat-v1';
  mat.onBeforeCompile = (shader: WebGLProgramParametersWithUniforms) => {
    const u = uniforms;
    shader.uniforms.uBase = u.uBase;
    shader.uniforms.uBelly = u.uBelly;
    shader.uniforms.uPattern = u.uPattern;
    shader.uniforms.uAccent = u.uAccent;
    shader.uniforms.uDorsal = u.uDorsal;
    shader.uniforms.uHorn = u.uHorn;
    shader.uniforms.uEmissive = u.uEmissive;
    shader.uniforms.uEmIntensity = u.uEmIntensity;
    shader.uniforms.uNight = u.uNight;
    shader.uniforms.uPatternScale = u.uPatternScale;
    shader.uniforms.uPatternId = u.uPatternId;
    shader.uniforms.uEmWhere = u.uEmWhere;
    shader.uniforms.uHighlight = u.uHighlight;
    shader.uniforms.uSheen = u.uSheen;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${COAT_VERT}`)
      .replace('#include <beginnormal_vertex>', `#include <beginnormal_vertex>\n  vBindN = vec3(normal);\n`)
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>\n  vBind = position;\n  vRegion = color.r * 8.0;\n`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${COAT_FRAG}`)
      .replace(
        '#include <color_fragment>',
        /* glsl */ `
        #include <color_fragment>
        {
          float r = vRegion;
          vec3 coat = uBase;
          float belly = smoothstep(0.25, -0.55, vBindN.y);
          if (r > 0.5 && r < 1.5) belly = 1.0;
          coat = mix(coat, uBelly, belly * 0.9);
          if (r > 1.5 && r < 2.5) {
            float moss = laHash(floor(vBind.xz * 2.4));
            coat = mix(uDorsal, uBase, moss * 0.28);
          } else if (r > 5.5 && r < 6.5) {
            coat = mix(uDorsal, uBase, 0.15);
          }
          if (r > 2.5 && r < 3.5) coat = uHorn;
          if (r > 3.5 && r < 4.5) {
            float bar = smoothstep(0.22, 0.02, abs(vBind.z)) * smoothstep(0.15, 0.55, abs(vBind.x));
            coat = mix(uBase, uAccent, bar * 0.65);
          }
          if (r > 4.5 && r < 5.5) coat = mix(uPattern, uBase, 0.22);
          float mask = laMask(vBind);
          float patAmt = (r > 2.5) ? 0.18 : 0.62;
          if (r > 1.5 && r < 2.5) patAmt = 0.22;
          coat = mix(coat, uPattern, mask * patAmt);
          coat += vec3(0.16, 0.12, 0.05) * uHighlight;
          diffuseColor.rgb = coat;
        }
        `,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>\n  roughnessFactor = clamp(roughnessFactor * mix(1.0, 0.62, uSheen), 0.04, 1.0);\n`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        /* glsl */ `
        #include <emissivemap_fragment>
        {
          float r = vRegion;
          float mask = laMask(vBind);
          float em = 0.0;
          if (uEmWhere > 0.5 && uEmWhere < 1.5) em = mask;
          else if (uEmWhere > 1.5 && uEmWhere < 2.5 && r > 2.5 && r < 3.5) em = 1.0;
          else if (uEmWhere > 2.5 && uEmWhere < 3.5 && r > 1.5 && r < 2.5) em = 1.0;
          else if (uEmWhere > 4.5 && uEmWhere < 5.5 && r > 3.5 && r < 5.5) em = 0.85;
          float night = clamp(uNight, 0.0, 1.0);
          totalEmissiveRadiance += uEmissive * uEmIntensity * em * mix(0.1, 1.0, night);
          totalEmissiveRadiance += vec3(0.75, 0.55, 0.22) * uHighlight * 0.22;
        }
        `,
      );
  };
  return mat;
}

export function createEyeMaterial(color: string): MeshStandardMaterial {
  const c = new Color(color);
  return new MeshStandardMaterial({
    color: c,
    roughness: 0.22,
    metalness: 0.08,
    emissive: c,
    emissiveIntensity: 0,
  });
}
