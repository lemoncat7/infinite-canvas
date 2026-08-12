export class ComicStreamState {
  receivedBytes = 0;
  progress = 0;
  lastContentAt = Date.now();
  usedModel: string;
  readonly startedAt = Date.now();

  constructor(model: string) { this.usedModel = model; }
  touch() { this.lastContentAt = Date.now(); }
  addContent(content: string) {
    this.touch();
    this.receivedBytes += Buffer.byteLength(content, "utf8");
  }
  advance(progress: number) {
    this.progress = Math.max(this.progress, progress);
    return this.progress;
  }
  idleSeconds() { return Math.floor((Date.now() - this.lastContentAt) / 1000); }
}
