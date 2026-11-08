import { EventEmitter } from 'node:events';

export type StreamEventName = 'purchase.updated' | 'approval.updated' | 'evidence.appended' | 'dispute.updated' | 'mandate.updated';

export interface StreamEvent {
  event: StreamEventName;
  data: unknown;
}

/** In-process pub/sub feeding GET /api/stream. */
export class EventBus {
  private emitter = new EventEmitter();

  constructor() {
    this.emitter.setMaxListeners(0);
  }

  publish(event: StreamEventName, data: unknown): void {
    this.emitter.emit('event', { event, data } satisfies StreamEvent);
  }

  subscribe(fn: (e: StreamEvent) => void): () => void {
    this.emitter.on('event', fn);
    return () => this.emitter.off('event', fn);
  }
}
