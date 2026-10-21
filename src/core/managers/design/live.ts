import type { LiveConnection, ServerAccess } from '@core/access/server';
import type { ConflictChoice, ItemConflict, LiveEntry, LiveEvent, LivePayload, LivePresence, LiveWhere } from '@core/contracts';
import { mergeDocuments } from '@core/engines/revision';
import { newId } from '@core/utilities/identity';

/** How a live session is doing, for the editor. */
export interface LiveState {
  readonly status: 'connecting' | 'live' | 'offline';
  /** The others in the document, and where they work. */
  readonly others: readonly LivePresence[];
  /** Opened to view: changes made here stay here. */
  readonly viewOnly: boolean;
  /** What happened to changes made here that did not hold (dropped, or overridden after being away). */
  readonly notice?: string;
}

/** Where a component is edited live: its project on a CADence server, and a sign-in (or view link) there. */
export interface LiveTarget {
  readonly server: string;
  readonly project: string;
  readonly token: string;
  readonly viewOnly?: boolean;
}

/** What the live workflow needs from its session: to run changes on a state and to show a state. */
export interface LiveHost<S extends { readonly document: unknown }> {
  /** A change applied to a state: the next state, or undefined when it does not apply there. */
  run(from: S, payload: LivePayload): Promise<S | undefined>;
  /** Makes a state the session's, saved and shown (others' changes, or the room's document). */
  show(state: S): Promise<void>;
  /** The state now. */
  current(): S;
  /** Runs work after the session's other work, never at the same time. */
  serialized<T>(work: () => Promise<T>): Promise<T>;
  /** The live state changed (who is there, the connection). */
  changed(): void;
  /** Others changed the document: what undo would go back to no longer exists. */
  forgetHistory(): void;
}

/**
 * Live editing of one component through a CADence server's relay (CAD-178, docs/Architecture/Decisions.md#adr-61a).
 * The relay orders every change; each client applies them in that order. Changes made here show at
 * once and wait (`pending`) until they come back from the relay; others' changes are applied to
 * `base` (the document as the room's order makes it) and the waiting ones are run again on top.
 * Back after being away longer than the room keeps entries, the client merges three ways (CAD-176)
 * and sends the result.
 */
export class LiveSession<S extends { readonly document: unknown }> {
  private readonly clientId = newId();
  private readonly connection: LiveConnection;
  private base: S;
  private seq = -1;
  private joined = false;
  private pending: { ref: number; payload: LivePayload; after: S; sent: boolean }[] = [];
  private nextRef = 1;
  private sending = false;
  private status: LiveState['status'] = 'connecting';
  private readonly others = new Map<string, LivePresence>();
  private notice: string | undefined;
  private where: LiveWhere | undefined;
  private presenceTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    server: ServerAccess,
    private readonly target: LiveTarget,
    document: string,
    private readonly host: LiveHost<S>,
  ) {
    this.base = host.current();
    this.connection = server.join(
      { server: target.server, project: target.project, document, token: target.token, clientId: this.clientId },
      {
        event: (event) => void host.serialized(() => this.receive(event)),
        status: (status) => {
          this.status = status;
          host.changed();
          if (status === 'live') void this.flush();
        },
        after: () => this.seq,
      },
    );
  }

  state(): LiveState {
    return { status: this.status, others: [...this.others.values()], viewOnly: !!this.target.viewOnly, ...(this.notice ? { notice: this.notice } : {}) };
  }

  /** A change made here (after it was applied): sent to the others. */
  made(payload: { readonly kind: 'command'; readonly command: unknown } | { readonly kind: 'document'; readonly document: unknown }, after: S): void {
    if (this.target.viewOnly) return;
    const ref = this.nextRef++;
    this.pending.push({ ref, payload: { ...payload, ref }, after, sent: false });
    void this.flush();
  }

  present(where: LiveWhere): void {
    this.where = where;
    if (this.presenceTimer || this.status !== 'live') return;
    this.presenceTimer = setTimeout(() => {
      this.presenceTimer = undefined;
      if (this.where) void this.connection.present(this.where).catch(() => undefined);
    }, 120);
  }

  close(): void {
    clearTimeout(this.presenceTimer);
    this.connection.close();
  }

  /** Someone else started the room at the same moment: join it as it is. */
  private startAgain(): void {
    this.joined = false;
    this.seq = -1;
    this.connection.reconnect();
  }

  /** Sends what waits, in order, one at a time (the relay orders a client's sends as they arrive). */
  private async flush(): Promise<void> {
    if (this.sending) return;
    this.sending = true;
    try {
      for (let next = this.pending.find((p) => !p.sent); next && this.status === 'live'; next = this.pending.find((p) => !p.sent)) {
        await this.connection.send(next.payload);
        next.sent = true;
      }
    } catch {
      // Offline: sent again once connected.
    } finally {
      this.sending = false;
    }
  }

  private async receive(event: LiveEvent): Promise<void> {
    switch (event.kind) {
      case 'welcome':
        return this.welcome(event);
      case 'entry':
        await this.apply([event.entry]);
        return;
      case 'presence':
        if (event.presence.clientId !== this.clientId) this.others.set(event.presence.clientId, event.presence);
        return this.host.changed();
      case 'left':
        this.others.delete(event.clientId);
        return this.host.changed();
      case 'snapshot-wanted':
        await this.connection.snapshot(this.seq, this.base.document).catch(() => false);
        return;
    }
  }

  private async welcome(event: Extract<LiveEvent, { kind: 'welcome' }>): Promise<void> {
    this.others.clear();
    for (const presence of event.present) if (presence.clientId !== this.clientId) this.others.set(presence.clientId, presence);
    const first = !this.joined;
    this.joined = true;
    if (!event.reset) {
      if (first && event.seq === 0 && !event.snapshot) {
        // The first one here: the room starts from this document.
        this.seq = 0;
        this.base = this.host.current();
        this.pending = [];
        if (!this.target.viewOnly && !(await this.connection.snapshot(0, this.base.document).catch(() => false))) this.startAgain();
      } else await this.apply(event.entries);
      return this.host.changed();
    }
    if (!event.snapshot) {
      // The room started again (the server restarted): it starts from this document.
      const now = this.host.current();
      this.seq = event.seq;
      if (!this.target.viewOnly && (await this.connection.snapshot(event.seq, now.document).catch(() => false))) {
        this.base = now;
        this.pending = [];
      } else this.startAgain();
      return this.host.changed();
    }
    // Behind the room's snapshot: the room's document, with what changed here merged in.
    let room = (await this.host.run(this.host.current(), { kind: 'document', ref: 0, document: event.snapshot.document })) ?? this.host.current();
    for (const entry of event.entries) room = (await this.host.run(room, entry.payload)) ?? room;
    this.seq = event.seq;
    const changedHere = !first || this.pending.length > 0;
    const before = this.base;
    this.base = room;
    if (!changedHere || this.target.viewOnly) {
      this.pending = [];
      this.host.forgetHistory();
      await this.host.show(room);
      return this.host.changed();
    }
    const mine = this.host.current().document as Record<string, unknown>;
    const theirs = room.document as Record<string, unknown>;
    const { conflicts } = mergeDocuments(before.document as Record<string, unknown>, mine, theirs);
    const resolutions = Object.fromEntries(conflicts.map((c): [string, ConflictChoice] => [c.path, 'theirs']));
    const merged = mergeDocuments(before.document as Record<string, unknown>, mine, theirs, { resolutions }).document;
    this.notice = overridden(conflicts);
    const result = await this.host.run(room, { kind: 'document', ref: 0, document: merged });
    this.pending = [];
    this.host.forgetHistory();
    if (result) {
      await this.host.show(result);
      this.made({ kind: 'document', document: result.document }, result);
    } else await this.host.show(room);
    this.host.changed();
  }

  /** Entries in the room's order: ours that come back confirm what is shown; others' go under what waits. */
  private async apply(entries: readonly LiveEntry[]): Promise<void> {
    let foreign = false;
    for (const entry of entries) {
      if (entry.seq <= this.seq) continue;
      this.seq = entry.seq;
      const [waiting] = this.pending;
      if (entry.clientId === this.clientId && waiting && waiting.ref === entry.payload.ref) {
        this.base = waiting.after;
        this.pending.shift();
        continue;
      }
      this.base = (await this.host.run(this.base, entry.payload)) ?? this.base;
      foreign = true;
    }
    if (!foreign) return;
    // What waits, again on top of the others' changes; what no longer applies is dropped (everyone drops it).
    let state = this.base;
    const kept: typeof this.pending = [];
    const dropped: string[] = [];
    for (const waiting of this.pending) {
      const next = await this.host.run(state, waiting.payload);
      if (!next) {
        dropped.push(waiting.payload.kind === 'command' ? describe(waiting.payload.command) : 'an undo');
        continue;
      }
      kept.push({ ...waiting, after: next });
      state = next;
    }
    this.pending = kept;
    if (dropped.length) this.notice = `Changed by someone else at the same time, so these changes of yours no longer apply: ${dropped.join(', ')}.`;
    this.host.forgetHistory();
    await this.host.show(state);
    this.host.changed();
  }
}

const describe = (command: unknown) => String((command as { type?: string }).type ?? 'a change').replace(/-/g, ' ');

function overridden(conflicts: readonly ItemConflict[]): string | undefined {
  return conflicts.length ? `Changed here and by others while you were away; theirs was kept for ${conflicts.map((c) => c.label).join(', ')}. Yours is in the history.` : undefined;
}
