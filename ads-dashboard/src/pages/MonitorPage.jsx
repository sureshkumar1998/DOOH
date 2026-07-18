import { useEffect, useState, useCallback, useRef, useMemo } from 'react'
import api from '../api.js'

const STATUS_META = {
  online:  { label: 'Online',  dot: '#16a34a', chip: 'bg-green-100 text-green-700' },
  warning: { label: 'Warning', dot: '#d9a52b', chip: 'bg-amber-100 text-amber-700' },
  offline: { label: 'Offline', dot: '#dc2626', chip: 'bg-red-100 text-red-700' },
}

const ADS_STATUS_META = {
  running:   { label: 'Running',   chip: 'bg-green-100 text-green-700' },
  scheduled: { label: 'Scheduled', chip: 'bg-amber-100 text-amber-700' },
  no_ads:    { label: 'No Ads',    chip: 'bg-gray-100 text-gray-500' },
}

const REFRESH_MS = 30000

function formatDateTime(s) {
  if (!s) return '--'
  const d = new Date(s)
  if (isNaN(d)) return s
  return d.toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}

function StatusChip({ status }) {
  const m = STATUS_META[status] || STATUS_META.offline
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold ${m.chip}`}>
      <span className="w-2 h-2 rounded-full" style={{ backgroundColor: m.dot }} />
      {m.label}
    </span>
  )
}

function AdsStatusChip({ ads_status }) {
  const m = ADS_STATUS_META[ads_status] || ADS_STATUS_META.no_ads
  return (
    <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold ${m.chip}`}>
      {m.label}
    </span>
  )
}

function Pill({ label, value, accent }) {
  return (
    <div className="rounded-xl px-4 py-3 text-white shadow-sm min-w-[120px]" style={{ backgroundColor: '#1e3a5f' }}>
      <div className="text-2xl font-bold leading-tight" style={accent ? { color: accent } : {}}>{value}</div>
      <div className="text-xs uppercase tracking-wide text-white/70 mt-0.5">{label}</div>
    </div>
  )
}

function PlaybackSection({ deviceId }) {
  const [snapshot, setSnapshot] = useState(undefined) // undefined = loading

  useEffect(() => {
    if (!deviceId) return
    api.get(`/logs/?device_id=${encodeURIComponent(deviceId)}&from=${new Date(Date.now() - 86400000 * 7).toISOString().slice(0, 10)}`)
      .then(({ data }) => {
        // Find most recent snapshot for this exact device
        const match = data.find((s) => s.device_id === deviceId)
        setSnapshot(match || null)
      })
      .catch(() => setSnapshot(null))
  }, [deviceId])

  if (snapshot === undefined) return <p className="text-sm text-gray-400">Loading playback…</p>
  if (!snapshot) return <p className="text-sm text-gray-400">No playback data yet</p>

  // Group by slot, sort by order within each slot
  const bySlot = {}
  for (const ad of snapshot.active_ads || []) {
    const slot = ad.slot || 'unknown'
    if (!bySlot[slot]) bySlot[slot] = []
    bySlot[slot].push(ad)
  }
  for (const slot of Object.keys(bySlot)) {
    bySlot[slot].sort((a, b) => (a.order || 0) - (b.order || 0))
  }

  const slotLabel = (s) => s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())

  return (
    <div className="space-y-2">
      {Object.entries(bySlot).map(([slot, ads]) => (
        <div key={slot}>
          <div className="text-xs font-semibold text-gray-500 mb-0.5">{slotLabel(slot)}</div>
          <div className="text-xs text-gray-700 flex flex-wrap gap-1 items-center">
            {ads.map((ad, i) => (
              <span key={i} className="bg-gray-100 rounded px-1.5 py-0.5">
                {ad.filename} ({ad.duration_seconds}s)
              </span>
            ))}
            <span className="text-gray-400 italic">[loops]</span>
          </div>
        </div>
      ))}
    </div>
  )
}

export default function MonitorPage() {
  const [summary, setSummary] = useState(null)
  const [devices, setDevices] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const [search, setSearch] = useState('')
  const [zone, setZone] = useState('')
  const [station, setStation] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [pageSize, setPageSize] = useState(100)
  const [refreshOn, setRefreshOn] = useState(true)

  const [selected, setSelected] = useState(null)
  const timerRef = useRef(null)

  const fetchDevices = useCallback(async () => {
    try {
      const { data } = await api.get('/devices/')
      setSummary(data.summary)
      setDevices(data.devices)
      setError(null)
    } catch {
      setError('Failed to load devices.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchDevices() }, [fetchDevices])

  useEffect(() => {
    if (!refreshOn) return
    timerRef.current = setInterval(fetchDevices, REFRESH_MS)
    return () => clearInterval(timerRef.current)
  }, [refreshOn, fetchDevices])

  const zones = useMemo(() => [...new Set(devices.map((d) => d.zone).filter(Boolean))].sort(), [devices])
  const stations = useMemo(() => [...new Set(devices.map((d) => d.station).filter(Boolean))].sort(), [devices])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return devices.filter((d) => {
      if (zone && d.zone !== zone) return false
      if (station && d.station !== station) return false
      if (statusFilter && d.status !== statusFilter) return false
      if (q && !(`${d.device_id} ${d.station} ${d.location}`).toLowerCase().includes(q)) return false
      return true
    })
  }, [devices, search, zone, station, statusFilter])

  const visible = filtered.slice(0, pageSize)

  function exportCsv() {
    const cols = ['device_id', 'station', 'zone', 'location', 'status', 'ads_status', 'last_sync', 'heartbeat_label', 'current_ad', 'version', 'storage_used_pct', 'internet', 'operational_status', 'power']
    const header = cols.join(',')
    const rows = filtered.map((d) =>
      cols.map((c) => {
        const v = d[c] ?? ''
        const s = String(v).replace(/"/g, '""')
        return /[",\n]/.test(s) ? `"${s}"` : s
      }).join(',')
    )
    const blob = new Blob([[header, ...rows].join('\n')], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `devices_${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  async function openDetail(device) {
    setSelected(device) // optimistic — show list row data immediately
    try {
      const { data } = await api.get(`/devices/${device.device_id}/`)
      setSelected(data)
    } catch { /* keep the list-row data */ }
  }

  return (
    <div className="flex-1 p-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-800">Device Monitoring Dashboard</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Fleet health across all CCU displays{summary ? ` · last sync ${summary.last_sync}` : ''}
          </p>
        </div>
        <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer select-none">
          <span>Auto-refresh</span>
          <button
            type="button"
            onClick={() => setRefreshOn((v) => !v)}
            className={`relative w-11 h-6 rounded-full transition-colors ${refreshOn ? '' : 'bg-gray-300'}`}
            style={refreshOn ? { backgroundColor: '#1e3a5f' } : {}}
          >
            <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full transition-transform ${refreshOn ? 'translate-x-5' : ''}`} />
          </button>
          <span className="text-xs font-semibold" style={{ color: refreshOn ? '#16a34a' : '#9ca3af' }}>
            {refreshOn ? 'ON' : 'OFF'}
          </span>
        </label>
      </div>

      {/* Stat pills */}
      {summary && (
        <div className="flex flex-wrap gap-3 mb-6">
          <Pill label="Total Devices" value={summary.total} />
          <Pill label="Online" value={summary.online} accent="#4ade80" />
          <Pill label="Warning" value={summary.warning} accent="#fbbf24" />
          <Pill label="Offline" value={summary.offline} accent="#f87171" />
          <Pill label="Last Sync" value={summary.last_sync} />
        </div>
      )}

      {/* Controls */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search device, station, location…"
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm w-64 focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]/30"
        />
        <select value={zone} onChange={(e) => setZone(e.target.value)} className="border border-gray-300 rounded-lg px-3 py-2 text-sm">
          <option value="">All Zones</option>
          {zones.map((z) => <option key={z} value={z}>{z}</option>)}
        </select>
        <select value={station} onChange={(e) => setStation(e.target.value)} className="border border-gray-300 rounded-lg px-3 py-2 text-sm">
          <option value="">All Stations</option>
          {stations.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="border border-gray-300 rounded-lg px-3 py-2 text-sm">
          <option value="">All Status</option>
          <option value="online">Online</option>
          <option value="warning">Warning</option>
          <option value="offline">Offline</option>
        </select>
        <select value={pageSize} onChange={(e) => setPageSize(Number(e.target.value))} className="border border-gray-300 rounded-lg px-3 py-2 text-sm">
          {[50, 100, 200].map((n) => <option key={n} value={n}>{n} / page</option>)}
        </select>
        <button onClick={exportCsv} className="ml-auto px-4 py-2 rounded-lg text-sm font-semibold text-white" style={{ backgroundColor: '#d9a52b' }}>
          Export CSV
        </button>
      </div>

      {/* Table */}
      {loading ? (
        <p className="text-gray-500">Loading devices…</p>
      ) : error ? (
        <p className="text-red-600">{error}</p>
      ) : (
        <div className="bg-white rounded-xl shadow-sm overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-gray-500 border-b border-gray-200" style={{ backgroundColor: '#f8fafc' }}>
                <th className="px-4 py-3 font-semibold">Device ID</th>
                <th className="px-4 py-3 font-semibold">Service Location</th>
                <th className="px-4 py-3 font-semibold">Zone</th>
                <th className="px-4 py-3 font-semibold">Status</th>
                <th className="px-4 py-3 font-semibold">Ads</th>
                <th className="px-4 py-3 font-semibold">Last Sync</th>
                <th className="px-4 py-3 font-semibold">Heartbeat</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((d) => (
                <tr
                  key={d.device_id}
                  onClick={() => openDetail(d)}
                  className="border-b border-gray-100 hover:bg-gray-50 cursor-pointer"
                >
                  <td className="px-4 py-3 font-medium text-gray-800">{d.device_id}</td>
                  <td className="px-4 py-3 text-gray-600">{d.location || d.station}</td>
                  <td className="px-4 py-3 text-gray-600">{d.zone}</td>
                  <td className="px-4 py-3"><StatusChip status={d.status} /></td>
                  <td className="px-4 py-3"><AdsStatusChip ads_status={d.ads_status} /></td>
                  <td className="px-4 py-3 text-gray-600">{formatDateTime(d.last_sync)}</td>
                  <td className="px-4 py-3 text-gray-600">{d.heartbeat_label}</td>
                </tr>
              ))}
              {visible.length === 0 && (
                <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-400">No devices match the filters.</td></tr>
              )}
            </tbody>
          </table>
          <div className="px-4 py-3 text-xs text-gray-500 border-t border-gray-100">
            Showing {visible.length} of {filtered.length} device(s)
          </div>
        </div>
      )}

      {/* Detail drawer */}
      {selected && (
        <div className="fixed inset-0 z-40 flex justify-end" onClick={() => setSelected(null)}>
          <div className="absolute inset-0 bg-black/30" />
          <div className="relative w-full max-w-md bg-white h-full shadow-xl overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="px-6 py-4 text-white flex items-center justify-between" style={{ backgroundColor: '#1e3a5f' }}>
              <div>
                <div className="text-xs uppercase tracking-wide text-white/60">Device Details</div>
                <div className="text-lg font-bold">{selected.device_id}</div>
              </div>
              <button onClick={() => setSelected(null)} className="text-white/70 hover:text-white text-2xl leading-none">x</button>
            </div>
            <div className="p-6 space-y-4">
              <DetailRow label="Station" value={selected.station} />
              <DetailRow label="Service Location" value={selected.location} />
              <DetailRow label="Zone" value={selected.zone} />
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-500">Status</span>
                <StatusChip status={selected.status} />
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-500">Ad Status</span>
                <AdsStatusChip ads_status={selected.ads_status} />
              </div>
              <DetailRow label="Last Sync" value={formatDateTime(selected.last_sync)} />
              <DetailRow label="Heartbeat" value={selected.heartbeat_label} />
              <hr className="border-gray-100" />
              <DetailRow label="Current Ad" value={selected.current_ad || '--'} />
              <DetailRow label="Current Version" value={selected.version} />
              {selected.operational_status != null && (
                <DetailRow label="Operational Status" value={selected.operational_status} />
              )}
              {selected.power != null && (
                <DetailRow label="Power" value={selected.power} />
              )}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-sm text-gray-500">Storage</span>
                  <span className="text-sm font-medium text-gray-800">{selected.storage_used_pct != null ? `${selected.storage_used_pct}% used` : '--'}</span>
                </div>
                <div className="w-full h-2 bg-gray-100 rounded-full overflow-hidden">
                  <div className="h-full rounded-full" style={{ width: `${selected.storage_used_pct || 0}%`, backgroundColor: selected.storage_used_pct > 80 ? '#dc2626' : '#1e3a5f' }} />
                </div>
              </div>
              <DetailRow label="Internet" value={selected.internet ? 'Connected' : 'Disconnected'} valueColor={selected.internet ? '#16a34a' : '#dc2626'} />
              <DetailRow label="Last Restart" value={formatDateTime(selected.last_restart)} />
              <hr className="border-gray-100" />
              <div>
                <div className="text-sm font-semibold text-gray-700 mb-2">Current Playback</div>
                <PlaybackSection deviceId={selected.device_id} />
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function DetailRow({ label, value, valueColor }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-sm text-gray-500">{label}</span>
      <span className="text-sm font-medium text-gray-800" style={valueColor ? { color: valueColor } : {}}>{value ?? '--'}</span>
    </div>
  )
}
