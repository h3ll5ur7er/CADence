import type { ServerResponse } from 'node:http';
import type { LiveEntry, LiveEvent, LivePayload, LivePresence, LiveUser, LiveWhere } from '@core/contracts';

/** After this many entries, the room asks for a snapshot, so the entries before it can go. */
const snapshotAfter = 200;
/** Comments on the stream keep proxies from closing it. */
const heartbeat = 15_000;

interface Listener {
  readonly clientId: string;
  readonly user: LiveUser;
  readonly response: ServerResponse;
}

/**
 * One document edited live (CAD-178): the relay numbers what clients send, in the order it arrives,
 * and sends it to everyone in that order; each client applies it to its document. The room keeps the
 * entries since its last snapshot, so those who were away catch up; a client sends a snapshot when
 * asked. Rooms live in memory: after a restart, the first client back starts the room again.
 */
class Room {
  seq = 0;
  snapshot: { readonly seq: number; readonly document: unknown } | undefined;
  entries: LiveEntry[] = [];
  readonly listeners = new Set<Listener>();
  readonly present = new Map<string, LivePresence>();
  /** Each client's last send, so one sent again (its answer was lost) is not taken twice. */
  private readonly last = new Map<string, { readonly ref: number; readonly seq: number }>();
  private asked = false;

  join(listener: Listener, after: number): void {
    // Whoever listens is there, before saying where.
    const presence: LivePresence = { clientId: listener.clientId, user: listener.user, where: this.present.get(listener.clientId)?.where ?? {} };
    this.present.set(listener.clientId, presence);
    this.broadcast({ kind: 'presence', presence });
    this.listeners.add(listener);
    // Behind the snapshot (or ahead of a room that started again): the client reconciles.
    const reset = after > this.seq || (this.snapshot !== undefined && after < this.snapshot.seq);
    const from = reset ? (this.snapshot?.seq ?? 0) : after;
    send(listener.response, {
      kind: 'welcome',
      seq: this.seq,
      ...(reset && this.snapshot ? { snapshot: this.snapshot } : {}),
      entries: this.entries.filter((e) => e.seq > from),
      present: [...this.present.values()],
      ...(reset ? { reset: true } : {}),
    });
  }

  leave(listener: Listener): void {
    this.listeners.delete(listener);
    if ([...this.listeners].some((l) => l.clientId === listener.clientId)) return;
    if (this.present.delete(listener.clientId)) this.broadcast({ kind: 'left', clientId: listener.clientId });
  }

  append(clientId: string, user: LiveUser, payload: LivePayload): number {
    const last = this.last.get(clientId);
    if (last && payload.ref <= last.ref) return last.seq;
    this.last.set(clientId, { ref: payload.ref, seq: this.seq + 1 });
    const entry: LiveEntry = { seq: ++this.seq, clientId, user, payload };
    this.entries.push(entry);
    this.broadcast({ kind: 'entry', entry });
    if (!this.asked && this.entries.length > snapshotAfter) {
      this.asked = true;
      this.broadcast({ kind: 'snapshot-wanted', seq: this.seq });
    }
    return entry.seq;
  }

  /** A client's document as of `seq`; the entries up to it are no longer needed. */
  keepSnapshot(seq: number, document: unknown): boolean {
    if (seq > this.seq || (this.snapshot && seq <= this.snapshot.seq)) return false;
    this.snapshot = { seq, document };
    this.entries = this.entries.filter((e) => e.seq > seq);
    this.asked = false;
    return true;
  }

  presence(clientId: string, user: LiveUser, where: LiveWhere): void {
    const presence: LivePresence = { clientId, user, where };
    this.present.set(clientId, presence);
    this.broadcast({ kind: 'presence', presence });
  }

  private broadcast(event: LiveEvent): void {
    for (const listener of this.listeners) send(listener.response, event);
  }
}

/** Server-sent events: one JSON event per message; none to a listener whose connection has just closed. */
function send(response: ServerResponse, event: LiveEvent): void {
  if (response.writableEnded || response.destroyed) return;
  response.write(`data: ${JSON.stringify(event)}\n\n`);
}

export class Relay {
  private readonly rooms = new Map<string, Room>();

  private room(project: string, document: string): Room {
    const key = `${project}/${document}`;
    let room = this.rooms.get(key);
    if (!room) this.rooms.set(key, (room = new Room()));
    return room;
  }

  /** Streams a room's events to a client, starting with what it missed after `after`. */
  listen(project: string, document: string, clientId: string, user: LiveUser, after: number, response: ServerResponse): void {
    response.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    const room = this.room(project, document);
    const listener: Listener = { clientId, user, response };
    room.join(listener, after);
    const beat = setInterval(() => response.write(': still here\n\n'), heartbeat);
    response.on('close', () => {
      clearInterval(beat);
      room.leave(listener);
    });
  }

  append(project: string, document: string, clientId: string, user: LiveUser, payload: LivePayload): number {
    return this.room(project, document).append(clientId, user, payload);
  }

  keepSnapshot(project: string, document: string, seq: number, snapshot: unknown): boolean {
    return this.room(project, document).keepSnapshot(seq, snapshot);
  }

  presence(project: string, document: string, clientId: string, user: LiveUser, where: LiveWhere): void {
    this.room(project, document).presence(clientId, user, where);
  }

  close(): void {
    for (const room of this.rooms.values()) for (const listener of room.listeners) listener.response.end();
    this.rooms.clear();
  }
}
