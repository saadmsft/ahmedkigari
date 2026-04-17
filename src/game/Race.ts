import type { Track } from "../world/Track";
import type { Vehicle } from "../vehicle/Vehicle";
import type { HUD } from "../ui/HUD";
import { formatTime } from "../ui/HUD";

const BEST_LAP_KEY = "apexdrive.bestLap";

export class Race {
  track: Track;
  vehicle: Vehicle;
  hud: HUD;

  totalLaps = 3;
  lap = 1;
  // Car spawns behind checkpoint 0 (start/finish line). We require crossing
  // all other checkpoints in order, then returning through cp0 to count a lap.
  // Starting at 1 prevents the spawn position from instantly triggering cp0.
  nextCheckpoint = 1;
  currentLapTime = 0;
  bestLapTime: number | null = null;
  splits: number[] = [];
  active = false;
  onFinish?: () => void;

  constructor(track: Track, vehicle: Vehicle, hud: HUD) {
    this.track = track;
    this.vehicle = vehicle;
    this.hud = hud;
    const saved = localStorage.getItem(BEST_LAP_KEY);
    if (saved) this.bestLapTime = parseFloat(saved);
  }

  reset() {
    this.lap = 1;
    this.nextCheckpoint = 1;
    this.currentLapTime = 0;
    this.splits = [];
    this.active = false;
  }

  beginCountdown(onGo: () => void) {
    const hud = this.hud;
    let step = 3;
    hud.showCountdown(String(step));
    const tick = () => {
      step--;
      if (step > 0) {
        hud.showCountdown(String(step));
        setTimeout(tick, 800);
      } else if (step === 0) {
        hud.showCountdown("GO!");
        setTimeout(() => {
          hud.showCountdown("");
          onGo();
        }, 600);
      }
    };
    setTimeout(tick, 800);
  }

  startLap() {
    this.active = true;
    this.currentLapTime = 0;
  }

  update(dt: number) {
    if (!this.active) return;
    this.currentLapTime += dt;

    // Checkpoint logic
    const pos = this.vehicle.getPosition();
    const cp = this.track.checkpoints[this.nextCheckpoint];
    const toCp = cp.position.clone().sub(pos);
    const distPlane = Math.hypot(toCp.x, toCp.z);
    const yOk = Math.abs(toCp.y) < 5;
    // Approach: within radius along the road and roughly facing through it
    if (distPlane < cp.half + 3 && yOk) {
      this.nextCheckpoint =
        (this.nextCheckpoint + 1) % this.track.checkpoints.length;
      if (this.nextCheckpoint === 0) {
        // Completed a lap
        this.splits.push(this.currentLapTime);
        if (
          this.bestLapTime == null ||
          this.currentLapTime < this.bestLapTime
        ) {
          this.bestLapTime = this.currentLapTime;
          localStorage.setItem(BEST_LAP_KEY, String(this.bestLapTime));
        }
        if (this.lap >= this.totalLaps) {
          this.active = false;
          this.showResults();
          return;
        }
        this.lap++;
        this.currentLapTime = 0;
      }
    }
  }

  private showResults(reason?: string) {
    this.onFinish?.();
    const menu = document.getElementById("results-menu")!;
    const body = document.getElementById("results-body")!;
    const title = menu.querySelector("h2");
    if (title) title.textContent = reason ? reason : "Race finished";
    const splits = this.splits;
    if (splits.length === 0) {
      body.innerHTML = `
        <div style="font-size:18px; margin-bottom:8px;">${reason ? "Car destroyed before completing a lap." : ""}</div>
        <div>No lap times recorded.</div>
      `;
    } else {
      const best = splits.reduce((a, b) => Math.min(a, b), Infinity);
      const total = splits.reduce((a, b) => a + b, 0);
      body.innerHTML = `
        <div>Total: <b>${formatTime(total)}</b></div>
        <div>Best lap: <b>${formatTime(best)}</b></div>
        <div style="margin-top:8px; opacity:.7">Splits: ${splits.map((s) => formatTime(s)).join(" · ")}</div>
      `;
    }
    menu.hidden = false;
  }

  forceFinish(reason: string) {
    if (!this.active) return;
    this.active = false;
    this.showResults(reason);
  }
}
