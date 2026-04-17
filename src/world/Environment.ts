import * as THREE from "three";
import type { PhysicsWorld } from "../core/PhysicsWorld";

export class Environment {
  scene: THREE.Scene;
  sun: THREE.DirectionalLight;
  hemi: THREE.HemisphereLight;
  ambient: THREE.AmbientLight;
  sky: THREE.Color;
  private time = 0.3; // late afternoon golden hour
  private cycleSpeed = 0;

  constructor(scene: THREE.Scene, physics?: PhysicsWorld) {
    this.scene = scene;

    this.ambient = new THREE.AmbientLight(0xfff1d8, 0.35);
    scene.add(this.ambient);

    this.hemi = new THREE.HemisphereLight(0xc8e0ff, 0x6b5a42, 0.85);
    scene.add(this.hemi);

    // Warm directional sun
    this.sun = new THREE.DirectionalLight(0xfff3d6, 2.4);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const d = 260;
    this.sun.shadow.camera.left = -d;
    this.sun.shadow.camera.right = d;
    this.sun.shadow.camera.top = d;
    this.sun.shadow.camera.bottom = -d;
    this.sun.shadow.camera.near = 1;
    this.sun.shadow.camera.far = 800;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.02;
    scene.add(this.sun);
    scene.add(this.sun.target);

    this.sky = new THREE.Color(0x9ab8d9);
    scene.background = this.sky;

    // Realistic grass/dirt ground
    const groundGeo = new THREE.PlaneGeometry(4000, 4000);
    const groundMat = new THREE.MeshStandardMaterial({
      color: 0x4b6238,
      roughness: 0.95,
      metalness: 0.0,
    });
    const ground = new THREE.Mesh(groundGeo, groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    ground.position.y = -0.02;
    scene.add(ground);

    if (physics) {
      const RAPIER = physics.RAPIER;
      const bodyDesc = RAPIER.RigidBodyDesc.fixed().setTranslation(0, -0.5, 0);
      const body = physics.world.createRigidBody(bodyDesc);
      const colDesc = RAPIER.ColliderDesc.cuboid(1000, 0.5, 1000);
      colDesc.setFriction(0.7);
      colDesc.setRestitution(0);
      physics.world.createCollider(colDesc, body);
    }

    this.applyTime();
  }

  toggleCycle() {
    this.cycleSpeed = this.cycleSpeed > 0 ? 0 : 0.03;
    if (this.cycleSpeed === 0) {
      this.time = 0.3;
      this.applyTime();
    }
  }

  update(dt: number) {
    if (this.cycleSpeed > 0) {
      this.time = (this.time + dt * this.cycleSpeed) % 1;
      this.applyTime();
    }
  }

  private applyTime() {
    const angle = this.time * Math.PI * 2 - Math.PI / 2;
    const r = 240;
    this.sun.position.set(Math.cos(angle) * r, Math.sin(angle) * r + 40, 60);
    this.sun.target.position.set(0, 0, 0);

    const elev = Math.max(0, Math.sin(angle));
    const dayT = THREE.MathUtils.smoothstep(elev, 0, 0.4);

    this.sun.intensity = 0.3 + dayT * 2.4;
    this.hemi.intensity = 0.3 + dayT * 0.7;
    this.ambient.intensity = 0.2 + dayT * 0.25;

    const nightColor = new THREE.Color(0x141a2c);
    const duskColor = new THREE.Color(0xe08a4a);
    const dayColor = new THREE.Color(0x9ab8d9);
    const sky = nightColor.clone().lerp(duskColor, 0.6).lerp(dayColor, dayT);
    this.sky.copy(sky);
    this.scene.background = this.sky;
    if (this.scene.fog) (this.scene.fog as THREE.Fog).color.copy(this.sky);

    // Warm sunset → cooler noon
    this.sun.color.setHSL(0.08 + dayT * 0.05, 0.5 - dayT * 0.2, 0.65);
  }
}
