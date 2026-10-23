/** One crop dialog at a time; confirmed photos can transfer concurrently. */
export function createPhotoCropQueue() {
  let previous = Promise.resolve();
  return (prepare: () => Promise<File | null>, signal: AbortSignal) => {
    const next = previous.then(() => {
      signal.throwIfAborted();
      return prepare();
    });
    previous = next.then(() => {}, () => {});
    return next;
  };
}
