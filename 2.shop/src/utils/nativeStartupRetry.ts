export interface NativeStartupRetryOptions {
  native: boolean
  retryDelaysMs: readonly number[]
}

export const NATIVE_STARTUP_RETRY_DELAYS_MS = [1000, 2000, 3000, 5000, 8000, 12000, 18000] as const

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
