export class ContextMenuController {
  constructor(private readonly element: HTMLElement) {}

  openAt(x: number, y: number, width: number, height: number) {
    this.element.style.left = `${Math.max(10, Math.min(x, innerWidth - width - 10))}px`;
    this.element.style.top = `${Math.max(10, Math.min(y, innerHeight - height - 10))}px`;
    this.element.classList.add("open");
  }

  close() {
    this.element.classList.remove("open");
  }

  contains(target: Node) {
    return this.element.contains(target);
  }
}
