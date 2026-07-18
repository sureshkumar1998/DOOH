import { useEffect, useState, useCallback, useMemo } from 'react'
import api from '../api.js'

function formatISO(d) {
  return d.toISOString().slice(0, 10)
}

function sevenDaysAgo() {
  const d = new Date()
  d.setDate(d.getDate() - 7)
  return d
}

function formatDT(s) {
  if (!s) return '--'
  const d = new Date(s)
  if (isNaN(d)) return s
  return d.toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}

function SummaryCard({ label, value }) {
  return (
    <div className="rounded-xl px-5 py-4 text-white shadow-sm" style={{ backgroundColor: '#1e3a5f' }}>
      <div className="text-2xl font-bold leading-tight" style={{ color: '#d9a52b' }}>{value}</div>
      <div className="text-xs uppercase tracking-wide text-white/70 mt-0.5">{label}</div>
    </div>
  )
}

function slotLabel(s) {
  if (!s) return '--'
  return s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

export default function LogsPage() {
  const today = new Date()
  const [fromDate, setFromDate] = useState(formatISO(sevenDaysAgo()))
  const [toDate, setToDate] = useState(formatISO(today))
  const [zoneFilter, setZoneFilter] = useState('')
  const [deviceFilter, setDeviceFilter] = useState('')
  const [advertisers, setAdvertisers] = useState([])
  const [reportAdvertiserId, setReportAdvertiserId] = useState('')
  const [applied, setApplied] = useState({ from: formatISO(sevenDaysAgo()), to: formatISO(today), zone: '', device: '' })

  const [logs, setLogs] = useState([])
  const [summary, setSummary] = useState([])
  const [loadingLogs, setLoadingLogs] = useState(true)
  const [loadingSummary, setLoadingSummary] = useState(true)
  const [expandedRow, setExpandedRow] = useState(null)

  const fetchData = useCallback(async (params) => {
    setLoadingLogs(true)
    setLoadingSummary(true)

    const qs = new URLSearchParams()
    if (params.from) qs.set('from', params.from)
    if (params.to) qs.set('to', params.to)
    if (params.zone) qs.set('zone', params.zone)
    if (params.device) qs.set('device_id', params.device)

    try {
      const { data } = await api.get(`/logs/?${qs}`)
      setLogs(data)
    } catch {
      setLogs([])
    } finally {
      setLoadingLogs(false)
    }

    try {
      const { data } = await api.get(`/logs/summary/?${qs}`)
      setSummary(data)
    } catch {
      setSummary([])
    } finally {
      setLoadingSummary(false)
    }
  }, [])

  useEffect(() => { fetchData(applied) }, [fetchData, applied])

  useEffect(() => {
    api.get('/advertisers/').then(({ data }) => setAdvertisers(data)).catch(() => {})
  }, [])

  function handleApply() {
    setApplied({ from: fromDate, to: toDate, zone: zoneFilter, device: deviceFilter })
  }

  // Unique zones from logs for dropdown
  const zones = useMemo(() => [...new Set(logs.map((l) => l.zone).filter(Boolean))].sort(), [logs])

  // Summary stats
  const totalAds = summary.length
  const totalDevices = useMemo(() => {
    const ids = new Set()
    logs.forEach((l) => ids.add(l.device_id))
    return ids.size
  }, [logs])
  const totalHours = useMemo(() => {
    const mins = summary.reduce((acc, s) => acc + s.total_device_minutes, 0)
    return (mins / 60).toFixed(1)
  }, [summary])

  async function downloadReport() {
    try {
      const res = await api.get('/reports/proof-of-play/', {
        params: {
          from: applied.from,
          to: applied.to,
          zone: applied.zone || undefined,
          advertiser: reportAdvertiserId || undefined,
          format: 'csv',
        },
        responseType: 'blob',
      })
      const url = URL.createObjectURL(res.data)
      const a = document.createElement('a')
      a.href = url
      a.download = `proof_of_play_${applied.from}_${applied.to}.csv`
      a.click()
      URL.revokeObjectURL(url)
    } catch {
      // no-op — report download failed silently, timeline export still available
    }
  }

  function exportCsv() {
    const cols = ['device_id', 'zone', 'station', 'active_ads_count', 'started_at', 'last_seen_at', 'duration_minutes']
    const header = cols.join(',')
    const rows = logs.map((l) => {
      const vals = {
        device_id: l.device_id,
        zone: l.zone,
        station: l.station,
        active_ads_count: (l.active_ads || []).length,
        started_at: l.started_at,
        last_seen_at: l.last_seen_at,
        duration_minutes: l.duration_minutes,
      }
      return cols.map((c) => {
        const v = vals[c] ?? ''
        const s = String(v).replace(/"/g, '""')
        return /[",\n]/.test(s) ? `"${s}"` : s
      }).join(',')
    })
    const blob = new Blob([[header, ...rows].join('\n')], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `playback_logs_${formatISO(new Date())}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="flex-1 p-8">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-800">Playback Logs</h1>
        <p className="text-sm text-gray-500 mt-0.5">Ad playback history across all CCU devices</p>
      </div>

      {/* Filter bar */}
      <div className="flex flex-wrap items-end gap-3 mb-6 p-4 bg-white rounded-xl shadow-sm">
        <div>
          <label className="block text-xs font-semibold text-gray-500 mb-1">From</label>
          <input
            type="date"
            value={fromDate}
            onChange={(e) => setFromDate(e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]/30"
          />
        </div>
        <div>
          <label className="block text-xs font-semibold text-gray-500 mb-1">To</label>
          <input
            type="date"
            value={toDate}
            onChange={(e) => setToDate(e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]/30"
          />
        </div>
        <div>
          <label className="block text-xs font-semibold text-gray-500 mb-1">Zone</label>
          <select
            value={zoneFilter}
            onChange={(e) => setZoneFilter(e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm"
          >
            <option value="">All Zones</option>
            {zones.map((z) => <option key={z} value={z}>{z}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-semibold text-gray-500 mb-1">Device ID</label>
          <input
            type="text"
            value={deviceFilter}
            onChange={(e) => setDeviceFilter(e.target.value)}
            placeholder="Filter by device…"
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm w-48 focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]/30"
          />
        </div>
        <button
          onClick={handleApply}
          className="px-5 py-2 rounded-lg text-sm font-semibold text-white"
          style={{ backgroundColor: '#1e3a5f' }}
        >
          Apply
        </button>
      </div>

      {/* Summary cards */}
      <div className="flex flex-wrap gap-4 mb-8">
        <SummaryCard label="Unique Ads" value={loadingSummary ? '…' : totalAds} />
        <SummaryCard label="Devices Reporting" value={loadingLogs ? '…' : totalDevices} />
        <SummaryCard label="Total Device-Hours" value={loadingSummary ? '…' : totalHours} />
      </div>

      {/* Per-ad summary table */}
      <div className="mb-8">
        <h2 className="text-base font-bold text-gray-700 mb-3">Ad Summary</h2>
        <div className="bg-white rounded-xl shadow-sm overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-gray-500 border-b border-gray-200" style={{ backgroundColor: '#f8fafc' }}>
                <th className="px-4 py-3 font-semibold">Ad Name</th>
                <th className="px-4 py-3 font-semibold">Slot</th>
                <th className="px-4 py-3 font-semibold">Devices</th>
                <th className="px-4 py-3 font-semibold">Running Time</th>
                <th className="px-4 py-3 font-semibold">Zones</th>
              </tr>
            </thead>
            <tbody>
              {loadingSummary ? (
                <tr><td colSpan={5} className="px-4 py-8 text-center text-gray-400">Loading…</td></tr>
              ) : summary.length === 0 ? (
                <tr><td colSpan={5} className="px-4 py-8 text-center text-gray-400">No data for this period.</td></tr>
              ) : summary.map((s, i) => (
                <tr key={i} className="border-b border-gray-100">
                  <td className="px-4 py-3 font-medium text-gray-800">{s.filename}</td>
                  <td className="px-4 py-3 text-gray-600">{slotLabel(s.slot) || '--'}</td>
                  <td className="px-4 py-3 text-gray-600">{s.device_count}</td>
                  <td className="px-4 py-3 text-gray-600">{s.total_device_minutes >= 60
                    ? `${(s.total_device_minutes / 60).toFixed(1)} hr`
                    : `${s.total_device_minutes.toFixed(1)} min`}
                  </td>
                  <td className="px-4 py-3 text-gray-600">{s.zones.join(', ') || '--'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Timeline table */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-base font-bold text-gray-700">Playback Timeline</h2>
          <div className="flex items-center gap-2">
            <select
              value={reportAdvertiserId}
              onChange={(e) => setReportAdvertiserId(e.target.value)}
              className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]/30"
            >
              <option value="">All clients</option>
              {advertisers.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
            <button
              onClick={downloadReport}
              className="px-4 py-2 rounded-lg text-sm font-semibold border-2 bg-white"
              style={{ borderColor: '#d9a52b', color: '#d9a52b' }}
            >
              Download Report
            </button>
            <button onClick={exportCsv} className="px-4 py-2 rounded-lg text-sm font-semibold text-white" style={{ backgroundColor: '#d9a52b' }}>
              Export CSV
            </button>
          </div>
        </div>
        <div className="bg-white rounded-xl shadow-sm overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-gray-500 border-b border-gray-200" style={{ backgroundColor: '#f8fafc' }}>
                <th className="px-4 py-3 font-semibold">Device</th>
                <th className="px-4 py-3 font-semibold">Zone</th>
                <th className="px-4 py-3 font-semibold">Station</th>
                <th className="px-4 py-3 font-semibold">Active Ads</th>
                <th className="px-4 py-3 font-semibold">Playing Since</th>
                <th className="px-4 py-3 font-semibold">Last Seen</th>
                <th className="px-4 py-3 font-semibold">Duration</th>
              </tr>
            </thead>
            <tbody>
              {loadingLogs ? (
                <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-400">Loading…</td></tr>
              ) : logs.length === 0 ? (
                <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-400">No playback data for this period.</td></tr>
              ) : logs.map((l) => {
                const isExpanded = expandedRow === l.id
                const bySlot = {}
                for (const ad of l.active_ads || []) {
                  const slot = ad.slot || 'unknown'
                  if (!bySlot[slot]) bySlot[slot] = []
                  bySlot[slot].push(ad)
                }
                for (const slot of Object.keys(bySlot)) {
                  bySlot[slot].sort((a, b) => (a.order || 0) - (b.order || 0))
                }
                return [
                  <tr
                    key={l.id}
                    onClick={() => setExpandedRow(isExpanded ? null : l.id)}
                    className="border-b border-gray-100 hover:bg-gray-50 cursor-pointer"
                  >
                    <td className="px-4 py-3 font-medium text-gray-800">{l.device_id}</td>
                    <td className="px-4 py-3 text-gray-600">{l.zone || '--'}</td>
                    <td className="px-4 py-3 text-gray-600">{l.station || '--'}</td>
                    <td className="px-4 py-3 text-gray-600">{(l.active_ads || []).length}</td>
                    <td className="px-4 py-3 text-gray-600">{formatDT(l.started_at)}</td>
                    <td className="px-4 py-3 text-gray-600">{formatDT(l.last_seen_at)}</td>
                    <td className="px-4 py-3 text-gray-600">
                      {l.duration_minutes >= 60
                        ? `${(l.duration_minutes / 60).toFixed(1)} hr`
                        : `${l.duration_minutes.toFixed(1)} min`}
                    </td>
                  </tr>,
                  isExpanded && (
                    <tr key={`${l.id}-expand`} className="bg-blue-50">
                      <td colSpan={7} className="px-6 py-3">
                        <div className="space-y-2">
                          {Object.entries(bySlot).map(([slot, ads]) => (
                            <div key={slot}>
                              <span className="text-xs font-semibold text-gray-500 mr-2">{slotLabel(slot)}</span>
                              <span className="text-xs text-gray-700">
                                {ads.map((ad, i) => `${ad.filename} (${ad.duration_seconds}s)`).join(' → ')} [loops]
                              </span>
                            </div>
                          ))}
                        </div>
                      </td>
                    </tr>
                  )
                ]
              })}
            </tbody>
          </table>
          <div className="px-4 py-3 text-xs text-gray-500 border-t border-gray-100">
            {logs.length} record(s) · click a row to expand active ads
          </div>
        </div>
      </div>
    </div>
  )
}
