type Handler<T> = (payload: T) => void;

/** Minimal typed event emitter. Keys of E are event names, values are payload types. */
export class Emitter<E extends object> {
  private handlers = new Map<keyof E, Handler<never>[]>();

  on<K extends keyof E>(name: K, fn: Handler<E[K]>): () => void {
    const list = this.handlers.get(name) ?? [];
    list.push(fn as Handler<never>);
    this.handlers.set(name, list);
    return () => {
      const cur = this.handlers.get(name);
      if (cur)
        this.handlers.set(
          name,
          cur.filter((h) => h !== (fn as Handler<never>)),
        );
    };
  }

  emit<K extends keyof E>(name: K, payload: E[K]): void {
    const list = this.handlers.get(name);
    if (!list) return;
    for (const h of list) (h as Handler<E[K]>)(payload);
  }
}
