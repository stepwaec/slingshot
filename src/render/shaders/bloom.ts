import * as THREE from "three";

/**
 * Selective bloom. Port of design/shaders/bloom.frag.
 * design/shader-specs.md §6.3 and design/IMPLEMENTING.md.
 * The bright pass reads the emissive layer only. The composite is added
 * to the world image. The screen scene, including the HUD overlays, is drawn after.
 * Strength stays at 0.45, under the 0.6 cap. There is no plume-halo mesh.
 */
export const EMISSIVE_LAYER = 1;

/** Luma threshold. Ice and cloud tops stay out of this pass because they are not in the emissive layer. */
export const BLOOM_THRESHOLD = 0.85;
export const BLOOM_KNEE = 0.15;
/** Additive weight on (half-res blur + quarter-res blur). IMPLEMENTING.md caps this at 0.6. */
export const BLOOM_STRENGTH = 0.45;

export const BLOOM_VERTEX = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

export const BLOOM_FRAGMENT = /* glsl */ `
precision highp float;
uniform sampler2D uTex, uTex2, uTex3;
uniform vec2 uTexel, uDir;
uniform float uMode, uThreshold, uKnee, uStrength;
varying vec2 vUv;
float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
void main() {
  if (uMode < 0.5) {
    vec3 c = 0.25 * (
      texture2D(uTex, vUv + uTexel * vec2(-0.5, -0.5)).rgb +
      texture2D(uTex, vUv + uTexel * vec2(0.5, -0.5)).rgb +
      texture2D(uTex, vUv + uTexel * vec2(-0.5, 0.5)).rgb +
      texture2D(uTex, vUv + uTexel * vec2(0.5, 0.5)).rgb
    );
    float l = luma(c);
    float k = clamp(l - uThreshold + uKnee, 0.0, 2.0 * uKnee);
    float w = max(k * k / (4.0 * uKnee + 1e-5), l - uThreshold) / max(l, 1e-5);
    gl_FragColor = vec4(c * max(w, 0.0), 1.0);
  } else if (uMode < 1.5) {
    vec3 s = texture2D(uTex, vUv).rgb * 0.2270;
    s += (texture2D(uTex, vUv + uDir * uTexel * 1.3846).rgb + texture2D(uTex, vUv - uDir * uTexel * 1.3846).rgb) * 0.3162;
    s += (texture2D(uTex, vUv + uDir * uTexel * 3.2308).rgb + texture2D(uTex, vUv - uDir * uTexel * 3.2308).rgb) * 0.0703;
    gl_FragColor = vec4(s, 1.0);
  } else {
    vec3 sc = texture2D(uTex, vUv).rgb;
    vec3 b = texture2D(uTex2, vUv).rgb + texture2D(uTex3, vUv).rgb;
    gl_FragColor = vec4(sc + uStrength * b, 1.0);
  }
}
`;

export function markEmissive(object: THREE.Object3D): void {
  object.layers.enable(EMISSIVE_LAYER);
}

interface Targets {
  emit: THREE.WebGLRenderTarget;
  h1: THREE.WebGLRenderTarget;
  h2: THREE.WebGLRenderTarget;
  q1: THREE.WebGLRenderTarget;
  q2: THREE.WebGLRenderTarget;
  w: number;
  h: number;
}

/** True when a visible mesh on the emissive layer will be drawn. */
function chainVisible(object: THREE.Object3D): boolean {
  let current: THREE.Object3D | null = object;
  while (current) {
    if (!current.visible) return false;
    current = current.parent;
  }
  return true;
}

function emissiveOnScreen(root: THREE.Object3D): boolean {
  let found = false;
  root.traverse((object) => {
    if (found || !chainVisible(object)) return;
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh && !(object as THREE.Points).isPoints) return;
    if (object.layers.isEnabled(EMISSIVE_LAYER)) found = true;
  });
  return found;
}

/**
 * Star and compact impostors write `gl_FragCoord` against `uCenter` and `uR`
 * in full drawing-buffer pixels. Scale those while the emissive target is half size.
 */
function scalePixelUniforms(root: THREE.Object3D, factor: number): void {
  root.traverse((object) => {
    if (!object.layers.isEnabled(EMISSIVE_LAYER)) return;
    const material = (object as THREE.Mesh).material as THREE.ShaderMaterial | undefined;
    const center = material?.uniforms?.uCenter?.value as THREE.Vector2 | undefined;
    const radius = material?.uniforms?.uR;
    if (center && typeof radius?.value === "number") {
      center.multiplyScalar(factor);
      radius.value *= factor;
    }
  });
}

function makeTarget(w: number, h: number, depth: boolean): THREE.WebGLRenderTarget {
  const target = new THREE.WebGLRenderTarget(Math.max(1, w), Math.max(1, h), {
    depthBuffer: depth,
    stencilBuffer: false,
    magFilter: THREE.LinearFilter,
    minFilter: THREE.LinearFilter,
    wrapS: THREE.ClampToEdgeWrapping,
    wrapT: THREE.ClampToEdgeWrapping,
    format: THREE.RGBAFormat,
    type: THREE.UnsignedByteType,
    colorSpace: THREE.SRGBColorSpace,
    generateMipmaps: false,
  });
  target.texture.colorSpace = THREE.SRGBColorSpace;
  return target;
}

/**
 * Emissive-layer bloom added onto the world image already in the canvas.
 * Mode 2 of bloom.frag is `scene + strength * (half + quarter)`. The scene
 * is already drawn, so this pass adds `strength * (half + quarter)` with a
 * black scene sample. Callers draw the screen scene afterwards, so HUD
 * overlays stay sharp and unbloomed.
 */
export class SelectiveBloom {
  private readonly material: THREE.ShaderMaterial;
  private readonly quadScene = new THREE.Scene();
  private readonly quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, -1, 1);
  private readonly size = new THREE.Vector2();
  private readonly saved = new THREE.Color();
  private readonly blank = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1);
  private targets: Targets | null = null;

  constructor() {
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uTex: { value: null },
        uTex2: { value: null },
        uTex3: { value: null },
        uTexel: { value: new THREE.Vector2(1, 1) },
        uDir: { value: new THREE.Vector2(1, 0) },
        uMode: { value: 0 },
        uThreshold: { value: BLOOM_THRESHOLD },
        uKnee: { value: BLOOM_KNEE },
        uStrength: { value: BLOOM_STRENGTH },
      },
      vertexShader: BLOOM_VERTEX,
      fragmentShader: BLOOM_FRAGMENT,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
      blending: THREE.NoBlending,
      precision: "highp",
    });
    this.blank.needsUpdate = true;
    this.blank.colorSpace = THREE.NoColorSpace;
    this.quadScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material));
  }

  /**
   * Adds the bloom on top of the current canvas. The world scene must already
   * be drawn. Returns false when the buffers are not ready.
   */
  composite(
    renderer: THREE.WebGLRenderer,
    world: THREE.Scene,
    worldCamera: THREE.Camera,
    screen: THREE.Scene,
    screenCamera: THREE.Camera,
  ): boolean {
    renderer.getDrawingBufferSize(this.size);
    if (this.size.x < 2 || this.size.y < 2) return false;
    if (!emissiveOnScreen(world) && !emissiveOnScreen(screen)) return false;
    const targets = this.ensure(this.size.x, this.size.y);
    renderer.getClearColor(this.saved);
    const clearAlpha = renderer.getClearAlpha();

    this.material.uniforms.uTex.value = this.blank;
    this.material.uniforms.uTex2.value = this.blank;
    this.material.uniforms.uTex3.value = this.blank;
    this.material.blending = THREE.NoBlending;
    renderer.resetState();

    renderer.setRenderTarget(targets.emit);
    renderer.setClearColor(0x000000, 0);
    renderer.clear(true, true, true);
    const worldMask = worldCamera.layers.mask;
    worldCamera.layers.set(EMISSIVE_LAYER);
    // Impostors place themselves with gl_FragCoord in full-buffer pixels.
    // The emissive target is half resolution, so those uniforms scale to match.
    scalePixelUniforms(world, 0.5);
    renderer.render(world, worldCamera);
    scalePixelUniforms(world, 2);
    worldCamera.layers.mask = worldMask;
    const screenMask = screenCamera.layers.mask;
    screenCamera.layers.set(EMISSIVE_LAYER);
    renderer.clearDepth();
    renderer.render(screen, screenCamera);
    screenCamera.layers.mask = screenMask;
    renderer.setClearColor(this.saved, clearAlpha);

    this.blur(renderer, targets);
    this.add(renderer, targets);
    return true;
  }

  private ensure(w: number, h: number): Targets {
    const current = this.targets;
    if (current && current.w === w && current.h === h) return current;
    current?.emit.dispose();
    current?.h1.dispose();
    current?.h2.dispose();
    current?.q1.dispose();
    current?.q2.dispose();
    const hw = Math.max(1, Math.floor(w / 2));
    const hh = Math.max(1, Math.floor(h / 2));
    const qw = Math.max(1, Math.floor(w / 4));
    const qh = Math.max(1, Math.floor(h / 4));
    const next = {
      emit: makeTarget(Math.max(1, Math.floor(w / 2)), Math.max(1, Math.floor(h / 2)), true),
      h1: makeTarget(hw, hh, false),
      h2: makeTarget(hw, hh, false),
      q1: makeTarget(qw, qh, false),
      q2: makeTarget(qw, qh, false),
      w,
      h,
    };
    this.targets = next;
    return next;
  }

  /** Bright pass to 1/2, 9-tap gaussian, then the same pair at 1/4. Matches the preview. */
  private blur(renderer: THREE.WebGLRenderer, targets: Targets): void {
    this.pass(renderer, 0, targets.emit, targets.h1, targets.h1, targets.q1);
    this.pass(renderer, 1, targets.h1, targets.h2, targets.h1, targets.q1, 1, 0);
    this.pass(renderer, 1, targets.h2, targets.h1, targets.h1, targets.q1, 0, 1);
    this.pass(renderer, 0, targets.h1, targets.q1, targets.h1, targets.q1);
    this.pass(renderer, 1, targets.q1, targets.q2, targets.h1, targets.q1, 1, 0);
    this.pass(renderer, 1, targets.q2, targets.q1, targets.h1, targets.q1, 0, 1);
  }

  /** bloom.frag mode 2 with a black scene, added onto the canvas. */
  private add(renderer: THREE.WebGLRenderer, targets: Targets): void {
    this.material.blending = THREE.CustomBlending;
    this.material.blendSrc = THREE.OneFactor;
    this.material.blendDst = THREE.OneFactor;
    this.material.blendSrcAlpha = THREE.ZeroFactor;
    this.material.blendDstAlpha = THREE.OneFactor;
    this.material.transparent = true;
    renderer.setRenderTarget(null);
    const uniforms = this.material.uniforms;
    uniforms.uMode.value = 2;
    uniforms.uTex.value = this.blank;
    uniforms.uTex2.value = targets.h1.texture;
    uniforms.uTex3.value = targets.q1.texture;
    renderer.render(this.quadScene, this.quadCam);
    this.material.blending = THREE.NoBlending;
    this.material.transparent = false;
  }

  private pass(
    renderer: THREE.WebGLRenderer,
    mode: number,
    src: THREE.WebGLRenderTarget,
    dst: THREE.WebGLRenderTarget | null,
    half: THREE.WebGLRenderTarget,
    quarter: THREE.WebGLRenderTarget,
    dirX = 1,
    dirY = 0,
  ): void {
    renderer.setRenderTarget(dst);
    const uniforms = this.material.uniforms;
    uniforms.uMode.value = mode;
    uniforms.uTex.value = src.texture;
    uniforms.uTex2.value = mode > 1.5 ? half.texture : this.blank;
    uniforms.uTex3.value = mode > 1.5 ? quarter.texture : this.blank;
    (uniforms.uTexel.value as THREE.Vector2).set(1 / src.width, 1 / src.height);
    (uniforms.uDir.value as THREE.Vector2).set(dirX, dirY);
    renderer.render(this.quadScene, this.quadCam);
  }
}
