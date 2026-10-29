const blobs = new Map<string, Promise<string>>();

export interface SvgBakeOptions {
  /** Cache key when `prep` changes the document. */
  tag?: string;
  prep?: (doc: Document) => void;
}

/** Fetch an SVG asset and drop the named elements, so a nozzle can be drawn without its plume. */
export function bakedSvgUrl(sourceUrl: string, hideIds: readonly string[] = [], options?: SvgBakeOptions): Promise<string> {
  const key = `${sourceUrl}::${hideIds.join(",")}::${options?.tag ?? ""}`;
  let pending = blobs.get(key);
  if (!pending) {
    pending = fetch(sourceUrl)
      .then((res) => {
        if (!res.ok) throw new Error(`SVG ${res.status}`);
        return res.text();
      })
      .then((text) => {
        const svg = hideIds.length === 0 && !options?.prep ? text : editSvg(text, hideIds, options?.prep);
        return URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
      });
    blobs.set(key, pending);
  }
  return pending;
}

function editSvg(svg: string, ids: readonly string[], prep?: (doc: Document) => void): string {
  const doc = new DOMParser().parseFromString(svg, "image/svg+xml");
  for (const id of ids) doc.getElementById(id)?.remove();
  prep?.(doc);
  return new XMLSerializer().serializeToString(doc.documentElement);
}

const rasters = new Map<string, Promise<HTMLCanvasElement>>();

/** Draw an SVG document string. Not cached: callers animate attributes between draws. */
export function rasterMarkup(markup: string, width: number, height: number): Promise<HTMLCanvasElement> {
  const url = URL.createObjectURL(new Blob([markup], { type: "image/svg+xml" }));
  return drawSvg(url, width, height).finally(() => URL.revokeObjectURL(url));
}

/** Draw an SVG URL into a canvas of the given pixel size. Cached per URL and size. */
export function rasterSvg(url: string, width: number, height: number): Promise<HTMLCanvasElement> {
  const key = `${url}@${width}x${height}`;
  let pending = rasters.get(key);
  if (!pending) {
    pending = drawSvg(url, width, height);
    rasters.set(key, pending);
  }
  return pending;
}

function drawSvg(url: string, width: number, height: number): Promise<HTMLCanvasElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        reject(new Error("no canvas"));
        return;
      }
      ctx.drawImage(image, 0, 0, width, height);
      resolve(canvas);
    };
    image.onerror = () => reject(new Error("svg raster"));
    image.src = url;
  });
}
