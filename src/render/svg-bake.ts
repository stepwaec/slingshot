const blobs = new Map<string, Promise<string>>();

/** Fetch an SVG asset and drop the named elements, so a nozzle can be drawn without its plume. */
export function bakedSvgUrl(sourceUrl: string, hideIds: readonly string[] = []): Promise<string> {
  const key = `${sourceUrl}::${hideIds.join(",")}`;
  let pending = blobs.get(key);
  if (!pending) {
    pending = fetch(sourceUrl)
      .then((res) => {
        if (!res.ok) throw new Error(`SVG ${res.status}`);
        return res.text();
      })
      .then((text) => {
        const svg = hideIds.length === 0 ? text : stripIds(text, hideIds);
        return URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
      });
    blobs.set(key, pending);
  }
  return pending;
}

function stripIds(svg: string, ids: readonly string[]): string {
  const doc = new DOMParser().parseFromString(svg, "image/svg+xml");
  for (const id of ids) doc.getElementById(id)?.remove();
  return new XMLSerializer().serializeToString(doc.documentElement);
}

const rasters = new Map<string, Promise<HTMLCanvasElement>>();

/** Draw an SVG URL into a canvas of the given pixel size. Cached per URL and size. */
export function rasterSvg(url: string, width: number, height: number): Promise<HTMLCanvasElement> {
  const key = `${url}@${width}x${height}`;
  let pending = rasters.get(key);
  if (!pending) {
    pending = new Promise((resolve, reject) => {
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
    rasters.set(key, pending);
  }
  return pending;
}
