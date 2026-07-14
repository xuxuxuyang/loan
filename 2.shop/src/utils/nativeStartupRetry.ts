export interface NativeStartupRetryOptions {
  native: boolean
  retryDelaysMs: readonly number[]
}

function wait(delayMs: number) {
  return new Promise<void>(resolve => setTimeout(resolve, Math.max(0, delayMs)))
}

export async function withNativeStartupRetry<T>(
  operation: () => Promise<T>,
  options: NativeStartupRetryOptions,
): Promise<T> {
  if (!options.native) {
    return operation()
  }

  for (let attempt = 0; ; attempt += 1) {
    try {
      return await operation()
    }
    catch (error) {
      const retryDelay = options.retryDelaysMs[attempt]
      if (retryDelay === undefined) {
        throw error
      }
      await wait(retryDelay)
    }
  }
}
