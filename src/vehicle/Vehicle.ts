import * as THREE from "three";
import type { PhysicsWorld } from "../core/PhysicsWorld";
import { VEHICLE_TUNING as T } from "./VehicleTuning";
import type { InputState } from "../input/InputManager";

export class Vehicle {
  scene: THREE.Scene;
  physics: PhysicsWorld;

  body!: any; // RAPIER.RigidBody
  controller!: any; // RAPIER.DynamicRayCastVehicleController
  chassisCollider!: any; // RAPIER.Collider
  chassisMesh!: THREE.Object3D;
  wheelMeshes: THREE.Object3D[] = [];

  steer = 0;
  throttle = 0;
  brake = 0;
  handbrake = 0;

  damage = 0; // 0..100
  destroyed = false;
  onDestroyed?: () => void;
  onImpact?: (severity: number) => void; // 0..1
  private prevLinvel = new THREE.Vector3();
  private lastImpulseLen = 0;
  private smokeGroup!: THREE.Group;
  private explosionParticles: {
    mesh: THREE.Points;
    velocities: Float32Array;
    life: number;
    maxLife: number;
  }[] = [];
  private explosionLight: THREE.PointLight | null = null;
  private explosionLightLife = 0;

  constructor(scene: THREE.Scene, physics: PhysicsWorld) {
    this.scene = scene;
    this.physics = physics;
  }

  build(position: THREE.Vector3, rotation: THREE.Quaternion) {
    const RAPIER = this.physics.RAPIER;

    // Chassis body
    const bodyDesc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(position.x, position.y, position.z)
      .setRotation({
        x: rotation.x,
        y: rotation.y,
        z: rotation.z,
        w: rotation.w,
      })
      .setCcdEnabled(true)
      .setLinearDamping(0.15)
      .setAngularDamping(0.6);
    this.body = this.physics.world.createRigidBody(bodyDesc);

    const colDesc = RAPIER.ColliderDesc.cuboid(
      T.chassisHalfExtents.x,
      T.chassisHalfExtents.y,
      T.chassisHalfExtents.z,
    )
      .setDensity(
        T.mass /
          (8 *
            T.chassisHalfExtents.x *
            T.chassisHalfExtents.y *
            T.chassisHalfExtents.z),
      )
      .setFriction(0.5)
      .setRestitution(0.05)
      .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS);
    this.chassisCollider = this.physics.world.createCollider(
      colDesc,
      this.body,
    );

    // Vehicle controller
    this.controller = this.physics.world.createVehicleController(this.body);
    const suspensionDir = { x: 0, y: -1, z: 0 };
    for (const a of T.wheelAnchors) {
      this.controller.addWheel(
        { x: a.x, y: a.y, z: a.z },
        suspensionDir,
        { x: -1, y: 0, z: 0 }, // axle (will be rotated by body)
        T.suspensionRestLength,
        T.wheelRadius,
      );
    }
    for (let i = 0; i < 4; i++) {
      this.controller.setWheelSuspensionStiffness(i, T.suspensionStiffness);
      this.controller.setWheelMaxSuspensionTravel(i, T.maxSuspensionTravel);
      this.controller.setWheelMaxSuspensionForce(i, T.maxSuspensionForce);
      this.controller.setWheelSuspensionCompression(i, T.dampingCompression);
      this.controller.setWheelSuspensionRelaxation(i, T.dampingRelaxation);
      this.controller.setWheelFrictionSlip(i, T.frictionSlip);
      this.controller.setWheelSideFrictionStiffness(i, 1.0);
    }

    // Visuals
    this.buildVisuals();
  }

  private buildVisuals() {
    const group = new THREE.Group();
    this.chassisMesh = group;

    const HX = T.chassisHalfExtents.x;
    const HY = T.chassisHalfExtents.y;
    const HZ = T.chassisHalfExtents.z;

    // Ferrari-red paint (PBR metallic)
    const paintMat = new THREE.MeshStandardMaterial({
      color: 0xd40000,
      roughness: 0.28,
      metalness: 0.75,
    });
    const blackTrim = new THREE.MeshStandardMaterial({
      color: 0x0a0a0c,
      roughness: 0.4,
      metalness: 0.5,
    });
    const chromeMat = new THREE.MeshStandardMaterial({
      color: 0xcfd2d6,
      roughness: 0.2,
      metalness: 1.0,
    });
    const glassMat = new THREE.MeshPhysicalMaterial({
      color: 0x181b22,
      roughness: 0.05,
      metalness: 0.1,
      transmission: 0.5,
      transparent: true,
      opacity: 0.7,
      clearcoat: 1.0,
      clearcoatRoughness: 0.02,
    });

    // Main lower body — wide, low, slightly tapered
    const lower = new THREE.Mesh(
      new THREE.BoxGeometry(HX * 2, HY * 1.2, HZ * 2),
      paintMat,
    );
    lower.position.y = -HY * 0.25;
    lower.castShadow = true;
    lower.receiveShadow = true;
    group.add(lower);

    // Hood (front upper) — sloped flat, at -Z (front)
    const hood = new THREE.Mesh(
      new THREE.BoxGeometry(HX * 1.85, 0.18, HZ * 0.9),
      paintMat,
    );
    hood.position.set(0, HY * 0.55, -HZ * 0.55);
    hood.castShadow = true;
    group.add(hood);

    // Rear deck (engine cover), at +Z (rear)
    const deck = new THREE.Mesh(
      new THREE.BoxGeometry(HX * 1.85, 0.16, HZ * 0.85),
      paintMat,
    );
    deck.position.set(0, HY * 0.55, HZ * 0.6);
    deck.castShadow = true;
    group.add(deck);

    // Cabin — tapered greenhouse
    const cabinShell = new THREE.Mesh(
      new THREE.BoxGeometry(HX * 1.6, 0.55, HZ * 0.95),
      paintMat,
    );
    cabinShell.position.set(0, HY + 0.1, HZ * 0.02);
    cabinShell.castShadow = true;
    group.add(cabinShell);

    // Windshield (front, raked)
    const windshield = new THREE.Mesh(
      new THREE.PlaneGeometry(HX * 1.55, 0.7),
      glassMat,
    );
    windshield.position.set(0, HY + 0.18, -HZ * 0.45);
    windshield.rotation.x = -Math.PI / 2 - 0.65;
    group.add(windshield);

    // Rear window
    const rearWindow = new THREE.Mesh(
      new THREE.PlaneGeometry(HX * 1.55, 0.6),
      glassMat,
    );
    rearWindow.position.set(0, HY + 0.18, HZ * 0.5);
    rearWindow.rotation.x = -Math.PI / 2 + 0.7;
    group.add(rearWindow);

    // Side windows
    for (const x of [-HX * 0.82, HX * 0.82]) {
      const side = new THREE.Mesh(
        new THREE.PlaneGeometry(HZ * 0.8, 0.35),
        glassMat,
      );
      side.position.set(x, HY + 0.22, 0);
      side.rotation.y = x > 0 ? -Math.PI / 2 : Math.PI / 2;
      group.add(side);
    }

    // Front splitter / lower lip (front, -Z)
    const splitter = new THREE.Mesh(
      new THREE.BoxGeometry(HX * 1.9, 0.08, 0.25),
      blackTrim,
    );
    splitter.position.set(0, -HY * 0.75, -HZ - 0.06);
    group.add(splitter);

    // Rear diffuser (+Z)
    const diffuser = new THREE.Mesh(
      new THREE.BoxGeometry(HX * 1.8, 0.22, 0.4),
      blackTrim,
    );
    diffuser.position.set(0, -HY * 0.55, HZ + 0.05);
    group.add(diffuser);

    // Side intakes (slightly biased toward rear wheel — now +Z)
    for (const x of [-HX - 0.02, HX + 0.02]) {
      const intake = new THREE.Mesh(
        new THREE.BoxGeometry(0.06, 0.2, HZ * 0.5),
        blackTrim,
      );
      intake.position.set(x, -HY * 0.1, HZ * 0.1);
      group.add(intake);
    }

    // Side mirrors (near front)
    for (const x of [-HX - 0.05, HX + 0.05]) {
      const mirror = new THREE.Mesh(
        new THREE.BoxGeometry(0.18, 0.12, 0.22),
        paintMat,
      );
      mirror.position.set(x, HY + 0.3, -HZ * 0.25);
      group.add(mirror);
    }

    // Low rear spoiler (+Z)
    const spoiler = new THREE.Mesh(
      new THREE.BoxGeometry(HX * 1.7, 0.06, 0.25),
      blackTrim,
    );
    spoiler.position.set(0, HY * 0.7, HZ * 0.95);
    group.add(spoiler);
    for (const x of [-HX * 0.7, HX * 0.7]) {
      const stand = new THREE.Mesh(
        new THREE.BoxGeometry(0.08, 0.15, 0.12),
        blackTrim,
      );
      stand.position.set(x, HY * 0.6, HZ * 0.95);
      group.add(stand);
    }

    // Headlights — on the hood front face at -Z, raised to hood level
    const headMat = new THREE.MeshStandardMaterial({
      color: 0xfff4cc,
      emissive: 0xfff1b8,
      emissiveIntensity: 1.6,
    });
    for (const x of [-HX * 0.7, HX * 0.7]) {
      const lamp = new THREE.Mesh(
        new THREE.BoxGeometry(0.32, 0.14, 0.1),
        headMat,
      );
      lamp.position.set(x, HY * 0.45, -HZ - 0.01);
      group.add(lamp);
    }

    // Taillights — red LED strip at +Z
    const tailMat = new THREE.MeshStandardMaterial({
      color: 0xff1a1a,
      emissive: 0xff0000,
      emissiveIntensity: 1.4,
    });
    const tailBar = new THREE.Mesh(
      new THREE.BoxGeometry(HX * 1.6, 0.1, 0.06),
      tailMat,
    );
    tailBar.position.set(0, HY * 0.3, HZ + 0.02);
    group.add(tailBar);
    for (const x of [-HX * 0.75, HX * 0.75]) {
      const t = new THREE.Mesh(new THREE.CircleGeometry(0.09, 16), tailMat);
      t.position.set(x, HY * 0.3, HZ + 0.03);
      group.add(t);
    }

    // Exhaust pipes (+Z, rear)
    for (const x of [-0.35, 0.35]) {
      const pipe = new THREE.Mesh(
        new THREE.CylinderGeometry(0.07, 0.07, 0.25, 12),
        chromeMat,
      );
      pipe.rotation.x = Math.PI / 2;
      pipe.position.set(x, -HY * 0.3, HZ + 0.1);
      group.add(pipe);
    }

    // Badge on hood (front -Z)
    const badge = new THREE.Mesh(
      new THREE.BoxGeometry(0.14, 0.02, 0.1),
      chromeMat,
    );
    badge.position.set(0, HY * 0.65, -HZ * 0.85);
    group.add(badge);

    // Headlight spotlights aimed forward (-Z)
    for (const x of [-HX * 0.7, HX * 0.7]) {
      const sp = new THREE.SpotLight(0xfff6d0, 10, 50, Math.PI / 7, 0.5, 1.3);
      sp.position.set(x, HY * 0.45, -HZ);
      sp.target.position.set(x, -0.4, -HZ - 12);
      group.add(sp);
      group.add(sp.target);
    }

    this.scene.add(group);

    // --- Passenger: cartoon "Donald Trump" figure standing on the roof ---
    // Satirical caricature in the spirit of political-comedy racing games.
    // Kept deliberately low-poly and cartoonish.
    this.buildRoofPassenger(group, HY, HZ);

    // Wheels — black tire + chrome multi-spoke rim
    const tireGeo = new THREE.CylinderGeometry(
      T.wheelRadius,
      T.wheelRadius,
      T.wheelHalfWidth * 2,
      28,
    );
    tireGeo.rotateZ(Math.PI / 2);
    const tireMat = new THREE.MeshStandardMaterial({
      color: 0x0a0a0c,
      roughness: 0.95,
      metalness: 0.0,
    });
    const hubMat = new THREE.MeshStandardMaterial({
      color: 0x1a1a1e,
      roughness: 0.5,
      metalness: 0.6,
    });
    const spokeMat = chromeMat;
    const brakeMat = new THREE.MeshStandardMaterial({
      color: 0xcc1a1a,
      roughness: 0.4,
      metalness: 0.3,
    });
    for (let i = 0; i < 4; i++) {
      const wheel = new THREE.Group();
      const tire = new THREE.Mesh(tireGeo, tireMat);
      tire.castShadow = true;
      wheel.add(tire);

      // Rim disc
      const rim = new THREE.Mesh(
        new THREE.CylinderGeometry(
          T.wheelRadius * 0.75,
          T.wheelRadius * 0.75,
          T.wheelHalfWidth * 1.4,
          20,
        ),
        hubMat,
      );
      rim.rotation.z = Math.PI / 2;
      wheel.add(rim);

      // Five spokes
      for (let s = 0; s < 5; s++) {
        const spoke = new THREE.Mesh(
          new THREE.BoxGeometry(T.wheelRadius * 1.3, 0.04, 0.05),
          spokeMat,
        );
        spoke.rotation.x = (s / 5) * Math.PI * 2;
        wheel.add(spoke);
      }

      // Brake caliper behind rim
      const caliper = new THREE.Mesh(
        new THREE.BoxGeometry(0.04, 0.22, 0.12),
        brakeMat,
      );
      caliper.position.set(T.wheelHalfWidth * 0.8, T.wheelRadius * 0.5, 0);
      wheel.add(caliper);

      this.wheelMeshes.push(wheel);
      this.scene.add(wheel);
    }

    // Smoke group for damage
    this.smokeGroup = new THREE.Group();
    this.scene.add(this.smokeGroup);
  }

  applyInput(input: InputState, dt: number) {
    // If destroyed, lock out all control inputs
    if (this.destroyed) {
      this.throttle = 0;
      this.steer = 0;
      this.brake = 0;
      this.handbrake = 0;
      for (let i = 0; i < 4; i++) {
        this.controller.setWheelSteering(i, 0);
        this.controller.setWheelEngineForce(i, 0);
        this.controller.setWheelBrake(i, 0);
      }
      this.controller.updateVehicle(dt);
      return;
    }

    // Smoothing
    const speed = this.getForwardSpeed();
    const speedFactor = THREE.MathUtils.clamp(
      Math.abs(speed) / T.topSpeed,
      0,
      1,
    );
    const steerRate = THREE.MathUtils.lerp(
      T.steerSpeed,
      T.steerSpeedAtHighSpeed,
      speedFactor,
    );
    const targetSteer = input.steer * T.maxSteerAngle;
    this.steer = THREE.MathUtils.damp(this.steer, targetSteer, steerRate, dt);

    this.throttle = THREE.MathUtils.damp(
      this.throttle,
      input.throttle,
      T.throttleSmoothing,
      dt,
    );
    this.brake = input.brake;
    this.handbrake = input.handbrake ? 1 : 0;

    // Degradation from damage
    const damageFactor = 1 - (this.damage / 100) * 0.5;

    // Engine force
    const enginePower = T.maxEngineForce * damageFactor;
    const overTop = speed > T.topSpeed ? 0 : 1;
    const reverseOverTop = speed < -T.topSpeed * 0.4 ? 0 : 1;

    // If throttle pressed and moving backward fast, auto-brake instead
    let forwardForce = 0;
    let rearBrake = 0;
    let frontBrake = 0;

    if (this.throttle > 0.02) {
      if (speed < -1 && this.throttle > 0.2) {
        // stop reverse motion first
        rearBrake += T.maxBrakeForce;
        frontBrake += T.maxBrakeForce * 0.6;
      } else {
        forwardForce = -this.throttle * enginePower * overTop;
      }
    }
    if (this.brake > 0.02) {
      if (speed > 0.5) {
        rearBrake += this.brake * T.maxBrakeForce;
        frontBrake += this.brake * T.maxBrakeForce * 1.2;
      } else {
        // reverse
        forwardForce = this.brake * enginePower * 0.55 * reverseOverTop;
      }
    }
    if (this.handbrake) {
      rearBrake += T.maxHandbrakeForce;
    }

    // Apply: wheels 0,1 = front (steer); 2,3 = rear (drive)
    // Front wheels are at body-local -Z, so invert steer sign to match Rapier's convention.
    this.controller.setWheelSteering(0, -this.steer);
    this.controller.setWheelSteering(1, -this.steer);
    this.controller.setWheelEngineForce(2, forwardForce);
    this.controller.setWheelEngineForce(3, forwardForce);
    this.controller.setWheelBrake(0, frontBrake);
    this.controller.setWheelBrake(1, frontBrake);
    this.controller.setWheelBrake(2, rearBrake);
    this.controller.setWheelBrake(3, rearBrake);

    // Drift: reduce rear side friction while handbraking
    const rearSideFric = this.handbrake ? 0.35 : 1.0;
    this.controller.setWheelSideFrictionStiffness(2, rearSideFric);
    this.controller.setWheelSideFrictionStiffness(3, rearSideFric);

    this.controller.updateVehicle(dt);
  }

  postPhysics(dt: number) {
    // Sync chassis visual
    const t = this.body.translation();
    const r = this.body.rotation();
    this.chassisMesh.position.set(t.x, t.y, t.z);
    this.chassisMesh.quaternion.set(r.x, r.y, r.z, r.w);

    // Wheels: use Rapier's wheel world transform
    for (let i = 0; i < 4; i++) {
      const wt = this.controller.wheelChassisConnectionPointCs(i);
      const suspension = this.controller.wheelSuspensionLength(i);
      const steering = this.controller.wheelSteering(i);
      const rotation = this.controller.wheelRotation(i);

      // Local wheel position (chassis space)
      const local = new THREE.Vector3(wt.x, wt.y - suspension, wt.z);
      const world = local
        .applyQuaternion(this.chassisMesh.quaternion)
        .add(this.chassisMesh.position);
      this.wheelMeshes[i].position.copy(world);

      // Orientation: chassis rotation * steer(Y) * spin(X)
      const q = this.chassisMesh.quaternion.clone();
      const qSteer = new THREE.Quaternion().setFromAxisAngle(
        new THREE.Vector3(0, 1, 0),
        steering,
      );
      const qSpin = new THREE.Quaternion().setFromAxisAngle(
        new THREE.Vector3(1, 0, 0),
        rotation,
      );
      q.multiply(qSteer).multiply(qSpin);
      this.wheelMeshes[i].quaternion.copy(q);
    }

    // Damage from impacts
    this.trackImpactDamage();
    this.updateSmoke(dt);
    this.updateExplosion(dt);
    if (!this.destroyed) this.autoRecoverIfFlipped(dt);
  }

  private trackImpactDamage() {
    // Impact = sudden linear-velocity vector change between steps.
    // Normal driving changes linvel smoothly (limited by engine force / gravity);
    // collisions inject a large dV in one step.
    const v = this.body.linvel();
    const dvx = v.x - this.prevLinvel.x;
    const dvy = v.y - this.prevLinvel.y;
    const dvz = v.z - this.prevLinvel.z;
    const dV = Math.hypot(dvx, dvy, dvz);
    this.prevLinvel.set(v.x, v.y, v.z);
    this.lastImpulseLen = Math.hypot(v.x, v.y, v.z);

    if (this.destroyed) return;

    // Threshold: ignore small bumps from suspension/curbs.
    const THRESH = 2.0;
    if (dV > THRESH) {
      const over = dV - THRESH;
      // Meatier damage curve: cones sting, barrels hurt, walls finish you fast.
      //   dV 3 m/s  (cone tap)     -> ~5 dmg
      //   dV 6 m/s  (barrel)       -> ~22 dmg
      //   dV 10 m/s (wall hit)     -> ~55 dmg
      //   dV 14 m/s (head-on)      -> ~100+ dmg  (instant wreck)
      const add = Math.pow(over, 1.6) * 4.0;
      this.damage = Math.min(100, this.damage + add);
      // severity 0..1 for audio/hud feedback
      const severity = Math.min(1, over / 10);
      this.onImpact?.(severity);
      if (this.damage >= 100 && !this.destroyed) {
        this.explode();
      }
    }
  }

  private explode() {
    this.destroyed = true;
    this.damage = 100;

    // Hide the chassis mesh and wheels (they've been blown apart)
    this.chassisMesh.visible = false;
    for (const w of this.wheelMeshes) w.visible = false;

    const t = this.body.translation();
    const origin = new THREE.Vector3(t.x, t.y + 0.5, t.z);

    // Big bright flash light
    this.explosionLight = new THREE.PointLight(0xffaa44, 200, 60, 2);
    this.explosionLight.position.copy(origin);
    this.scene.add(this.explosionLight);
    this.explosionLightLife = 1.2;

    // Fireball particles — multiple layered bursts
    const burstSpecs = [
      { count: 180, color: 0xffe25a, speed: 14, size: 0.35, life: 1.4 },
      { count: 140, color: 0xff6a1a, speed: 10, size: 0.5, life: 1.8 },
      { count: 120, color: 0x2a2a2a, speed: 6, size: 0.6, life: 2.4 }, // smoke
    ];
    for (const spec of burstSpecs) {
      const positions = new Float32Array(spec.count * 3);
      const velocities = new Float32Array(spec.count * 3);
      for (let i = 0; i < spec.count; i++) {
        positions[i * 3] = origin.x;
        positions[i * 3 + 1] = origin.y;
        positions[i * 3 + 2] = origin.z;
        const theta = Math.random() * Math.PI * 2;
        const phi = Math.acos(2 * Math.random() - 1);
        const s = spec.speed * (0.4 + Math.random() * 0.8);
        velocities[i * 3] = Math.sin(phi) * Math.cos(theta) * s;
        velocities[i * 3 + 1] = Math.abs(Math.cos(phi)) * s + 3; // bias upward
        velocities[i * 3 + 2] = Math.sin(phi) * Math.sin(theta) * s;
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
      const mat = new THREE.PointsMaterial({
        color: spec.color,
        size: spec.size,
        sizeAttenuation: true,
        transparent: true,
        opacity: 1.0,
        depthWrite: false,
        blending:
          spec.color === 0x2a2a2a
            ? THREE.NormalBlending
            : THREE.AdditiveBlending,
        toneMapped: false,
      });
      const pts = new THREE.Points(geo, mat);
      pts.frustumCulled = false;
      this.scene.add(pts);
      this.explosionParticles.push({
        mesh: pts,
        velocities,
        life: 0,
        maxLife: spec.life,
      });
    }

    // Kill body motion so the (invisible) chassis doesn't drift away
    this.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.body.setAngvel({ x: 0, y: 0, z: 0 }, true);

    // Disable controller inputs
    for (let i = 0; i < 4; i++) {
      this.controller.setWheelEngineForce(i, 0);
      this.controller.setWheelBrake(i, 0);
    }

    this.onDestroyed?.();
  }

  private updateExplosion(dt: number) {
    if (this.explosionLight) {
      this.explosionLightLife -= dt;
      this.explosionLight.intensity =
        Math.max(0, this.explosionLightLife / 1.2) * 200;
      if (this.explosionLightLife <= 0) {
        this.scene.remove(this.explosionLight);
        this.explosionLight = null;
      }
    }
    for (let i = this.explosionParticles.length - 1; i >= 0; i--) {
      const fp = this.explosionParticles[i];
      fp.life += dt;
      const t = fp.life / fp.maxLife;
      const pos = fp.mesh.geometry.getAttribute(
        "position",
      ) as THREE.BufferAttribute;
      const arr = pos.array as Float32Array;
      for (let j = 0; j < arr.length; j += 3) {
        arr[j] += fp.velocities[j] * dt;
        arr[j + 1] += fp.velocities[j + 1] * dt;
        arr[j + 2] += fp.velocities[j + 2] * dt;
        fp.velocities[j + 1] -= 6.5 * dt; // gravity
        fp.velocities[j] *= 0.97;
        fp.velocities[j + 1] *= 0.99;
        fp.velocities[j + 2] *= 0.97;
      }
      pos.needsUpdate = true;
      const mat = fp.mesh.material as THREE.PointsMaterial;
      mat.opacity = Math.max(0, 1 - t);
      if (fp.life >= fp.maxLife) {
        this.scene.remove(fp.mesh);
        fp.mesh.geometry.dispose();
        (fp.mesh.material as THREE.Material).dispose();
        this.explosionParticles.splice(i, 1);
      }
    }
  }

  private updateSmoke(dt: number) {
    // Spawn particles over 60% damage
    if (this.damage > 60 && Math.random() < (this.damage - 60) / 40) {
      const geo = new THREE.SphereGeometry(0.25, 6, 6);
      const mat = new THREE.MeshBasicMaterial({
        color: 0x333333,
        transparent: true,
        opacity: 0.6,
      });
      const p = new THREE.Mesh(geo, mat);
      const t = this.body.translation();
      p.position.set(t.x, t.y + 0.8, t.z);
      (p as any).life = 1.5;
      (p as any).vel = new THREE.Vector3(
        (Math.random() - 0.5) * 0.5,
        1 + Math.random(),
        (Math.random() - 0.5) * 0.5,
      );
      this.smokeGroup.add(p);
    }
    for (let i = this.smokeGroup.children.length - 1; i >= 0; i--) {
      const c = this.smokeGroup.children[i] as any;
      c.life -= dt;
      c.position.addScaledVector(c.vel, dt);
      c.scale.multiplyScalar(1 + dt * 0.6);
      c.material.opacity = Math.max(0, (c.life / 1.5) * 0.6);
      if (c.life <= 0) this.smokeGroup.remove(c);
    }
  }

  private flipTime = 0;
  private autoRecoverIfFlipped(dt: number) {
    const up = new THREE.Vector3(0, 1, 0);
    const carUp = new THREE.Vector3(0, 1, 0).applyQuaternion(
      this.chassisMesh.quaternion,
    );
    if (carUp.dot(up) < 0.2) {
      this.flipTime += dt;
      if (this.flipTime > 1.5) {
        const t = this.body.translation();
        const tang = new THREE.Vector3();
        // upright
        const q = new THREE.Quaternion().setFromEuler(
          new THREE.Euler(0, this.getYaw(), 0),
        );
        this.body.setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }, true);
        this.body.setTranslation({ x: t.x, y: t.y + 1.0, z: t.z }, true);
        this.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
        this.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
        this.flipTime = 0;
      }
    } else {
      this.flipTime = 0;
    }
  }

  resetTo(position: THREE.Vector3, rotation: THREE.Quaternion) {
    this.body.setTranslation(
      { x: position.x, y: position.y, z: position.z },
      true,
    );
    this.body.setRotation(
      { x: rotation.x, y: rotation.y, z: rotation.z, w: rotation.w },
      true,
    );
    this.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    this.damage = 0;
    this.destroyed = false;
    this.chassisMesh.visible = true;
    for (const w of this.wheelMeshes) w.visible = true;
    // Clean up any lingering explosion FX
    if (this.explosionLight) {
      this.scene.remove(this.explosionLight);
      this.explosionLight = null;
    }
    for (const fp of this.explosionParticles) {
      this.scene.remove(fp.mesh);
      fp.mesh.geometry.dispose();
      (fp.mesh.material as THREE.Material).dispose();
    }
    this.explosionParticles.length = 0;
    this.prevLinvel.set(0, 0, 0);
    this.steer = this.throttle = 0;
  }

  getPosition(): THREE.Vector3 {
    const t = this.body.translation();
    return new THREE.Vector3(t.x, t.y, t.z);
  }

  getQuaternion(): THREE.Quaternion {
    const r = this.body.rotation();
    return new THREE.Quaternion(r.x, r.y, r.z, r.w);
  }

  /** Add damage from an external event (e.g. obstacle collision). */
  addDamage(amount: number, severity = 0.5) {
    if (this.destroyed) return;
    this.damage = Math.min(100, this.damage + amount);
    this.onImpact?.(Math.min(1, severity));
    if (this.damage >= 100) this.explode();
  }

  /**
   * Build a cartoonish "Donald Trump" figure standing on top of the chassis.
   * Entirely low-poly: a blue-suit body, flesh-tone head, yellow swoop hair,
   * and a long red tie. Attached to the chassis group so it rides along.
   */
  private buildRoofPassenger(
    parent: THREE.Group,
    HY: number,
    HZ: number,
  ) {
    const fig = new THREE.Group();
    // Car local: forward = -Z. Stand the figure slightly behind center so
    // he doesn't block the camera view of the hood.
    fig.position.set(0, HY + 0.05, HZ * 0.15);

    // Suit / torso (navy blue jacket)
    const suitMat = new THREE.MeshStandardMaterial({
      color: 0x0a1e4a,
      roughness: 0.7,
      metalness: 0.05,
    });
    const torso = new THREE.Mesh(
      new THREE.CylinderGeometry(0.24, 0.3, 0.75, 12),
      suitMat,
    );
    torso.position.y = 0.38;
    torso.castShadow = true;
    fig.add(torso);

    // White shirt triangle
    const shirtMat = new THREE.MeshStandardMaterial({
      color: 0xf5f5f5,
      roughness: 0.8,
    });
    const shirt = new THREE.Mesh(
      new THREE.BoxGeometry(0.18, 0.5, 0.05),
      shirtMat,
    );
    shirt.position.set(0, 0.38, -0.24);
    fig.add(shirt);

    // Long red tie
    const tieMat = new THREE.MeshStandardMaterial({
      color: 0xd40000,
      roughness: 0.5,
    });
    const tie = new THREE.Mesh(
      new THREE.BoxGeometry(0.08, 0.42, 0.03),
      tieMat,
    );
    tie.position.set(0, 0.32, -0.265);
    fig.add(tie);

    // Head — peachy flesh tone
    const skinMat = new THREE.MeshStandardMaterial({
      color: 0xf2c89a,
      roughness: 0.75,
    });
    const head = new THREE.Mesh(
      new THREE.SphereGeometry(0.22, 16, 14),
      skinMat,
    );
    head.position.y = 0.95;
    head.castShadow = true;
    fig.add(head);

    // Signature yellow-blond swoop hair — a slightly flattened sphere on top
    const hairMat = new THREE.MeshStandardMaterial({
      color: 0xf7d26a,
      roughness: 0.55,
      metalness: 0.05,
    });
    const hair = new THREE.Mesh(
      new THREE.SphereGeometry(0.24, 16, 12, 0, Math.PI * 2, 0, Math.PI / 1.6),
      hairMat,
    );
    hair.position.y = 1.02;
    hair.scale.set(1.05, 0.75, 1.1);
    hair.rotation.y = 0.15;
    fig.add(hair);

    // A small "swoop" front bang
    const bang = new THREE.Mesh(
      new THREE.BoxGeometry(0.26, 0.05, 0.18),
      hairMat,
    );
    bang.position.set(0.02, 1.08, -0.17);
    bang.rotation.z = -0.18;
    fig.add(bang);

    // Eyes — tiny dark dots
    const eyeMat = new THREE.MeshStandardMaterial({ color: 0x111111 });
    for (const dx of [-0.07, 0.07]) {
      const eye = new THREE.Mesh(
        new THREE.SphereGeometry(0.022, 8, 6),
        eyeMat,
      );
      eye.position.set(dx, 0.97, -0.2);
      fig.add(eye);
    }

    // Arms — one raised in a thumbs-up wave
    const armMat = suitMat;
    const leftArm = new THREE.Mesh(
      new THREE.CylinderGeometry(0.07, 0.07, 0.55, 8),
      armMat,
    );
    leftArm.position.set(-0.3, 0.5, 0);
    leftArm.rotation.z = 0.25;
    fig.add(leftArm);
    const rightArm = new THREE.Mesh(
      new THREE.CylinderGeometry(0.07, 0.07, 0.55, 8),
      armMat,
    );
    rightArm.position.set(0.32, 0.7, 0);
    rightArm.rotation.z = -1.15; // raised
    fig.add(rightArm);
    // Thumb-up hand
    const hand = new THREE.Mesh(
      new THREE.SphereGeometry(0.09, 10, 8),
      skinMat,
    );
    hand.position.set(0.55, 0.95, 0);
    fig.add(hand);

    parent.add(fig);
  }

  getSpeed(): number {
    const v = this.body.linvel();
    return Math.hypot(v.x, v.y, v.z);
  }

  getForwardSpeed(): number {
    const v = this.body.linvel();
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(
      this.getQuaternion(),
    );
    return v.x * fwd.x + v.y * fwd.y + v.z * fwd.z;
  }

  getYaw(): number {
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(
      this.getQuaternion(),
    );
    return Math.atan2(-fwd.x, -fwd.z);
  }

  /** Approximate gear 1..6 based on speed. */
  getGear(): string {
    const s = this.getForwardSpeed();
    if (s < -0.5) return "R";
    if (Math.abs(s) < 0.5) return "N";
    const kmh = s * 3.6;
    if (kmh < 30) return "1";
    if (kmh < 60) return "2";
    if (kmh < 100) return "3";
    if (kmh < 150) return "4";
    if (kmh < 200) return "5";
    return "6";
  }

  /** Rough slip ratio 0..1 for audio skid. */
  getSlip(): number {
    const v = this.body.linvel();
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(
      this.getQuaternion(),
    );
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(
      this.getQuaternion(),
    );
    const lat = Math.abs(v.x * right.x + v.z * right.z);
    const fwdS = Math.abs(v.x * fwd.x + v.z * fwd.z);
    const total = Math.hypot(lat, fwdS) + 0.01;
    return (
      THREE.MathUtils.clamp(lat / total, 0, 1) *
      THREE.MathUtils.clamp(total / 20, 0, 1)
    );
  }
}
