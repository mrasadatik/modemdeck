/**
 * Race a promise against a timer so wedged OS handles (USB enumeration,
 * dead COM ports) can never hang discovery or HTTP handlers forever.
 * The timer is unref'd so tests and shutdown are unaffected.
 */
export function withTimeout<T>(work: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const guard = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
    timer.unref?.();
  });
  return Promise.race([work.finally(() => clearTimeout(timer)), guard]);
}
