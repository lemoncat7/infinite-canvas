import { createHash, randomUUID } from 'node:crypto';
import { ApiFailure } from './gateway.js';
import type { ImageUploadInput } from './upload-tools.js';

export const CHUNK_BYTES = 1024 * 1024;
export const MAX_UPLOAD_BYTES = 100 * CHUNK_BYTES;
const TTL_MS = 30 * 60 * 1000;
const RESERVED_LIMIT = 128 * CHUNK_BYTES;
export type UploadManifest = Omit<ImageUploadInput, 'data'> & { size: number; sha256: string };
type Session = {
  id: string; owner: string; requestId: string; manifest: UploadManifest;
  expires: number; chunks: Map<number, Buffer>; state: 'receiving' | 'completing' | 'complete' | 'uncertain' | 'canceled';
  outcome?: unknown; running?: Promise<unknown>;
};

/** Per-application, bounded transient transport state, never another asset store.
 * Restart discards unfinished uploads. Only the authenticated assets API commits files.
 */
export class UploadSessions {
  private sessions = new Map<string, Session>();
  private completing = false;
  private timer = setInterval(() => this.sweep(), 60_000).unref();
  constructor(private readonly now = () => Date.now()) {}

  close() { clearInterval(this.timer); this.sessions.clear(); }
  private sweep() {
    for (const [id, session] of this.sessions)
      if (session.expires <= this.now() && session.state !== 'completing') this.sessions.delete(id);
  }
  private get(owner: string, id: string) {
    this.sweep();
    const session = this.sessions.get(id);
    if (!session || session.owner !== owner) throw new ApiFailure(404, 'Upload expired, unavailable after restart, or not owned by this credential');
    return session;
  }
  private summary(session: Session) {
    return { uploadId: session.id, state: session.state, expiresAt: new Date(session.expires).toISOString(),
      chunkBytes: CHUNK_BYTES, chunkCount: Math.ceil(session.manifest.size / CHUNK_BYTES),
      receivedChunks: [...session.chunks.keys()].sort((a, b) => a - b),
      ...(session.outcome ? { result: session.outcome } : {}) };
  }
  begin(owner: string, requestId: string, manifest: UploadManifest) {
    this.sweep();
    const all = [...this.sessions.values()];
    const existing = all.find(s => s.owner === owner && s.requestId === requestId);
    if (existing) {
      if (JSON.stringify(existing.manifest) !== JSON.stringify(manifest)) throw new ApiFailure(409, 'requestId already used for different upload metadata');
      return this.summary(existing);
    }
    const active = all.filter(s => s.state === 'receiving' || s.state === 'completing');
    if (all.length >= 64 || all.filter(s => s.owner === owner).length >= 16
      || active.filter(s => s.owner === owner).length >= 2
      || active.reduce((sum, s) => sum + s.manifest.size, 0) + manifest.size > RESERVED_LIMIT)
      throw new ApiFailure(429, 'Upload capacity busy; complete/cancel existing uploads or retry later');
    const session: Session = { id: randomUUID(), owner, requestId, manifest, expires: this.now() + TTL_MS, chunks: new Map(), state: 'receiving' };
    this.sessions.set(session.id, session);
    return this.summary(session);
  }
  status(owner: string, id: string) { return this.summary(this.get(owner, id)); }
  write(owner: string, id: string, index: number, data: string) {
    const session = this.get(owner, id);
    if (session.state !== 'receiving') throw new ApiFailure(409, 'Upload is not receiving chunks; inspect status');
    const count = Math.ceil(session.manifest.size / CHUNK_BYTES);
    if (!Number.isInteger(index) || index < 0 || index >= count) throw new ApiFailure(400, 'Invalid chunk index');
    const bytes = Buffer.from(data, 'base64');
    const expected = Math.min(CHUNK_BYTES, session.manifest.size - index * CHUNK_BYTES);
    if (bytes.length !== expected || bytes.toString('base64') !== data) throw new ApiFailure(400, 'Chunk must be canonical base64 with the exact expected byte length');
    const previous = session.chunks.get(index);
    if (previous && !previous.equals(bytes)) throw new ApiFailure(409, 'Different content already exists at this chunk index');
    if (!previous) session.chunks.set(index, bytes);
    return this.summary(session);
  }
  cancel(owner: string, id: string) {
    const session = this.get(owner, id);
    if (session.state === 'completing') throw new ApiFailure(409, 'Completion in progress; cannot cancel');
    if (session.state === 'complete' || session.state === 'uncertain') throw new ApiFailure(409, 'Asset may already exist; cancellation never deletes assets');
    session.chunks.clear(); session.state = 'canceled';
    return this.summary(session);
  }
  async complete(owner: string, id: string, commit: (input: ImageUploadInput) => Promise<unknown>) {
    const session = this.get(owner, id);
    if (session.state === 'complete') return session.outcome;
    if (session.running) return session.running;
    if (session.state !== 'receiving') throw new ApiFailure(409, 'Upload cannot be completed. Inspect assets before starting another upload');
    if (this.completing) throw new ApiFailure(429, 'Another image is being assembled; retry this uploadId');
    const count = Math.ceil(session.manifest.size / CHUNK_BYTES);
    if (session.chunks.size !== count) throw new ApiFailure(409, 'Missing chunks; call status and upload missing indices');
    const chunks = Array.from({ length: count }, (_, i) => session.chunks.get(i)!);
    const hash = createHash('sha256');
    for (const chunk of chunks) hash.update(chunk);
    if (hash.digest('hex') !== session.manifest.sha256) throw new ApiFailure(422, 'File SHA-256 mismatch; cancel and restart with correct file bytes');
    session.state = 'completing'; this.completing = true;
    session.running = (async () => {
      try {
        const { size: _size, sha256: _sha, ...input } = session.manifest;
        session.outcome = await commit({ ...input, data: Buffer.concat(chunks).toString('base64') });
        session.state = 'complete';
        return session.outcome;
      } catch (error) {
        // Never repeat a possibly committed upload after an ambiguous API failure.
        session.state = 'uncertain';
        throw new ApiFailure(error instanceof ApiFailure && error.status < 500 ? error.status : 409,
          'Upload did not complete reliably. Inspect project assets before starting another upload; this uploadId will not commit again');
      } finally {
        session.chunks.clear(); session.running = undefined; this.completing = false;
        session.expires = this.now() + TTL_MS;
      }
    })();
    return session.running;
  }
}
