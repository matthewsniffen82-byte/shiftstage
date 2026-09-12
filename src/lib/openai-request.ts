type OpenAIRequestOptions = {
  signal: AbortSignal;
  maxRetries: 0;
};

// The application owns retry policy. Abort the SDK transport at the application
// deadline, including response-body reads after the headers have arrived.
export function withOpenAIRequestDeadline<T>(
  operation: (options: OpenAIRequestOptions) => PromiseLike<T>,
  milliseconds: number,
  message: string,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      reject(new Error(message));
      controller.abort();
    }, milliseconds);
    Promise.resolve()
      .then(() => operation({ signal: controller.signal, maxRetries: 0 }))
      .then(resolve, reject)
      .finally(() => clearTimeout(timer));
  });
}
