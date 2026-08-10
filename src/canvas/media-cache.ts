export class MediaLruCache<Value> {
  private readonly values = new Map<string, Value>();

  constructor(
    private readonly maxEntries: number,
    private readonly release: (key: string, value: Value) => void,
    private readonly protectedKey: (key: string) => boolean = () => false,
  ) {}

  get size() {
    return this.values.size;
  }

  get(key: string) {
    const value = this.values.get(key);
    if (value === undefined) return undefined;
    this.values.delete(key);
    this.values.set(key, value);
    return value;
  }

  set(key: string, value: Value) {
    const previous = this.values.get(key);
    this.values.delete(key);
    if (previous !== undefined && previous !== value)
      this.release(key, previous);
    this.values.set(key, value);
    this.trim();
    return this;
  }

  delete(key: string) {
    const value = this.values.get(key);
    if (value === undefined) return false;
    this.values.delete(key);
    this.release(key, value);
    return true;
  }

  clear() {
    this.values.forEach((value, key) => this.release(key, value));
    this.values.clear();
  }

  forEach(callback: (value: Value, key: string) => void) {
    this.values.forEach(callback);
  }

  keys() {
    return this.values.keys();
  }

  trim() {
    while (this.values.size > this.maxEntries) {
      let oldest: string | undefined;
      for (const key of this.values.keys())
        if (!this.protectedKey(key)) {
          oldest = key;
          break;
        }
      if (!oldest) return;
      this.delete(oldest);
    }
  }
}
