import { launch, reset, setPlannedDv, setSpeed, type Game } from "./state";
import { panBy, worldToScreen, zoomAt } from "../render/camera";
import { SIM_SPEEDS, type SimSpeed } from "../sim/physics";

export interface InputElements {
  canvas: HTMLCanvasElement;
  launchButton: HTMLButtonElement;
  resetButtons: HTMLButtonElement[];
  speedButtons: HTMLButtonElement[];
}

export function bindInput(
  game: Game,
  elements: InputElements,
  getSize: () => { width: number; height: number },
  onReset?: () => void,
): void {
  const { canvas } = elements;
  let pointerId: number | null = null;
  let mode: "pan" | "aim" | null = null;
  let lastX = 0;
  let lastY = 0;

  canvas.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 || pointerId !== null) return;
    pointerId = event.pointerId;
    canvas.setPointerCapture(event.pointerId);
    lastX = event.offsetX;
    lastY = event.offsetY;
    const size = getSize();
    const ship = worldToScreen(game.camera, size.width, size.height, game.initial.x, game.initial.y);
    const nearShip = Math.hypot(event.offsetX - ship.x, event.offsetY - ship.y) < 26;
    mode = game.mode === "planning" && nearShip ? "aim" : "pan";
    canvas.classList.toggle("aiming", mode === "aim");
    canvas.classList.toggle("panning", mode === "pan");
    if (mode === "aim") aim(event.offsetX, event.offsetY);
  });

  canvas.addEventListener("pointermove", (event) => {
    if (event.pointerId !== pointerId || mode === null) return;
    if (mode === "pan") {
      panBy(game.camera, event.offsetX - lastX, event.offsetY - lastY);
      lastX = event.offsetX;
      lastY = event.offsetY;
      return;
    }
    aim(event.offsetX, event.offsetY);
  });

  const endPointer = (event: PointerEvent) => {
    if (event.pointerId !== pointerId) return;
    pointerId = null;
    mode = null;
    canvas.classList.remove("aiming", "panning");
  };
  canvas.addEventListener("pointerup", endPointer);
  canvas.addEventListener("pointercancel", endPointer);

  canvas.addEventListener(
    "wheel",
    (event) => {
      event.preventDefault();
      const size = getSize();
      const dy = event.deltaMode === 1 ? event.deltaY * 16 : event.deltaY;
      zoomAt(game.camera, size.width, size.height, event.offsetX, event.offsetY, Math.exp(-dy * 0.0011));
    },
    { passive: false },
  );

  const doReset = () => {
    reset(game);
    onReset?.();
  };

  elements.launchButton.addEventListener("click", () => launch(game));
  for (const button of elements.resetButtons) {
    button.addEventListener("click", doReset);
  }
  for (const button of elements.speedButtons) {
    button.addEventListener("click", () => {
      const speed = Number(button.dataset.speed);
      if (isSimSpeed(speed)) setSpeed(game, speed);
    });
  }

  window.addEventListener("keydown", (event) => {
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
    if (event.code === "Space") {
      event.preventDefault();
      launch(game);
    } else if (event.key === "r" || event.key === "R") {
      doReset();
    } else if (event.key === "1" || event.key === "2" || event.key === "4") {
      setSpeed(game, Number(event.key) as SimSpeed);
    }
  });

  function aim(sx: number, sy: number): void {
    const size = getSize();
    const ship = worldToScreen(game.camera, size.width, size.height, game.initial.x, game.initial.y);
    const dx = sx - ship.x;
    const dy = sy - ship.y;
    const pixels = Math.hypot(dx, dy);
    if (pixels < 1) {
      setPlannedDv(game, 0, 0);
      return;
    }
    const dv = pixels * game.level.dvPerPixel;
    setPlannedDv(game, (dx / pixels) * dv, (-dy / pixels) * dv);
  }
}

function isSimSpeed(value: number): value is SimSpeed {
  return (SIM_SPEEDS as readonly number[]).includes(value);
}
