import * as THREE from "three";
import { Renderer } from "./Renderer";
import { PhysicsWorld } from "./PhysicsWorld";
import { Environment } from "../world/Environment";
import { Track } from "../world/Track";
import { Props } from "../world/Props";
import { Vehicle } from "../vehicle/Vehicle";
import { InputManager } from "../input/InputManager";
import { CameraRig } from "../camera/CameraRig";
import { HUD } from "../ui/HUD";
import { Race } from "../game/Race";
import { AudioManager } from "../audio/AudioManager";
import { LapStartFX } from "../game/LapStartFX";

type ProgressFn = (pct: number, msg?: string) => void;

export class Game {
  renderer!: Renderer;
  physics!: PhysicsWorld;
  env!: Environment;
  track!: Track;
  props!: Props;
  vehicle!: Vehicle;
  input!: InputManager;
  cameraRig!: CameraRig;
  hud!: HUD;
  race!: Race;
  audio!: AudioManager;
  fx!: LapStartFX;

  private running = false;
  private paused = false;
  private lastTime = 0;
  private accumulator = 0;
  private readonly fixedDt = 1 / 60;

  async init(onProgress: ProgressFn) {
    onProgress(0.1, "Creating renderer…");
    this.renderer = new Renderer();

    onProgress(0.25, "Loading physics engine…");
    this.physics = new PhysicsWorld();
    await this.physics.init();

    onProgress(0.4, "Building environment…");
    this.env = new Environment(this.renderer.scene, this.physics);

    onProgress(0.55, "Generating track…");
    this.track = new Track(this.renderer.scene, this.physics);
    this.track.build();

    onProgress(0.7, "Scattering props…");
    this.props = new Props(this.renderer.scene, this.physics, this.track);
    this.props.build();

    onProgress(0.8, "Spawning vehicle…");
    this.vehicle = new Vehicle(this.renderer.scene, this.physics);
    const spawn = this.track.getSpawn();
    this.vehicle.build(spawn.position, spawn.rotation);

    onProgress(0.88, "Setting up controls…");
    this.input = new InputManager();
    this.input.attach();

    this.cameraRig = new CameraRig(this.renderer.camera, this.vehicle);
    this.hud = new HUD();
    this.race = new Race(this.track, this.vehicle, this.hud);
    this.race.onFinish = () => this.audio.stopMusic();
    this.fx = new LapStartFX(this.renderer.scene, this.track);

    // When the car blows up, audibly crash and finish the race.
    this.vehicle.onDestroyed = () => {
      this.audio.playImpact(1);
      this.audio.playHaww();
      // Show the KABOOOM popup
      const kaboom = document.getElementById("kaboom");
      if (kaboom) {
        kaboom.classList.remove("show");
        // Force reflow so the animation restarts cleanly if it replays
        void (kaboom as HTMLElement).offsetWidth;
        kaboom.classList.add("show");
      }
      // Let the popup play before showing results (popup lasts ~3.2s)
      window.setTimeout(() => {
        if (kaboom) kaboom.classList.remove("show");
        this.audio.stopMusic();
        this.race.forceFinish("WRECKED");
      }, 2800);
    };
    this.vehicle.onImpact = (severity) => {
      this.audio.playImpact(severity);
    };

    onProgress(0.95, "Loading audio…");
    this.audio = new AudioManager();
    await this.audio.init();

    // Global hotkeys
    window.addEventListener("keydown", (e) => {
      if (e.key === "Escape") this.togglePause();
    });

    // Touch buttons for camera / reset / pause handled via InputManager flags
    this.input.onCamera = () => this.cameraRig.cycle();
    this.input.onReset = () => this.resetVehicle();

    // Resize
    window.addEventListener("resize", () => this.renderer.onResize());
    this.renderer.onResize();

    // Prime the camera + render one frame so the scene is visible behind the start menu.
    this.cameraRig.update(1 / 60, this.input.state);
    this.renderer.render();
  }

  start() {
    this.running = true;
    this.paused = false;
    this.lastTime = performance.now();
    this.audio.startEngine();
    this.race.beginCountdown(() => {
      this.race.startLap();
      this.fx.trigger();
      this.audio.playMusic();
    });
    requestAnimationFrame(this.frame);
  }

  restart() {
    document.getElementById("results-menu")!.hidden = true;
    const resultsTitle = document.querySelector("#results-menu h2");
    if (resultsTitle) resultsTitle.textContent = "Race finished";
    document.getElementById("pause-menu")!.hidden = true;
    document.getElementById("hud")!.hidden = false;
    document.getElementById("kaboom")?.classList.remove("show");
    this.audio.stopMusic();
    this.resetVehicle();
    this.race.reset();
    this.paused = false;
    this.running = true;
    this.race.beginCountdown(() => {
      this.race.startLap();
      this.fx.trigger();
      this.audio.playMusic();
    });
  }

  resume() {
    document.getElementById("pause-menu")!.hidden = true;
    this.paused = false;
    this.lastTime = performance.now();
    this.audio.resumeMusic();
  }

  togglePause() {
    if (!this.running) return;
    this.paused = !this.paused;
    document.getElementById("pause-menu")!.hidden = !this.paused;
    if (!this.paused) {
      this.lastTime = performance.now();
      this.audio.resumeMusic();
    } else {
      this.audio.pauseMusic();
    }
  }

  toggleDayNight() {
    this.env.toggleCycle();
  }

  private resetVehicle() {
    const spawn = this.track.getNearestSpawn(this.vehicle.getPosition());
    this.vehicle.resetTo(spawn.position, spawn.rotation);
  }

  private frame = (t: number) => {
    if (!this.running) return;
    const now = t;
    let dt = (now - this.lastTime) / 1000;
    this.lastTime = now;
    if (dt > 0.25) dt = 0.25;

    if (!this.paused) {
      this.input.update();
      this.accumulator += dt;
      while (this.accumulator >= this.fixedDt) {
        this.vehicle.applyInput(this.input.state, this.fixedDt);
        this.physics.step(this.fixedDt);
        // Drain collision events — translate car↔obstacle contacts into damage.
        this.physics.eventQueue.drainCollisionEvents(
          (h1: number, h2: number, started: boolean) => {
            if (!started || this.vehicle.destroyed) return;
            const carH = this.vehicle.chassisCollider.handle;
            let obstacleH = -1;
            if (h1 === carH) obstacleH = h2;
            else if (h2 === carH) obstacleH = h1;
            else return;
            const info = this.props.obstacleByHandle.get(obstacleH);
            if (!info) return;
            // Scale damage by current car speed so slow taps barely hurt.
            const speed = this.vehicle.getSpeed();
            const speedFactor = Math.min(1.5, 0.3 + speed / 25);
            const amount = info.damage * speedFactor;
            this.vehicle.addDamage(amount, Math.min(1, amount / 25));
            if (info.kind === "cone") this.audio.playHayeOye();
          },
        );
        this.vehicle.postPhysics(this.fixedDt);
        this.props.postPhysicsSync();
        this.race.update(this.fixedDt);
        this.accumulator -= this.fixedDt;
      }
      this.env.update(dt);
      this.cameraRig.update(dt, this.input.state);
      this.audio.update(this.vehicle, dt);
      this.hud.update(this.vehicle, this.race, this.track);
      this.fx.update(dt);
    }

    this.renderer.render();
    requestAnimationFrame(this.frame);
  };
}
