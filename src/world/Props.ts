import * as THREE from "three";
import type { PhysicsWorld } from "../core/PhysicsWorld";
import type { Track } from "./Track";

interface DynamicProp {
  body: any;
  mesh: THREE.Object3D;
}

export interface ObstacleInfo {
  kind: "cone" | "barrel" | "tire";
  damage: number; // base damage dealt on contact
}

/** Realistic trackside props: trees, tire stacks, gantries, cones (dynamic), barrels (dynamic). */
export class Props {
  scene: THREE.Scene;
  physics: PhysicsWorld;
  track: Track;
  private dynamics: DynamicProp[] = [];
  /** collider.handle → obstacle info. Used by Game to translate collision events into damage. */
  obstacleByHandle: Map<number, ObstacleInfo> = new Map();

  constructor(scene: THREE.Scene, physics: PhysicsWorld, track: Track) {
    this.scene = scene;
    this.physics = physics;
    this.track = track;
  }

  build() {
    this.scatterTrees(260);
    this.scatterTireStacks(40);
    this.placeGantries(6);
    this.scatterCones(80);
    this.scatterBarrels(18);
  }

  postPhysicsSync() {
    for (const d of this.dynamics) {
      const p = d.body.translation();
      const r = d.body.rotation();
      d.mesh.position.set(p.x, p.y, p.z);
      d.mesh.quaternion.set(r.x, r.y, r.z, r.w);
    }
  }

  private scatterTrees(count: number) {
    const trunkGeo = new THREE.CylinderGeometry(0.22, 0.3, 2.2, 7);
    const trunkMat = new THREE.MeshStandardMaterial({
      color: 0x5a3c24,
      roughness: 0.95,
    });
    const leafGeo = new THREE.ConeGeometry(1.4, 3.6, 8);
    const leafMat = new THREE.MeshStandardMaterial({
      color: 0x2e5a2a,
      roughness: 0.9,
    });

    const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, count);
    const leaves = new THREE.InstancedMesh(leafGeo, leafMat, count);
    trunks.castShadow = true;
    leaves.castShadow = true;
    trunks.receiveShadow = true;

    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const rng = mulberry32(9001);
    const samples = this.track.samples;
    const tangents = this.track.tangents;

    let placed = 0;
    while (placed < count) {
      const i = Math.floor(rng() * samples.length);
      const p = samples[i];
      const t = tangents[i];
      const right = new THREE.Vector3()
        .crossVectors(t, new THREE.Vector3(0, 1, 0))
        .normalize();
      const side = rng() < 0.5 ? -1 : 1;
      const off = this.track.roadWidth / 2 + 8 + rng() * 60;
      const s = 0.8 + rng() * 0.9;
      const pos = p.clone().addScaledVector(right, off * side);
      pos.y = 0;

      m.compose(
        new THREE.Vector3(pos.x, 1.1 * s, pos.z),
        q,
        new THREE.Vector3(s, s, s),
      );
      trunks.setMatrixAt(placed, m);
      m.compose(
        new THREE.Vector3(pos.x, (2.2 + 1.8) * s, pos.z),
        q,
        new THREE.Vector3(s, s, s),
      );
      leaves.setMatrixAt(placed, m);
      placed++;
    }
    trunks.instanceMatrix.needsUpdate = true;
    leaves.instanceMatrix.needsUpdate = true;
    this.scene.add(trunks);
    this.scene.add(leaves);
  }

  private scatterTireStacks(count: number) {
    const tireGeo = new THREE.TorusGeometry(0.38, 0.14, 8, 16);
    const tireMat = new THREE.MeshStandardMaterial({
      color: 0x0a0a0c,
      roughness: 0.95,
    });
    const stackHeight = 4;
    const inst = new THREE.InstancedMesh(tireGeo, tireMat, count * stackHeight);
    inst.castShadow = true;
    inst.receiveShadow = true;

    const m = new THREE.Matrix4();
    const qFlat = new THREE.Quaternion().setFromEuler(
      new THREE.Euler(Math.PI / 2, 0, 0),
    );
    const rng = mulberry32(4242);
    const samples = this.track.samples;
    const tangents = this.track.tangents;
    const RAPIER = this.physics.RAPIER;
    let idx = 0;

    for (let k = 0; k < count; k++) {
      const i = Math.floor(rng() * samples.length);
      const p = samples[i];
      const t = tangents[i];
      const right = new THREE.Vector3()
        .crossVectors(t, new THREE.Vector3(0, 1, 0))
        .normalize();
      const side = rng() < 0.5 ? -1 : 1;
      const off = this.track.roadWidth / 2 + 2.6;
      const pos = p.clone().addScaledVector(right, off * side);

      for (let s = 0; s < stackHeight; s++) {
        m.compose(
          new THREE.Vector3(pos.x, 0.15 + s * 0.28, pos.z),
          qFlat,
          new THREE.Vector3(1, 1, 1),
        );
        inst.setMatrixAt(idx++, m);
      }

      const body = this.physics.world.createRigidBody(
        RAPIER.RigidBodyDesc.fixed().setTranslation(pos.x, 0.55, pos.z),
      );
      const col = RAPIER.ColliderDesc.cylinder(0.55, 0.5)
        .setFriction(0.6)
        .setRestitution(0.4)
        .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS);
      const collider = this.physics.world.createCollider(col, body);
      this.obstacleByHandle.set(collider.handle, { kind: "tire", damage: 12 });
    }
    inst.instanceMatrix.needsUpdate = true;
    this.scene.add(inst);
  }

  private placeGantries(count: number) {
    const steelMat = new THREE.MeshStandardMaterial({
      color: 0xb0b4bc,
      roughness: 0.5,
      metalness: 0.7,
    });
    const signMat = new THREE.MeshStandardMaterial({
      color: 0xf2f2f2,
      roughness: 0.7,
    });
    const samples = this.track.samples;
    const tangents = this.track.tangents;
    for (let k = 0; k < count; k++) {
      const i = Math.floor(((k + 0.5) / count) * samples.length);
      const p = samples[i];
      const t = tangents[i];
      const right = new THREE.Vector3()
        .crossVectors(t, new THREE.Vector3(0, 1, 0))
        .normalize();

      for (const s of [-1, 1]) {
        const pillar = new THREE.Mesh(
          new THREE.BoxGeometry(0.45, 7.2, 0.45),
          steelMat,
        );
        pillar.position
          .copy(p)
          .addScaledVector(right, s * (this.track.roadWidth / 2 + 2.2))
          .setY(p.y + 3.6);
        pillar.castShadow = true;
        this.scene.add(pillar);
      }

      const beam = new THREE.Mesh(
        new THREE.BoxGeometry(this.track.roadWidth + 6, 0.5, 0.55),
        steelMat,
      );
      beam.position.copy(p).setY(p.y + 7.2);
      beam.lookAt(p.clone().add(t));
      beam.rotateY(Math.PI / 2);
      beam.castShadow = true;
      this.scene.add(beam);

      const sign = new THREE.Mesh(
        new THREE.BoxGeometry(this.track.roadWidth + 3.5, 1.4, 0.18),
        signMat,
      );
      sign.position.copy(p).setY(p.y + 6.2);
      sign.lookAt(p.clone().add(t));
      sign.rotateY(Math.PI / 2);
      sign.castShadow = true;
      this.scene.add(sign);
    }
  }

  /** Iranian naval mines ON the road as dynamic obstacles */
  private scatterCones(count: number) {
    // Mine body: matte-black iron sphere with slight metallic sheen.
    const mineGeo = new THREE.SphereGeometry(0.34, 20, 14);
    const mineMat = new THREE.MeshStandardMaterial({
      color: 0x1a1a1c,
      roughness: 0.55,
      metalness: 0.5,
    });
    // Contact horns (Hertz horns) poking out of the sphere.
    const hornGeo = new THREE.ConeGeometry(0.05, 0.18, 8);
    const hornMat = new THREE.MeshStandardMaterial({
      color: 0x2a2a2e,
      roughness: 0.4,
      metalness: 0.7,
    });
    // Rust band stripe
    const bandGeo = new THREE.TorusGeometry(0.34, 0.025, 8, 24);
    const bandMat = new THREE.MeshStandardMaterial({
      color: 0x8a2f10,
      roughness: 0.8,
      metalness: 0.2,
    });
    // Chain stub anchoring to the "sea floor" (road)
    const chainGeo = new THREE.CylinderGeometry(0.04, 0.04, 0.35, 6);
    const chainMat = new THREE.MeshStandardMaterial({
      color: 0x3a3a3e,
      roughness: 0.6,
      metalness: 0.6,
    });
    const RAPIER = this.physics.RAPIER;
    const rng = mulberry32(7777);
    const samples = this.track.samples;
    const tangents = this.track.tangents;

    // Precomputed horn directions (6 spikes around the sphere)
    const hornDirs: THREE.Vector3[] = [
      new THREE.Vector3(0, 1, 0),
      new THREE.Vector3(0.9, 0.4, 0),
      new THREE.Vector3(-0.9, 0.4, 0),
      new THREE.Vector3(0, 0.4, 0.9),
      new THREE.Vector3(0, 0.4, -0.9),
      new THREE.Vector3(0.6, 0.6, 0.6),
    ];

    let placed = 0;
    let attempts = 0;
    while (placed < count && attempts < count * 4) {
      attempts++;
      const i = Math.floor(rng() * samples.length);
      if (i < 8 || i > samples.length - 8) continue;
      const p = samples[i];
      const t = tangents[i];
      const right = new THREE.Vector3()
        .crossVectors(t, new THREE.Vector3(0, 1, 0))
        .normalize();
      const lateral = (rng() - 0.5) * (this.track.roadWidth - 3);
      const pos = p.clone().addScaledVector(right, lateral);
      pos.y = p.y + 0.35;

      const group = new THREE.Group();
      // Main sphere body
      const body = new THREE.Mesh(mineGeo, mineMat);
      body.position.y = 0.35;
      body.castShadow = true;
      group.add(body);
      // Rust band
      const band = new THREE.Mesh(bandGeo, bandMat);
      band.rotation.x = Math.PI / 2;
      band.position.y = 0.35;
      group.add(band);
      // Horns
      for (const dir of hornDirs) {
        const horn = new THREE.Mesh(hornGeo, hornMat);
        const n = dir.clone().normalize();
        horn.position.set(
          n.x * 0.34 + 0,
          0.35 + n.y * 0.34,
          n.z * 0.34,
        );
        // Orient the cone's +Y axis along the radial direction
        horn.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), n);
        horn.castShadow = true;
        group.add(horn);
      }
      // Chain stub dangling below
      const chain = new THREE.Mesh(chainGeo, chainMat);
      chain.position.y = 0.0;
      group.add(chain);
      group.position.copy(pos);
      this.scene.add(group);

      const rb = this.physics.world.createRigidBody(
        RAPIER.RigidBodyDesc.dynamic()
          .setTranslation(pos.x, pos.y, pos.z)
          .setLinearDamping(0.6)
          .setAngularDamping(0.8),
      );
      const col = RAPIER.ColliderDesc.cylinder(0.35, 0.28)
        .setDensity(60)
        .setFriction(0.7)
        .setRestitution(0.2)
        .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS);
      const collider = this.physics.world.createCollider(col, rb);
      this.obstacleByHandle.set(collider.handle, { kind: "cone", damage: 6 });
      this.dynamics.push({ body: rb, mesh: group });
      placed++;
    }
  }

  /** Oil/fuel barrels — heavier dynamic obstacles */
  private scatterBarrels(count: number) {
    const barrelGeo = new THREE.CylinderGeometry(0.4, 0.4, 0.95, 16);
    const barrelMat = new THREE.MeshStandardMaterial({
      color: 0xd62828,
      roughness: 0.55,
      metalness: 0.4,
    });
    const ringGeo = new THREE.TorusGeometry(0.41, 0.025, 6, 20);
    const ringMat = new THREE.MeshStandardMaterial({
      color: 0x2a2a2e,
      roughness: 0.6,
      metalness: 0.5,
    });
    const RAPIER = this.physics.RAPIER;
    const rng = mulberry32(13579);
    const samples = this.track.samples;
    const tangents = this.track.tangents;

    let placed = 0;
    let attempts = 0;
    while (placed < count && attempts < count * 4) {
      attempts++;
      const i = Math.floor(rng() * samples.length);
      if (i < 12 || i > samples.length - 12) continue;
      const p = samples[i];
      const t = tangents[i];
      const right = new THREE.Vector3()
        .crossVectors(t, new THREE.Vector3(0, 1, 0))
        .normalize();
      const lateral = (rng() - 0.5) * (this.track.roadWidth - 2.5);
      const pos = p.clone().addScaledVector(right, lateral);
      pos.y = p.y + 0.5;

      const group = new THREE.Group();
      const b = new THREE.Mesh(barrelGeo, barrelMat);
      b.castShadow = true;
      b.receiveShadow = true;
      group.add(b);
      for (const ry of [-0.3, 0.3]) {
        const r = new THREE.Mesh(ringGeo, ringMat);
        r.rotation.x = Math.PI / 2;
        r.position.y = ry;
        group.add(r);
      }
      group.position.copy(pos);
      this.scene.add(group);

      const body = this.physics.world.createRigidBody(
        RAPIER.RigidBodyDesc.dynamic()
          .setTranslation(pos.x, pos.y, pos.z)
          .setLinearDamping(0.5)
          .setAngularDamping(0.6),
      );
      const col = RAPIER.ColliderDesc.cylinder(0.48, 0.4)
        .setDensity(180)
        .setFriction(0.75)
        .setRestitution(0.25)
        .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS);
      const collider = this.physics.world.createCollider(col, body);
      this.obstacleByHandle.set(collider.handle, {
        kind: "barrel",
        damage: 20,
      });
      this.dynamics.push({ body, mesh: group });
      placed++;
    }
  }
}

function mulberry32(seed: number) {
  let s = seed >>> 0;
  return function () {
    s |= 0;
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
