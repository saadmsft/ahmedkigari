export interface InputState {
  steer: number; // -1..1
  throttle: number; // 0..1
  brake: number; // 0..1
  handbrake: boolean;
  cameraPressed: boolean;
  resetPressed: boolean;
}

export class InputManager {
  state: InputState = {
    steer: 0,
    throttle: 0,
    brake: 0,
    handbrake: false,
    cameraPressed: false,
    resetPressed: false,
  };

  onCamera: () => void = () => {};
  onReset: () => void = () => {};

  private keys = new Set<string>();
  private touchSteer = 0;
  private touchThrottle = 0;
  private touchBrake = 0;
  private touchHandbrake = false;
  private prevCamBtn = false;
  private prevResetBtn = false;

  attach() {
    window.addEventListener("keydown", (e) => {
      this.keys.add(e.code);
      if (e.code === "KeyC") this.triggerCamera();
      if (e.code === "KeyR") this.triggerReset();
    });
    window.addEventListener("keyup", (e) => this.keys.delete(e.code));
    window.addEventListener("blur", () => this.keys.clear());

    this.setupTouch();
  }

  private triggerCamera() {
    this.onCamera();
  }
  private triggerReset() {
    this.onReset();
  }

  private setupTouch() {
    const touchRoot = document.getElementById("touch")!;
    const isTouch =
      matchMedia("(pointer: coarse)").matches || "ontouchstart" in window;
    if (isTouch) touchRoot.classList.add("active");

    const stick = document.getElementById("t-stick") as HTMLDivElement;
    const knob = document.getElementById("t-knob") as HTMLDivElement;
    const throttleEl = document.getElementById("t-throttle") as HTMLDivElement;
    const brakeEl = document.getElementById("t-brake") as HTMLDivElement;
    const handEl = document.getElementById("t-handbrake") as HTMLDivElement;
    const camEl = document.getElementById("t-cam") as HTMLDivElement;
    const resetEl = document.getElementById("t-reset") as HTMLDivElement;

    let stickId: number | null = null;
    let stickRect: DOMRect | null = null;

    const stickMove = (x: number, y: number) => {
      if (!stickRect) return;
      const cx = stickRect.left + stickRect.width / 2;
      const cy = stickRect.top + stickRect.height / 2;
      const dx = x - cx;
      const dy = y - cy;
      const max = stickRect.width / 2;
      const nx = Math.max(-1, Math.min(1, dx / max));
      const ny = Math.max(-1, Math.min(1, dy / max));
      this.touchSteer = nx;
      knob.style.transform = `translate(${nx * max * 0.6}px, ${ny * max * 0.6}px)`;
    };
    stick.addEventListener("pointerdown", (e) => {
      stickId = e.pointerId;
      stick.setPointerCapture(e.pointerId);
      stickRect = stick.getBoundingClientRect();
      stickMove(e.clientX, e.clientY);
    });
    stick.addEventListener("pointermove", (e) => {
      if (e.pointerId !== stickId) return;
      stickMove(e.clientX, e.clientY);
    });
    const stickEnd = (e: PointerEvent) => {
      if (e.pointerId !== stickId) return;
      stickId = null;
      this.touchSteer = 0;
      knob.style.transform = "";
    };
    stick.addEventListener("pointerup", stickEnd);
    stick.addEventListener("pointercancel", stickEnd);

    const holdButton = (
      el: HTMLElement,
      onDown: () => void,
      onUp: () => void,
    ) => {
      el.addEventListener("pointerdown", (e) => {
        el.setPointerCapture(e.pointerId);
        onDown();
      });
      const up = () => onUp();
      el.addEventListener("pointerup", up);
      el.addEventListener("pointercancel", up);
      el.addEventListener("pointerleave", up);
    };
    holdButton(
      throttleEl,
      () => (this.touchThrottle = 1),
      () => (this.touchThrottle = 0),
    );
    holdButton(
      brakeEl,
      () => (this.touchBrake = 1),
      () => (this.touchBrake = 0),
    );
    holdButton(
      handEl,
      () => (this.touchHandbrake = true),
      () => (this.touchHandbrake = false),
    );

    camEl.addEventListener("click", () => this.triggerCamera());
    resetEl.addEventListener("click", () => this.triggerReset());
  }

  update() {
    // Keyboard axes
    let steer = 0;
    if (this.keys.has("KeyA") || this.keys.has("ArrowLeft")) steer -= 1;
    if (this.keys.has("KeyD") || this.keys.has("ArrowRight")) steer += 1;
    let throttle = 0;
    if (this.keys.has("KeyW") || this.keys.has("ArrowUp")) throttle = 1;
    let brake = 0;
    if (this.keys.has("KeyS") || this.keys.has("ArrowDown")) brake = 1;
    const hb = this.keys.has("Space");

    // Touch overrides only if nonzero
    if (this.touchSteer !== 0) steer = this.touchSteer;
    if (this.touchThrottle > 0) throttle = this.touchThrottle;
    if (this.touchBrake > 0) brake = this.touchBrake;

    // Gamepad
    const gp = navigator.getGamepads?.()[0];
    let camBtn = false;
    let resetBtn = false;
    if (gp) {
      const ax = gp.axes[0] ?? 0;
      if (Math.abs(ax) > 0.08) steer = ax;
      const rt = gp.buttons[7]?.value ?? 0;
      const lt = gp.buttons[6]?.value ?? 0;
      if (rt > throttle) throttle = rt;
      if (lt > brake) brake = lt;
      if (gp.buttons[0]?.pressed) {
        // A
      }
      const hbBtn = gp.buttons[1]?.pressed; // B
      if (hbBtn) this.state.handbrake = true;
      camBtn = !!gp.buttons[3]?.pressed; // Y
      resetBtn = !!gp.buttons[2]?.pressed; // X
    }
    this.state.steer = Math.max(-1, Math.min(1, steer));
    this.state.throttle = Math.max(0, Math.min(1, throttle));
    this.state.brake = Math.max(0, Math.min(1, brake));
    this.state.handbrake =
      hb || this.touchHandbrake || (gp?.buttons[1]?.pressed ?? false);

    if (camBtn && !this.prevCamBtn) this.triggerCamera();
    if (resetBtn && !this.prevResetBtn) this.triggerReset();
    this.prevCamBtn = camBtn;
    this.prevResetBtn = resetBtn;
  }
}
