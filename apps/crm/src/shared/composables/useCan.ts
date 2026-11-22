import type { Capability } from '@auto-crm/core'
import { can } from '@auto-crm/core'

import { useSessionStore } from '@/shared/stores/session.store'

// Whether the signed-in user's role allows a capability, for showing or
// hiding actions. The services and the server check again.
export const useCan = () => {
  const session = useSessionStore()
  return (capability: Capability): boolean => session.role !== null && can(session.role, capability)
}
