import type { EventMap } from '../../domain/entities/types.js';

/** Small typed Observer implementation used by the modem and HTTP event stream. */
export class EventBus<Events extends object = EventMap> {
  #listeners = new Map<keyof Events, Set<(value: Events[keyof Events]) => void>>();
  on<K extends keyof Events>(event: K, listener: (value: Events[K]) => void): () => void {
    const listeners = this.#listeners.get(event) || new Set();
    listeners.add(listener as (value: Events[keyof Events]) => void);
    this.#listeners.set(event, listeners);
    return () => listeners.delete(listener as (value: Events[keyof Events]) => void);
  }
  emit<K extends keyof Events>(event: K, value: Events[K]): void {
    for (const listener of this.#listeners.get(event) || []) listener(value);
  }
}
