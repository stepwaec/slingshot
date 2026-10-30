/** True when this browser can create a WebGL2 context. */
export function webGL2Available(): boolean {
  try {
    const probe = document.createElement("canvas");
    const gl = probe.getContext("webgl2");
    if (gl) {
      const lose = gl.getExtension("WEBGL_lose_context");
      lose?.loseContext();
    }
    return gl !== null;
  } catch {
    return false;
  }
}

/** Replaces the playfield with a plain notice. The design folder is not involved. */
export function showNeedsWebGL2(root: HTMLElement): void {
  const note = document.createElement("p");
  note.id = "webgl2-needed";
  note.textContent = "needs WebGL2";
  root.replaceChildren(note);
}
