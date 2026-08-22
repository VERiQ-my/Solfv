/** The persisted audit history, loaded once per mount.
 *
 *  Shared because two screens are honest views of the same table: the Dashboard
 *  aggregates it into portfolio-level KPIs, and Privacy shows it row by row as
 *  the audit log. Fetching it twice with two shapes would let them disagree.
 */

import { useCallback, useEffect, useState } from 'react'
import { api } from './api'
import type { HistoryResult } from '../types'

const RETRY_DELAYS_MS = [0, 750, 2_000]

export function useHistory(limit = 100) {
  const [result, setResult] = useState<HistoryResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    let lastError: unknown = null

    try {
      for (const [attempt, delay] of RETRY_DELAYS_MS.entries()) {
        if (delay) await new Promise(resolve => window.setTimeout(resolve, delay))
        try {
          const next = await api.history(limit)
          if (next.available || attempt === RETRY_DELAYS_MS.length - 1) {
            setResult(next)
            return
          }
          lastError = next.reason || 'The audit history is temporarily unavailable.'
        } catch (caught) {
          lastError = caught
        }
      }
    } finally {
      setLoading(false)
    }

    setError(lastError instanceof Error ? lastError.message : String(lastError))
  }, [limit])

  useEffect(() => { void load() }, [load])

  return {
    rows: result?.rows ?? [],
    available: result?.available ?? false,
    reason: result?.reason ?? error,
    loading,
    reload: load,
  }
}
