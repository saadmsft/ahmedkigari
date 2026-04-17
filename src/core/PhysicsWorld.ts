import RAPIER from "@dimforge/rapier3d-compat";

export class PhysicsWorld {
  world!: RAPIER.World;
  eventQueue!: RAPIER.EventQueue;
  RAPIER!: typeof RAPIER;

  async init() {
    await RAPIER.init();
    this.RAPIER = RAPIER;
    const gravity = { x: 0, y: -9.81 * 2, z: 0 };
    this.world = new RAPIER.World(gravity);
    this.world.timestep = 1 / 60;
    this.eventQueue = new RAPIER.EventQueue(true);
  }

  step(_dt: number) {
    this.world.step(this.eventQueue);
  }
}
