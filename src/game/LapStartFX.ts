import * as THREE from "three";
import type { Track } from "../world/Track";

interface Firework {
  points: THREE.Points;
  velocities: Float32Array;
  life: number;
  maxLife: number;
}

interface Confetti {
  mesh: THREE.InstancedMesh;
  velocities: Float32Array;
  angVel: Float32Array;
  positions: Float32Array;
  rotations: Float32Array;
  life: number;
  maxLife: number;
}

/** Celebration effects that fire when a lap starts: fireworks, confetti, strobe flashes. */
export class LapStartFX {
  scene: THREE.Scene;
  track: Track;
  private fireworks: Firework[] = [];
  private confetti: Confetti[] = [];
  private strobes: {
    light: THREE.PointLight;
    life: number;
    maxLife: number;
    base: number;
  }[] = [];
  private spawnTimer = 0;
  private spawnsRemaining = 0;

  constructor(scene: THREE.Scene, track: Track) {
    this.scene = scene;
    this.track = track;
  }

  /** Trigger a celebration burst at the start/finish area. */
  trigger() {
    const cp0 = this.track.checkpoints[0];
    const origin = cp0.position.clone().setY(cp0.position.y + 3);
    const fwd = cp0.forward.clone();
    const right = new THREE.Vector3()
      .crossVectors(fwd, new THREE.Vector3(0, 1, 0))
      .normalize();

    // Immediate confetti shower above the line
    for (let k = 0; k < 3; k++) {
      const pos = origin
        .clone()
        .addScaledVector(right, (k - 1) * (this.track.roadWidth / 3));
      pos.y += 2 + k * 0.3;
      this.spawnConfetti(pos, 140);
    }

    // Strobe flashes on each pillar
    for (const s of [-1, 1]) {
      const p = cp0.position
        .clone()
        .addScaledVector(right, s * (this.track.roadWidth / 2 + 1.2))
        .setY(cp0.position.y + 5.5);
      const light = new THREE.PointLight(0xfff0b0, 40, 30, 2);
      light.position.copy(p);
      this.scene.add(light);
      this.strobes.push({ light, life: 0, maxLife: 2.5, base: 40 });
    }

    // Queue up a sequence of fireworks that spawn over ~3 seconds
    this.spawnsRemaining = 8;
    this.spawnTimer = 0;
  }

  update(dt: number) {
    // Queued fireworks
    if (this.spawnsRemaining > 0) {
      this.spawnTimer -= dt;
      if (this.spawnTimer <= 0) {
        this.spawnFirework();
        this.spawnsRemaining--;
        this.spawnTimer = 0.25 + Math.random() * 0.35;
      }
    }

    // Fireworks
    for (let i = this.fireworks.length - 1; i >= 0; i--) {
      const fw = this.fireworks[i];
      fw.life += dt;
      const t = fw.life / fw.maxLife;
      const pos = fw.points.geometry.getAttribute(
        "position",
      ) as THREE.BufferAttribute;
      const arr = pos.array as Float32Array;
      for (let j = 0; j < arr.length; j += 3) {
        arr[j] += fw.velocities[j] * dt;
        arr[j + 1] += fw.velocities[j + 1] * dt;
        arr[j + 2] += fw.velocities[j + 2] * dt;
        // Gravity
        fw.velocities[j + 1] -= 9.8 * dt;
        // Drag
        fw.velocities[j] *= 0.985;
        fw.velocities[j + 2] *= 0.985;
      }
      pos.needsUpdate = true;
      const mat = fw.points.material as THREE.PointsMaterial;
      mat.opacity = Math.max(0, 1 - t);
      if (fw.life >= fw.maxLife) {
        this.scene.remove(fw.points);
        fw.points.geometry.dispose();
        (fw.points.material as THREE.Material).dispose();
        this.fireworks.splice(i, 1);
      }
    }

    // Confetti
    for (let i = this.confetti.length - 1; i >= 0; i--) {
      const c = this.confetti[i];
      c.life += dt;
      const t = c.life / c.maxLife;
      const m = new THREE.Matrix4();
      const q = new THREE.Quaternion();
      const sv = new THREE.Vector3(0.12, 0.03, 0.18);
      const eu = new THREE.Euler();
      for (let k = 0; k < c.mesh.count; k++) {
        c.positions[k * 3] += c.velocities[k * 3] * dt;
        c.positions[k * 3 + 1] += c.velocities[k * 3 + 1] * dt;
        c.positions[k * 3 + 2] += c.velocities[k * 3 + 2] * dt;
        c.velocities[k * 3 + 1] -= 2.8 * dt; // gentle gravity
        c.velocities[k * 3] *= 0.995;
        c.velocities[k * 3 + 2] *= 0.995;
        c.rotations[k * 3] += c.angVel[k * 3] * dt;
        c.rotations[k * 3 + 1] += c.angVel[k * 3 + 1] * dt;
        c.rotations[k * 3 + 2] += c.angVel[k * 3 + 2] * dt;
        eu.set(
          c.rotations[k * 3],
          c.rotations[k * 3 + 1],
          c.rotations[k * 3 + 2],
        );
        q.setFromEuler(eu);
        m.compose(
          new THREE.Vector3(
            c.positions[k * 3],
            c.positions[k * 3 + 1],
            c.positions[k * 3 + 2],
          ),
          q,
          sv,
        );
        c.mesh.setMatrixAt(k, m);
      }
      c.mesh.instanceMatrix.needsUpdate = true;
      const mat = c.mesh.material as THREE.MeshStandardMaterial;
      mat.opacity = Math.max(0, 1 - t);
      mat.transparent = true;
      if (c.life >= c.maxLife) {
        this.scene.remove(c.mesh);
        c.mesh.geometry.dispose();
        (c.mesh.material as THREE.Material).dispose();
        this.confetti.splice(i, 1);
      }
    }

    // Strobe flashes
    for (let i = this.strobes.length - 1; i >= 0; i--) {
      const s = this.strobes[i];
      s.life += dt;
      const flash = Math.abs(Math.sin(s.life * 20));
      s.light.intensity = s.base * flash * (1 - s.life / s.maxLife);
      if (s.life >= s.maxLife) {
        this.scene.remove(s.light);
        this.strobes.splice(i, 1);
      }
    }
  }

  private spawnFirework() {
    const cp0 = this.track.checkpoints[0];
    const fwd = cp0.forward.clone();
    const right = new THREE.Vector3()
      .crossVectors(fwd, new THREE.Vector3(0, 1, 0))
      .normalize();
    const origin = cp0.position
      .clone()
      .addScaledVector(right, (Math.random() - 0.5) * 30)
      .addScaledVector(fwd, (Math.random() - 0.5) * 20)
      .setY(cp0.position.y + 14 + Math.random() * 6);

    const palette = [
      0xff3344, 0xffd452, 0x44ddff, 0xff9eef, 0x7dff6a, 0xffffff,
    ];
    const color = palette[Math.floor(Math.random() * palette.length)];
    const particleCount = 120;
    const positions = new Float32Array(particleCount * 3);
    const velocities = new Float32Array(particleCount * 3);
    for (let i = 0; i < particleCount; i++) {
      positions[i * 3] = origin.x;
      positions[i * 3 + 1] = origin.y;
      positions[i * 3 + 2] = origin.z;
      // Spherical burst
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      const speed = 6 + Math.random() * 8;
      velocities[i * 3] = Math.sin(phi) * Math.cos(theta) * speed;
      velocities[i * 3 + 1] = Math.cos(phi) * speed;
      velocities[i * 3 + 2] = Math.sin(phi) * Math.sin(theta) * speed;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    const mat = new THREE.PointsMaterial({
      color,
      size: 0.22,
      sizeAttenuation: true,
      transparent: true,
      opacity: 1.0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    });
    const points = new THREE.Points(geo, mat);
    this.scene.add(points);

    // Brief flash light at origin
    const flash = new THREE.PointLight(color, 30, 40, 2);
    flash.position.copy(origin);
    this.scene.add(flash);
    this.strobes.push({ light: flash, life: 0, maxLife: 0.8, base: 30 });

    this.fireworks.push({ points, velocities, life: 0, maxLife: 2.2 });
  }

  private spawnConfetti(origin: THREE.Vector3, count: number) {
    const geo = new THREE.PlaneGeometry(1, 1);
    const palette = [
      0xff3344, 0xffd452, 0x44ddff, 0xff9eef, 0x7dff6a, 0xffffff, 0xff6a1a,
    ];
    const colors: number[] = [];
    for (let i = 0; i < count; i++)
      colors.push(palette[Math.floor(Math.random() * palette.length)]);
    // Use vertex colors via material with varying instance colors
    const mat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      side: THREE.DoubleSide,
      roughness: 0.5,
      metalness: 0.2,
      transparent: true,
      opacity: 1,
    });
    const mesh = new THREE.InstancedMesh(geo, mat, count);
    (mesh as any).instanceColor = new THREE.InstancedBufferAttribute(
      new Float32Array(count * 3),
      3,
    );
    const colorArr = (mesh as any).instanceColor.array as Float32Array;

    const positions = new Float32Array(count * 3);
    const velocities = new Float32Array(count * 3);
    const rotations = new Float32Array(count * 3);
    const angVel = new Float32Array(count * 3);

    const tmpColor = new THREE.Color();
    for (let i = 0; i < count; i++) {
      positions[i * 3] = origin.x + (Math.random() - 0.5) * 1.5;
      positions[i * 3 + 1] = origin.y + Math.random() * 0.5;
      positions[i * 3 + 2] = origin.z + (Math.random() - 0.5) * 1.5;
      velocities[i * 3] = (Math.random() - 0.5) * 6;
      velocities[i * 3 + 1] = 4 + Math.random() * 5;
      velocities[i * 3 + 2] = (Math.random() - 0.5) * 6;
      rotations[i * 3] = Math.random() * Math.PI;
      rotations[i * 3 + 1] = Math.random() * Math.PI;
      rotations[i * 3 + 2] = Math.random() * Math.PI;
      angVel[i * 3] = (Math.random() - 0.5) * 10;
      angVel[i * 3 + 1] = (Math.random() - 0.5) * 10;
      angVel[i * 3 + 2] = (Math.random() - 0.5) * 10;
      tmpColor.setHex(colors[i]);
      colorArr[i * 3] = tmpColor.r;
      colorArr[i * 3 + 1] = tmpColor.g;
      colorArr[i * 3 + 2] = tmpColor.b;
    }
    (mesh as any).instanceColor.needsUpdate = true;
    mesh.frustumCulled = false;
    this.scene.add(mesh);

    this.confetti.push({
      mesh,
      velocities,
      angVel,
      positions,
      rotations,
      life: 0,
      maxLife: 6,
    });
  }
}
