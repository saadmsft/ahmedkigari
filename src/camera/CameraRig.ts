import * as THREE from "three";
import type { Vehicle } from "../vehicle/Vehicle";
import type { InputState } from "../input/InputManager";

type Mode = "chase" | "hood" | "cockpit" | "orbit";
const MODES: Mode[] = ["chase", "hood", "cockpit", "orbit"];

export class CameraRig {
  camera: THREE.PerspectiveCamera;
  vehicle: Vehicle;
  modeIndex = 0;

  private currentPos = new THREE.Vector3();
  private currentLook = new THREE.Vector3();
  private orbitAngle = 0;
  private initialized = false;

  constructor(camera: THREE.PerspectiveCamera, vehicle: Vehicle) {
    this.camera = camera;
    this.vehicle = vehicle;
  }

  cycle() {
    this.modeIndex = (this.modeIndex + 1) % MODES.length;
  }

  update(dt: number, _input: InputState) {
    const mode = MODES[this.modeIndex];
    const carPos = this.vehicle.getPosition();
    const carQuat = this.vehicle.getQuaternion();
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(carQuat);
    const up = new THREE.Vector3(0, 1, 0);
    const speed = Math.abs(this.vehicle.getForwardSpeed());

    let targetPos = new THREE.Vector3();
    let targetLook = new THREE.Vector3();
    let lerpRate = 6;
    let fov = 70;

    if (mode === "chase") {
      const back = fwd.clone().multiplyScalar(-7);
      targetPos = carPos.clone().add(back).add(up.clone().multiplyScalar(3.2));
      targetLook = carPos
        .clone()
        .add(fwd.clone().multiplyScalar(4))
        .add(up.clone().multiplyScalar(1.2));
      fov = 70 + Math.min(15, speed * 0.3);
      lerpRate = 6;
    } else if (mode === "hood") {
      const off = new THREE.Vector3(0, 1.1, 1.0).applyQuaternion(carQuat);
      targetPos = carPos.clone().add(off);
      targetLook = carPos
        .clone()
        .add(fwd.clone().multiplyScalar(12))
        .add(up.clone().multiplyScalar(0.8));
      fov = 75;
      lerpRate = 20;
    } else if (mode === "cockpit") {
      const off = new THREE.Vector3(-0.35, 1.1, -0.2).applyQuaternion(carQuat);
      targetPos = carPos.clone().add(off);
      targetLook = carPos
        .clone()
        .add(fwd.clone().multiplyScalar(10))
        .add(up.clone().multiplyScalar(1.0));
      fov = 80;
      lerpRate = 30;
    } else {
      // orbit
      this.orbitAngle += dt * 0.3;
      const r = 10;
      targetPos = carPos
        .clone()
        .add(
          new THREE.Vector3(
            Math.cos(this.orbitAngle) * r,
            4,
            Math.sin(this.orbitAngle) * r,
          ),
        );
      targetLook = carPos.clone().add(up.clone().multiplyScalar(1.0));
      fov = 60;
      lerpRate = 3;
    }

    this.currentPos.lerp(targetPos, 1 - Math.exp(-lerpRate * dt));
    this.currentLook.lerp(targetLook, 1 - Math.exp(-lerpRate * dt));
    if (!this.initialized) {
      this.currentPos.copy(targetPos);
      this.currentLook.copy(targetLook);
      this.initialized = true;
    }
    this.camera.position.copy(this.currentPos);
    this.camera.lookAt(this.currentLook);
    this.camera.fov += (fov - this.camera.fov) * (1 - Math.exp(-4 * dt));
    this.camera.updateProjectionMatrix();
  }
}
