export type AdminLoginFlowSnapshot = {
  revision: number
  challengeId: string
}

type CurrentFlow = () => AdminLoginFlowSnapshot

export function isAdminLoginFlowCurrent(
  snapshot: AdminLoginFlowSnapshot,
  current: AdminLoginFlowSnapshot,
): boolean {
  return snapshot.revision === current.revision
    && snapshot.challengeId === current.challengeId
}

export async function settleAdminLoginChallenge<T>(options: {
  snapshot: AdminLoginFlowSnapshot
  request: () => Promise<T>
  current: CurrentFlow
  accept: (value: T) => void | Promise<void>
}): Promise<'accepted' | 'stale'> {
  const value = await options.request()
  if (!isAdminLoginFlowCurrent(options.snapshot, options.current())) {
    return 'stale'
  }
  await options.accept(value)
  return 'accepted'
}

export async function settleAdminLoginVerification<T extends { token: string }>(options: {
  snapshot: AdminLoginFlowSnapshot
  request: () => Promise<T>
  current: CurrentFlow
  accept: (value: T) => void | Promise<void>
  revoke: (token: string) => void | Promise<void>
}): Promise<'accepted' | 'stale'> {
  const value = await options.request()
  if (!isAdminLoginFlowCurrent(options.snapshot, options.current())) {
    try {
      await options.revoke(value.token)
    }
    catch {
      // The stale server session is still bounded by its fixed expiry if revocation is unavailable.
    }
    return 'stale'
  }
  await options.accept(value)
  return 'accepted'
}
