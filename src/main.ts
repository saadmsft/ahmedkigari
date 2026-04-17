import { Game } from "./core/Game";

const loading = document.getElementById("loading") as HTMLDivElement;
const loadingBar = document.getElementById("loading-bar") as HTMLDivElement;
const loadingText = document.getElementById("loading-text") as HTMLElement;
const startMenu = document.getElementById("start-menu") as HTMLDivElement;
const hud = document.getElementById("hud") as HTMLDivElement;

async function boot() {
  const setProgress = (pct: number, msg?: string) => {
    loadingBar.style.width = `${Math.min(100, Math.max(0, pct * 100))}%`;
    if (msg) loadingText.textContent = msg;
  };

  setProgress(0.05, "Initializing physics…");
  const game = new Game();
  await game.init((p, m) => setProgress(p, m));

  setProgress(1, "Ready");
  loading.style.opacity = "0";
  setTimeout(() => (loading.style.display = "none"), 400);

  // Start menu
  (document.getElementById("btn-start") as HTMLButtonElement).onclick = () => {
    startMenu.hidden = true;
    hud.hidden = false;
    game.start();
  };

  (document.getElementById("btn-resume") as HTMLButtonElement).onclick = () =>
    game.resume();
  (document.getElementById("btn-restart") as HTMLButtonElement).onclick = () =>
    game.restart();
  (document.getElementById("btn-again") as HTMLButtonElement).onclick = () =>
    game.restart();
  (
    document.getElementById("btn-toggle-daynight") as HTMLButtonElement
  ).onclick = () => game.toggleDayNight();
}

boot().catch((err) => {
  console.error(err);
  loadingText.textContent = `Failed to start: ${err?.message ?? err}`;
  if (err?.stack) console.error(err.stack);
});
