import { Assets, Texture } from "pixi.js";

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
      entry.loading = Assets.load<Texture>(url)
        .then((texture) => {
          const live = this.entries.get(url);
          if (!live) {
            texture.destroy(true);
            throw new Error("Texture request was released");
          }
          live.texture = texture;
          live.loading = undefined;
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
    for (const [url, entry] of this.entries) {
      if (entry.texture) void Assets.unload(url);
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
      if (entry.texture) void Assets.unload(url);
    }
  }
}
