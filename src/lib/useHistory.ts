/** The persisted audit history, loaded once per mount.
 *
 *  Shared because two screens are honest views of the same table: the Dashboard
 *  aggregates it into portfolio-level KPIs, and Privacy shows it row by row as
 *  the audit log. Fetching it twice with two shapes would let them disagree.
 */

import { useCallback, useEffect, useState } from 'react'
import { api } from './api'
import type { HistoryResult } from '../types'

export function useHistory(limit = 100) {
  const [result, setResult] = useState<HistoryResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setResult(await api.history(limit))
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      setLoading(false)
    }
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
