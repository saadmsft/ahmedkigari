import type { Vehicle } from "../vehicle/Vehicle";
import type { Track } from "../world/Track";
import type { Race } from "../game/Race";

export class HUD {
  kmh = document.getElementById("kmh") as HTMLSpanElement;
  gear = document.getElementById("gear") as HTMLDivElement;
  lapTime = document.getElementById("lap-time") as HTMLDivElement;
  lapBest = document.getElementById("lap-best") as HTMLSpanElement;
  lapCount = document.getElementById("lap-count") as HTMLSpanElement;
  damageBar = document.getElementById("damage-bar") as HTMLDivElement;
  minimap = document.getElementById("minimap") as HTMLCanvasElement;
  ctx = this.minimap.getContext("2d")!;
  countdown = document.getElementById("countdown") as HTMLDivElement;

  update(vehicle: Vehicle, race: Race, track: Track) {
    const speedKmh = Math.round(Math.abs(vehicle.getForwardSpeed()) * 3.6);
    this.kmh.textContent = String(speedKmh);
    this.gear.textContent = vehicle.getGear();

    this.lapTime.textContent = formatTime(race.currentLapTime);
    this.lapBest.textContent =
      race.bestLapTime != null ? formatTime(race.bestLapTime) : "—";
    this.lapCount.textContent = `LAP ${Math.min(race.lap, race.totalLaps)} / ${race.totalLaps}`;

    this.damageBar.style.width = `${vehicle.damage}%`;

    this.drawMinimap(vehicle, track, race);
  }

  showCountdown(text: string) {
    this.countdown.textContent = text;
    this.countdown.style.display = text ? "flex" : "none";
  }

  private drawMinimap(vehicle: Vehicle, track: Track, race: Race) {
    const c = this.ctx;
    const W = this.minimap.width;
    const H = this.minimap.height;
    c.clearRect(0, 0, W, H);

    // compute bounds
    let minX = Infinity,
      maxX = -Infinity,
      minZ = Infinity,
      maxZ = -Infinity;
    for (const p of track.samples) {
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.z < minZ) minZ = p.z;
      if (p.z > maxZ) maxZ = p.z;
    }
    const pad = 20;
    const sx = (W - pad * 2) / (maxX - minX);
    const sz = (H - pad * 2) / (maxZ - minZ);
    const s = Math.min(sx, sz);
    const ox = (W - (maxX - minX) * s) / 2;
    const oz = (H - (maxZ - minZ) * s) / 2;
    const map = (x: number, z: number) =>
      [ox + (x - minX) * s, oz + (z - minZ) * s] as [number, number];

    // road
    c.strokeStyle = "#ffffffaa";
    c.lineWidth = 5;
    c.beginPath();
    for (let i = 0; i < track.samples.length; i++) {
      const p = track.samples[i];
      const [x, y] = map(p.x, p.z);
      if (i === 0) c.moveTo(x, y);
      else c.lineTo(x, y);
    }
    c.closePath();
    c.stroke();

    // checkpoints
    for (let i = 0; i < track.checkpoints.length; i++) {
      const cp = track.checkpoints[i];
      const [x, y] = map(cp.position.x, cp.position.z);
      c.fillStyle = i === race.nextCheckpoint ? "#ffd452" : "#ffffff55";
      c.beginPath();
      c.arc(x, y, i === race.nextCheckpoint ? 5 : 3, 0, Math.PI * 2);
      c.fill();
    }

    // car
    const pos = vehicle.getPosition();
    const [cx, cy] = map(pos.x, pos.z);
    c.fillStyle = "#ff2b2b";
    c.beginPath();
    c.arc(cx, cy, 5, 0, Math.PI * 2);
    c.fill();
  }
}

export function formatTime(s: number): string {
  if (!isFinite(s) || s < 0) return "—";
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  const ms = Math.floor((s - Math.floor(s)) * 1000);
  return `${m}:${String(sec).padStart(2, "0")}.${String(ms).padStart(3, "0")}`;
}
