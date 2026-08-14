export class PixiEditorCache {
  readonly elements = new Map<number, HTMLElement>();

  constructor(
    private readonly clearState: (id: number) => void,
    private readonly capacity = 2,
  ) {}

  detach(id: number, element: HTMLElement) {
    this.elements.delete(id);
    this.elements.set(id, element);
    element.remove();
    while (this.elements.size > this.capacity) {
      const oldestId = this.elements.keys().next().value as number | undefined;
      if (oldestId === undefined) break;
      this.elements.delete(oldestId);
      this.clearState(oldestId);
    }
  }

  clear() {
    this.elements.clear();
  }
}
