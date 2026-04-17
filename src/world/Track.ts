import * as THREE from "three";
import type { PhysicsWorld } from "../core/PhysicsWorld";

export interface Spawn {
  position: THREE.Vector3;
  rotation: THREE.Quaternion;
}

export class Track {
  scene: THREE.Scene;
  physics: PhysicsWorld;

  curve!: THREE.CatmullRomCurve3;
  roadWidth = 14;
  samples: THREE.Vector3[] = [];
  tangents: THREE.Vector3[] = [];
  checkpoints: {
    position: THREE.Vector3;
    forward: THREE.Vector3;
    half: number;
  }[] = [];

  constructor(scene: THREE.Scene, physics: PhysicsWorld) {
    this.scene = scene;
    this.physics = physics;
  }

  build() {
    // Create a fun closed track shape (figure-ish loop)
    const controlPoints: THREE.Vector3[] = [];
    const R = 160;
    const pts = 14;
    const rng = mulberry32(1337);
    for (let i = 0; i < pts; i++) {
      const t = (i / pts) * Math.PI * 2;
      const radius = R * (0.75 + rng() * 0.4);
      const x = Math.cos(t) * radius;
      const z = Math.sin(t) * radius * (0.9 + (i % 3) * 0.06);
      const y = Math.sin(t * 2) * 0.8; // very gentle elevation changes
      controlPoints.push(new THREE.Vector3(x, y, z));
    }
    this.curve = new THREE.CatmullRomCurve3(
      controlPoints,
      true,
      "catmullrom",
      0.5,
    );

    const div = 600;
    // getSpacedPoints(div) returns div+1 points (first == last for closed curve).
    // Drop the duplicate last point so samples and tangents have matching length.
    const raw = this.curve.getSpacedPoints(div);
    this.samples = raw.slice(0, div);
    this.tangents = [];
    for (let i = 0; i < div; i++) {
      this.tangents.push(this.curve.getTangentAt(i / div).normalize());
    }

    this.buildRoadMesh();
    this.buildCheckpoints();
  }

  private buildRoadMesh() {
    const w = this.roadWidth;
    const segCount = this.samples.length;
    const positions: number[] = [];
    const uvs: number[] = [];
    const indices: number[] = [];
    const normals: number[] = [];

    // Curbs and grass borders
    const curbPositions: number[] = [];
    const curbUVs: number[] = [];
    const curbIndices: number[] = [];

    const up = new THREE.Vector3(0, 1, 0);
    for (let i = 0; i < segCount; i++) {
      const p = this.samples[i];
      const t = this.tangents[i];
      const right = new THREE.Vector3().crossVectors(t, up).normalize();

      // Banking on curves: use curvature approximation
      const iNext = (i + 1) % segCount;
      const iPrev = (i - 1 + segCount) % segCount;
      const tNext = this.tangents[iNext];
      const bank = THREE.MathUtils.clamp(
        tNext.clone().sub(this.tangents[iPrev]).dot(right) * 0.8,
        -0.08,
        0.08,
      );
      const bankedUp = up.clone().applyAxisAngle(t, bank).normalize();
      const rightB = new THREE.Vector3().crossVectors(t, bankedUp).normalize();

      const left = p.clone().addScaledVector(rightB, -w / 2);
      const rightP = p.clone().addScaledVector(rightB, w / 2);
      positions.push(left.x, left.y, left.z, rightP.x, rightP.y, rightP.z);
      uvs.push(0, i / 8, 1, i / 8);
      normals.push(
        bankedUp.x,
        bankedUp.y,
        bankedUp.z,
        bankedUp.x,
        bankedUp.y,
        bankedUp.z,
      );

      // curbs (outer edges, stripes)
      const cLeft = left.clone().addScaledVector(rightB, -1.2);
      const cRight = rightP.clone().addScaledVector(rightB, 1.2);
      curbPositions.push(
        left.x,
        left.y + 0.02,
        left.z,
        cLeft.x,
        cLeft.y + 0.02,
        cLeft.z,
      );
      curbPositions.push(
        rightP.x,
        rightP.y + 0.02,
        rightP.z,
        cRight.x,
        cRight.y + 0.02,
        cRight.z,
      );
      curbUVs.push(0, i, 1, i, 0, i, 1, i);
    }

    for (let i = 0; i < segCount; i++) {
      const a = i * 2;
      const b = i * 2 + 1;
      const c = ((i + 1) % segCount) * 2;
      const d = ((i + 1) % segCount) * 2 + 1;
      indices.push(a, c, b, b, c, d);
    }
    for (let i = 0; i < segCount; i++) {
      const base = i * 4;
      const next = ((i + 1) % segCount) * 4;
      // left curb quad
      curbIndices.push(
        base + 0,
        next + 0,
        base + 1,
        base + 1,
        next + 0,
        next + 1,
      );
      // right curb quad
      curbIndices.push(
        base + 2,
        next + 2,
        base + 3,
        base + 3,
        next + 2,
        next + 3,
      );
    }

    const roadGeo = new THREE.BufferGeometry();
    roadGeo.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(positions, 3),
    );
    roadGeo.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
    roadGeo.setAttribute(
      "normal",
      new THREE.Float32BufferAttribute(normals, 3),
    );
    roadGeo.setIndex(indices);
    roadGeo.computeVertexNormals();
    const roadMat = new THREE.MeshStandardMaterial({
      color: 0x2a2a30,
      roughness: 0.85,
      metalness: 0.05,
    });
    const roadMesh = new THREE.Mesh(roadGeo, roadMat);
    roadMesh.receiveShadow = true;
    this.scene.add(roadMesh);

    // Center dashed line via small quads
    this.buildCenterLine();

    const curbGeo = new THREE.BufferGeometry();
    curbGeo.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(curbPositions, 3),
    );
    curbGeo.setAttribute("uv", new THREE.Float32BufferAttribute(curbUVs, 2));
    curbGeo.setIndex(curbIndices);
    curbGeo.computeVertexNormals();
    const curbMat = new THREE.MeshStandardMaterial({
      color: 0xd83a3a,
      roughness: 0.7,
      metalness: 0.05,
    });
    const curbMesh = new THREE.Mesh(curbGeo, curbMat);
    curbMesh.receiveShadow = true;
    this.scene.add(curbMesh);

    // Physics: trimesh collider for the road
    const RAPIER = this.physics.RAPIER;
    const vertices = new Float32Array(positions);
    const idx = new Uint32Array(indices);
    const bodyDesc = RAPIER.RigidBodyDesc.fixed();
    const body = this.physics.world.createRigidBody(bodyDesc);
    const colDesc = RAPIER.ColliderDesc.trimesh(vertices, idx);
    colDesc.setFriction(1.1);
    colDesc.setRestitution(0);
    this.physics.world.createCollider(colDesc, body);

    // Outer walls
    this.buildWalls();
  }

  private buildCenterLine() {
    const dashGeo = new THREE.PlaneGeometry(0.35, 3);
    const dashMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      toneMapped: false,
    });
    const step = 8;
    for (let i = 0; i < this.samples.length; i += step) {
      const p = this.samples[i];
      const t = this.tangents[i];
      const m = new THREE.Mesh(dashGeo, dashMat);
      m.position.copy(p).setY(p.y + 0.04);
      m.lookAt(p.clone().add(t));
      m.rotateX(-Math.PI / 2);
      this.scene.add(m);
    }
  }

  private buildWalls() {
    const RAPIER = this.physics.RAPIER;
    const h = 1.4;
    const wallMat = new THREE.MeshStandardMaterial({
      color: 0xc9c9c4,
      roughness: 0.85,
      metalness: 0.0,
    });
    const glowMat = new THREE.MeshStandardMaterial({
      color: 0xd83a3a,
      roughness: 0.6,
      metalness: 0.0,
    });

    for (const side of [-1, 1]) {
      const positions: number[] = [];
      const indices: number[] = [];
      const glowPositions: number[] = [];
      const glowIndices: number[] = [];

      for (let i = 0; i < this.samples.length; i++) {
        const p = this.samples[i];
        const t = this.tangents[i];
        const right = new THREE.Vector3()
          .crossVectors(t, new THREE.Vector3(0, 1, 0))
          .normalize();
        const edge = p
          .clone()
          .addScaledVector(right, (this.roadWidth / 2 + 1.6) * side);
        // inner (road-side) and outer (2m behind) to give wall thickness look
        const outer = edge.clone().addScaledVector(right, 0.6 * side);
        positions.push(edge.x, edge.y, edge.z);
        positions.push(edge.x, edge.y + h, edge.z);
        positions.push(outer.x, outer.y, outer.z);
        positions.push(outer.x, outer.y + h, outer.z);

        // glow strip: thin plate on top
        glowPositions.push(edge.x, edge.y + h, edge.z);
        glowPositions.push(outer.x, outer.y + h, outer.z);
        glowPositions.push(edge.x, edge.y + h + 0.18, edge.z);
        glowPositions.push(outer.x, outer.y + h + 0.18, outer.z);
      }

      const n = this.samples.length;
      for (let i = 0; i < n; i++) {
        const a = i * 4;
        const b = i * 4 + 1; // edge top
        const c = i * 4 + 2; // outer bottom
        const d = i * 4 + 3; // outer top
        const an = ((i + 1) % n) * 4;
        const bn = ((i + 1) % n) * 4 + 1;
        const cn = ((i + 1) % n) * 4 + 2;
        const dn = ((i + 1) % n) * 4 + 3;
        // inner wall face
        indices.push(a, an, b, b, an, bn);
        // top face
        indices.push(b, bn, d, d, bn, dn);
        // outer face
        indices.push(d, dn, c, c, dn, cn);

        // glow quad
        const ga = i * 4;
        const gb = i * 4 + 1;
        const gc = i * 4 + 2;
        const gd = i * 4 + 3;
        const gan = ((i + 1) % n) * 4;
        const gbn = ((i + 1) % n) * 4 + 1;
        const gcn = ((i + 1) % n) * 4 + 2;
        const gdn = ((i + 1) % n) * 4 + 3;
        // top glow plate
        glowIndices.push(gc, gcn, gd, gd, gcn, gdn);
        glowIndices.push(ga, gan, gc, gc, gan, gcn);
      }

      const geo = new THREE.BufferGeometry();
      geo.setAttribute(
        "position",
        new THREE.Float32BufferAttribute(positions, 3),
      );
      geo.setIndex(indices);
      geo.computeVertexNormals();
      const mesh = new THREE.Mesh(geo, wallMat);
      mesh.receiveShadow = true;
      mesh.castShadow = true;
      this.scene.add(mesh);

      const glowGeo = new THREE.BufferGeometry();
      glowGeo.setAttribute(
        "position",
        new THREE.Float32BufferAttribute(glowPositions, 3),
      );
      glowGeo.setIndex(glowIndices);
      glowGeo.computeVertexNormals();
      const glowMesh = new THREE.Mesh(glowGeo, glowMat);
      this.scene.add(glowMesh);

      // Physics: solid-feel wall (trimesh of the inner face)
      const body = this.physics.world.createRigidBody(
        RAPIER.RigidBodyDesc.fixed(),
      );
      const col = RAPIER.ColliderDesc.trimesh(
        new Float32Array(positions),
        new Uint32Array(indices),
      );
      col.setFriction(0.6);
      col.setRestitution(0.15);
      this.physics.world.createCollider(col, body);
    }
  }

  private buildCheckpoints() {
    const count = 12;
    for (let i = 0; i < count; i++) {
      const t = i / count;
      const idx = Math.floor(t * this.samples.length) % this.samples.length;
      const p = this.samples[idx].clone();
      const fwd = this.tangents[idx].clone();
      this.checkpoints.push({
        position: p,
        forward: fwd,
        half: this.roadWidth / 2 + 1,
      });
    }

    // Visual start/finish banner at checkpoint 0
    const cp0 = this.checkpoints[0];
    const banner = new THREE.Mesh(
      new THREE.BoxGeometry(this.roadWidth + 3, 1.2, 0.25),
      new THREE.MeshStandardMaterial({
        color: 0x111114,
        roughness: 0.6,
        metalness: 0.3,
      }),
    );
    banner.position.copy(cp0.position).setY(cp0.position.y + 5.2);
    const right = new THREE.Vector3().crossVectors(
      cp0.forward,
      new THREE.Vector3(0, 1, 0),
    );
    banner.lookAt(cp0.position.clone().add(right));
    this.scene.add(banner);

    // Red/white checker strip on banner
    const strip = new THREE.Mesh(
      new THREE.BoxGeometry(this.roadWidth + 3.1, 0.18, 0.28),
      new THREE.MeshStandardMaterial({ color: 0xd83a3a, roughness: 0.7 }),
    );
    strip.position.copy(banner.position).setY(banner.position.y + 0.72);
    strip.quaternion.copy(banner.quaternion);
    this.scene.add(strip);

    // Support pillars (steel)
    const pillarMat = new THREE.MeshStandardMaterial({
      color: 0x8a8a90,
      roughness: 0.5,
      metalness: 0.6,
    });
    for (const s of [-1, 1]) {
      const pillar = new THREE.Mesh(
        new THREE.BoxGeometry(0.5, 5.5, 0.5),
        pillarMat,
      );
      pillar.position
        .copy(cp0.position)
        .addScaledVector(
          right.clone().normalize(),
          s * (this.roadWidth / 2 + 1.2),
        )
        .setY(cp0.position.y + 2.6);
      pillar.castShadow = true;
      this.scene.add(pillar);
    }
  }

  getSpawn(): Spawn {
    const cp = this.checkpoints[0];
    const pos = cp.position
      .clone()
      .addScaledVector(cp.forward, -8)
      .setY(cp.position.y + 1.5);
    const fwd = cp.forward.clone();
    const quat = new THREE.Quaternion().setFromUnitVectors(
      new THREE.Vector3(0, 0, -1),
      fwd,
    );
    return { position: pos, rotation: quat };
  }

  getNearestSpawn(pos: THREE.Vector3): Spawn {
    let bestI = 0;
    let bestD = Infinity;
    for (let i = 0; i < this.samples.length; i++) {
      const d = this.samples[i].distanceToSquared(pos);
      if (d < bestD) {
        bestD = d;
        bestI = i;
      }
    }
    const p = this.samples[bestI].clone();
    const fwd = this.tangents[bestI].clone();
    const quat = new THREE.Quaternion().setFromUnitVectors(
      new THREE.Vector3(0, 0, -1),
      fwd,
    );
    return { position: p.setY(p.y + 1.5), rotation: quat };
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
