import { startPolling } from '../../../../client/poll.js'

/** Loader inventory backs the MCP list before the host runtime projection arrives. */
export function useInventory(React, inventory) {
  const { useState, useEffect } = React
  const [inventoryRows, setInventoryRows] = useState([])
  useEffect(() => {
    const list = inventory?.list
    if (typeof list !== 'function') return undefined
    const poll = startPolling(async (signal) => {
      const payload = await list()
      if (signal.aborted) return
      const entries = payload?.value?.entries ?? payload?.entries ?? []
      setInventoryRows((Array.isArray(entries) ? entries : []).map((row) => ({
        entryId: String(row?.entryId ?? row?.id ?? '?'),
        moduleName: String(row?.moduleName ?? row?.name ?? '?'),
        enabled: row?.enabled !== false,
        fiberPhase: String(row?.fiberPhase ?? ''),
      })))
    }, { intervalMs: 10000, onError: () => {} })
    return () => poll.stop()
  }, [inventory])
  return inventoryRows
}
