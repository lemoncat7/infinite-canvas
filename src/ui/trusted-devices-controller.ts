import { apiFetch } from '../services/api';

type Device = { id: string; name: string; current: boolean; lastUsedAt: string };
const INITIAL_COUNT = 3;

export class TrustedDevicesController {
  private devices: Device[] = [];
  private visibleCount = INITIAL_COUNT;
  private version = 0;
  private busy = false;
  private readonly list: HTMLElement;
  private readonly controls = document.createElement('div');
  private readonly count = document.createElement('span');
  private readonly status = document.createElement('output');
  private readonly revokeOthers: HTMLButtonElement;

  constructor(private readonly section: HTMLElement, private readonly userId: () => string | undefined) {
    this.list = section.querySelector('[data-trusted-devices]')!;
    this.list.id = 'trusted-device-list';
    this.controls.className = 'device-list-controls';
    this.status.className = 'device-list-status';
    this.status.setAttribute('aria-live', 'polite');
    section.querySelector('small')!.append(this.count);
    section.append(this.controls, this.status);
    this.revokeOthers = section.querySelector('[data-revoke-other-devices]')!;
    this.revokeOthers.addEventListener('click', () => void this.revoke());
  }

  reset() {
    this.version++; this.devices = []; this.visibleCount = INITIAL_COUNT;
    this.list.replaceChildren(); this.controls.replaceChildren(); this.count.textContent = ''; this.status.textContent = '';
  }

  async load() {
    const userId = this.userId(), version = ++this.version;
    if (!userId) return this.reset();
    try {
      const response = await apiFetch('/api/auth/devices', { signal: AbortSignal.timeout(15000) });
      const devices = await response.json() as Device[];
      if (!response.ok || !Array.isArray(devices)) throw new Error();
      if (version !== this.version || userId !== this.userId()) return;
      if (this.status.textContent === '设备读取失败，请重试') this.status.textContent = '';
      this.devices = devices.sort((a, b) => Number(b.current) - Number(a.current) || Date.parse(b.lastUsedAt) - Date.parse(a.lastUsedAt));
      this.render();
    } catch {
      if (version !== this.version || userId !== this.userId()) return;
      this.status.textContent = '设备读取失败，请重试';
      this.controls.replaceChildren(this.button('重试', () => void this.load()));
    }
  }

  private button(text: string, action: () => void) {
    const button = document.createElement('button'); button.type = 'button'; button.textContent = text;
    button.addEventListener('click', action); return button;
  }

  private render() {
    this.count.textContent = ` · ${this.devices.length}`;
    this.list.replaceChildren(...this.devices.slice(0, this.visibleCount).map(device => {
      const row = document.createElement('div'), text = document.createElement('span'), name = document.createElement('b'), activity = document.createElement('small');
      name.textContent = device.name;
      activity.textContent = device.current ? '当前设备' : this.relativeTime(device.lastUsedAt);
      const date = new Date(device.lastUsedAt);
      if (Number.isFinite(date.getTime())) activity.title = date.toLocaleString();
      text.append(name, activity); row.append(text);
      if (!device.current) {
        const button = this.button('退出', () => void this.revoke(device.id));
        button.setAttribute('aria-label', `退出 ${device.name}`); button.disabled = this.busy; row.append(button);
      }
      return row;
    }));
    if (!this.devices.length) this.list.textContent = '暂无登录设备';
    this.controls.replaceChildren();
    const remaining = this.devices.length - this.visibleCount;
    if (remaining > 0) {
      const more = this.button(`显示更多（还有 ${remaining} 台）`, () => { this.visibleCount += 5; this.render(); });
      more.setAttribute('aria-controls', this.list.id); this.controls.append(more);
    }
    if (this.visibleCount > INITIAL_COUNT) this.controls.append(this.button('收起', () => { this.visibleCount = INITIAL_COUNT; this.render(); this.list.scrollTop = 0; }));
    this.revokeOthers.disabled = this.busy || !this.devices.some(d => d.current) || !this.devices.some(d => !d.current);
  }

  private async revoke(id?: string) {
    if (this.busy) return;
    const userId = this.userId(); if (!userId) return;
    this.busy = true; this.render(); this.status.textContent = '正在退出…';
    try {
      const response = await apiFetch(id ? `/api/auth/devices/${encodeURIComponent(id)}` : '/api/auth/devices/revoke-others', { method: id ? 'DELETE' : 'POST', signal: AbortSignal.timeout(15000) });
      if (!response.ok) throw new Error();
      if (userId !== this.userId()) return;
      this.status.textContent = id ? '设备已退出' : '其他设备已退出';
      await this.load();
    } catch { if (userId === this.userId()) this.status.textContent = '退出失败，请重试'; }
    finally { this.busy = false; if (userId === this.userId()) this.render(); }
  }

  private relativeTime(value: string) {
    const elapsed = Date.now() - Date.parse(value);
    if (!Number.isFinite(elapsed)) return '活跃时间未知';
    const minutes = Math.max(0, Math.floor(elapsed / 60000));
    return minutes < 1 ? '刚刚活跃' : minutes < 60 ? `${minutes} 分钟前` : minutes < 1440 ? `${Math.floor(minutes / 60)} 小时前` : `${Math.floor(minutes / 1440)} 天前`;
  }
}
