import { useEffect, useState, useCallback } from 'react'
import api from '../api.js'

const SLOT_LABELS = {
  top_left: 'Top Left', top_right: 'Top Right',
  bottom_left: 'Bottom Left', bottom_right: 'Bottom Right', '': '—',
}

function fmtDwell(sec) {
  if (!sec) return '—'
  const m = Math.floor(sec / 60), s = Math.round(sec % 60)
  return m ? `${m}m ${s}s` : `${s}s`
}

function todayISO(offsetDays = 0) {
  const d = new Date()
  d.setDate(d.getDate() + offsetDays)
  return d.toISOString().slice(0, 10)
}

export default function ImpressionsPage() {
  const [zones, setZones] = useState([])
  const [zone, setZone] = useState('')
  const [from, setFrom] = useState(todayISO(-6))
  const [to, setTo] = useState(todayISO(0))
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [toast, setToast] = useState(null)

  function showToast(message, type = 'error') {
    setToast({ message, type })
    setTimeout(() => setToast(null), 3500)
  }

  // Load zone list (from live station API).
  useEffect(() => {
    api.get('/targets/?type=zone')
      .then(({ data }) => {
        setZones(data)
        if (data.length) setZone(data[0].id)
      })
      .catch(() => showToast('Failed to load zones.'))
  }, [])

  const fetchImpressions = useCallback(async () => {
    if (!zone) return
    setLoading(true)
    try {
      const { data } = await api.get('/impressions/', { params: { zone, from, to } })
      setData(data)
    } catch {
      showToast('Failed to load impressions.')
      setData(null)
    } finally {
      setLoading(false)
    }
  }, [zone, from, to])

  // Auto-load when a zone is first selected.
  useEffect(() => { if (zone) fetchImpressions() }, [zone]) // eslint-disable-line

  function exportCSV() {
    if (!data?.ads?.length) return
    const head = ['Ad', 'Type', 'Slot', 'Stations', 'Swaps', 'Avg dwell (s)', 'Impressions']
    const rows = data.ads.map((a) => [
      a.title, a.media_type, SLOT_LABELS[a.slot] || a.slot,
      a.stations, a.swaps, a.avg_dwell_sec, a.impressions,
    ])
    const csv = [head, ...rows].map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n')
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }))
    const a = document.createElement('a')
    a.href = url; a.download = `impressions_${zone}_${from}_to_${to}.csv`; a.click()
    URL.revokeObjectURL(url)
  }

  const totals = data?.totals
  const range = data?.range

  return (
    <div className="flex-1 p-8">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-800">Ad Impressions</h1>
        <p className="text-sm text-gray-500 mt-0.5">
          Estimated from real swaps · captive-screen model (no visibility guess)
        </p>
      </div>

      {/* Controls */}
      <div className="bg-white border border-gray-200 rounded-2xl p-4 mb-6 flex flex-wrap items-end gap-3 shadow-sm">
        <div>
          <label className="block text-xs font-semibold text-gray-500 mb-1">Zone</label>
          <select
            value={zone}
            onChange={(e) => setZone(e.target.value)}
            className="border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]/30 min-w-[180px]"
          >
            {zones.length === 0 && <option value="">Loading…</option>}
            {zones.map((z) => <option key={z.id} value={z.id}>{z.name}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-semibold text-gray-500 mb-1">From</label>
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)}
            className="border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]/30" />
        </div>
        <div>
          <label className="block text-xs font-semibold text-gray-500 mb-1">To</label>
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)}
            className="border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]/30" />
        </div>
        <button onClick={fetchImpressions}
          className="px-5 py-2 rounded-xl bg-[#1e3a5f] text-white text-sm font-semibold hover:bg-[#162d4a] transition-colors">
          Apply
        </button>
        <button onClick={exportCSV} disabled={!data?.ads?.length}
          className="px-4 py-2 rounded-xl border-2 border-[#1e3a5f] text-[#1e3a5f] text-sm font-semibold hover:bg-[#1e3a5f]/5 transition-colors disabled:opacity-40">
          Export CSV
        </button>
      </div>

      {/* Summary cards */}
      {totals && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
          <StatCard label="Total impressions" value={totals.impressions} accent="#d9a52b" />
          <StatCard label="Swaps in zone" value={totals.swaps} />
          <StatCard label="Avg time at screen" value={fmtDwell(totals.avg_dwell_sec)} />
          <StatCard label="Active stations" value={range?.station_count ?? totals.stations_with_swaps} />
        </div>
      )}

      {/* Per-ad table */}
      {loading ? (
        <div className="flex justify-center py-20">
          <div className="w-10 h-10 border-4 border-[#1e3a5f] border-t-transparent rounded-full animate-spin" />
        </div>
      ) : !data ? null : data.ads.length === 0 ? (
        <div className="text-center py-16 text-gray-400">
          <p className="font-semibold text-gray-500">No impressions for this zone & period</p>
          <p className="text-sm mt-1">No live ad targets {zones.find((z) => z.id === zone)?.name || 'this zone'}, or no swaps in range.</p>
        </div>
      ) : (
        <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden shadow-sm">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-500 text-xs uppercase tracking-wider">
              <tr>
                <th className="text-left px-4 py-3 font-semibold">Ad</th>
                <th className="text-left px-4 py-3 font-semibold">Slot</th>
                <th className="text-right px-4 py-3 font-semibold">Stations</th>
                <th className="text-right px-4 py-3 font-semibold">Swaps</th>
                <th className="text-right px-4 py-3 font-semibold">Avg dwell</th>
                <th className="text-right px-4 py-3 font-semibold">Impressions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {data.ads.map((a) => (
                <tr key={a.ad_id} className="hover:bg-gray-50">
                  <td className="px-4 py-3">
                    <div className="font-semibold text-gray-700 truncate max-w-xs">{a.title}</div>
                    <div className="text-xs text-gray-400">{a.media_type} · {a.duration_seconds}s</div>
                  </td>
                  <td className="px-4 py-3 text-gray-600">{SLOT_LABELS[a.slot] || a.slot || '—'}</td>
                  <td className="px-4 py-3 text-right text-gray-600">{a.stations}</td>
                  <td className="px-4 py-3 text-right text-gray-600">{a.swaps}</td>
                  <td className="px-4 py-3 text-right text-gray-600">{fmtDwell(a.avg_dwell_sec)}</td>
                  <td className="px-4 py-3 text-right font-bold text-[#1e3a5f]">{a.impressions}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {toast && (
        <div className={`fixed bottom-6 right-6 px-4 py-3 rounded-xl shadow-xl text-sm font-medium ${
          toast.type === 'error' ? 'bg-red-50 border border-red-200 text-red-700' : 'bg-green-50 border border-green-200 text-green-700'
        }`}>{toast.message}</div>
      )}
    </div>
  )
}

function StatCard({ label, value, accent }) {
  return (
    <div className="bg-[#1e3a5f] rounded-2xl px-5 py-4 text-white">
      <p className="text-xs text-white/60 font-medium">{label}</p>
      <p className="text-2xl font-bold mt-1" style={accent ? { color: accent } : undefined}>{value}</p>
    </div>
  )
}
