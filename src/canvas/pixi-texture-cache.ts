import { Texture } from "pixi.js";

type TextureEntry = {
  texture?: Texture;
  loading?: Promise<Texture>;
  references: number;
  usedAt: number;
};

export class PixiTextureCache {
  private readonly entries = new Map<string, TextureEntry>();

  constructor(private readonly maxIdleEntries: number) {}

  acquire(url: string) {
    let entry = this.entries.get(url);
    if (!entry) {
      entry = { references: 0, usedAt: performance.now() };
      this.entries.set(url, entry);
    }
    entry.references++;
    entry.usedAt = performance.now();
    if (entry.texture) return Promise.resolve(entry.texture);
    if (!entry.loading) {
      entry.loading = this.load(url)
        .then((texture) => {
          const live = this.entries.get(url);
          if (!live) {
            texture.destroy(true);
            throw new Error("Texture request was released");
          }
          live.texture = texture;
          live.loading = undefined;
          // A card can leave the viewport while its image is decoding. Trim
          // again after resolution so those now-idle textures cannot build up.
          this.trim();
          return texture;
        })
        .catch((error) => {
          const live = this.entries.get(url);
          if (live) live.loading = undefined;
          throw error;
        });
    }
    return entry.loading;
  }

  release(url: string) {
    const entry = this.entries.get(url);
    if (!entry) return;
    entry.references = Math.max(0, entry.references - 1);
    entry.usedAt = performance.now();
    this.trim();
  }

  clear() {
    for (const entry of this.entries.values()) {
      if (entry.texture) entry.texture.destroy(true);
      else entry.loading?.catch(() => undefined);
    }
    this.entries.clear();
  }

  private trim() {
    const idle = [...this.entries]
      .filter(([, entry]) => entry.references === 0 && !entry.loading)
      .sort((left, right) => left[1].usedAt - right[1].usedAt);
    while (idle.length > this.maxIdleEntries) {
      const [url, entry] = idle.shift()!;
      this.entries.delete(url);
      if (entry.texture) entry.texture.destroy(true);
    }
  }

  private async load(url: string) {
    // Asset thumbnail routes intentionally have no file extension. Pixi's
    // generic Assets loader therefore cannot reliably select an image parser
    // and silently leaves an idle card in its textual fallback. Fetching the
    // authenticated response ourselves also guarantees session cookies are
    // included before handing a decoded bitmap to the GPU.
    const response = await fetch(url, {
      credentials: "same-origin",
      cache: "force-cache",
    });
    if (!response.ok)
      throw new Error(`Thumbnail request failed (${response.status})`);
    const blob = await response.blob();
    if (typeof createImageBitmap === "function")
      return Texture.from(await createImageBitmap(blob));
    const objectUrl = URL.createObjectURL(blob);
    try {
      const image = await new Promise<HTMLImageElement>((resolve, reject) => {
        const element = new Image();
        element.onload = () => resolve(element);
        element.onerror = () => reject(new Error("Thumbnail decode failed"));
        element.src = objectUrl;
      });
      return Texture.from(image);
    } finally {
      URL.revokeObjectURL(objectUrl);
    }
  }
}
