import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { SMAAPass } from "three/examples/jsm/postprocessing/SMAAPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";

export class Renderer {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  composer: EffectComposer;
  bloom: UnrealBloomPass;

  constructor() {
    const canvas = document.createElement("canvas");
    document.getElementById("app")!.appendChild(canvas);

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: false, // SMAA pass handles AA
      powerPreference: "high-performance",
      stencil: false,
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.scene = new THREE.Scene();
    // Warm late-afternoon sky
    this.scene.background = new THREE.Color(0x9ab8d9);
    this.scene.fog = new THREE.Fog(0xbfd0e6, 220, 1400);

    this.camera = new THREE.PerspectiveCamera(70, 1, 0.1, 2000);
    this.camera.position.set(0, 10, 20);

    // Post-processing: Render → Bloom → SMAA → Output
    this.composer = new EffectComposer(this.renderer);
    const renderPass = new RenderPass(this.scene, this.camera);
    this.composer.addPass(renderPass);

    this.bloom = new UnrealBloomPass(
      new THREE.Vector2(window.innerWidth, window.innerHeight),
      0.25, // strength — subtle
      0.6, // radius
      0.95, // threshold — only very bright emissives bloom
    );
    this.composer.addPass(this.bloom);

    const smaa = new SMAAPass(window.innerWidth, window.innerHeight);
    this.composer.addPass(smaa);

    const outputPass = new OutputPass();
    this.composer.addPass(outputPass);
  }

  onResize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const dpr = Math.min(window.devicePixelRatio, 2);
    this.renderer.setSize(w, h, false);
    this.renderer.setPixelRatio(dpr);
    this.composer.setSize(w, h);
    this.composer.setPixelRatio(dpr);
    this.bloom.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  render() {
    this.composer.render();
  }
}
