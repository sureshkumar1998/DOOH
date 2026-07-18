import { useEffect, useState } from 'react'
import api from '../api.js'
import { LAYOUTS, MiniMockup, ScreenMockup } from '../components/screenLayout.jsx'

const CHIP_CAP = 6

const STATUS_CHIP = {
  active: { label: 'Active', cls: 'bg-green-50 text-green-700 border-green-300' },
  scheduled: { label: 'Scheduled', cls: 'bg-blue-50 text-blue-700 border-blue-300' },
  ended: { label: 'Ended', cls: 'bg-red-50 text-red-600 border-red-300' },
}

// Chip styling per client contract state (worst state across that client's ads wins).
const CLIENT_CHIP = {
  expired: 'bg-red-600 text-white',
  expiring_soon: 'bg-amber-500 text-white',
  active: 'bg-[#1e3a5f] text-white',
  none: 'bg-[#1e3a5f] text-white',
}

function fmtDate(d) {
  if (!d) return null
  return new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
}

export default function OverviewPage() {
  const role = localStorage.getItem('role') || 'admin'
  const [placements, setPlacements] = useState([])
  const [loading, setLoading] = useState(true)
  const [toast, setToast] = useState(null)
  const [preview, setPreview] = useState(null) // placement object or null

  function showToast(message, type = 'success') {
    setToast({ message, type })
    setTimeout(() => setToast(null), 3500)
  }

  function load() {
    setLoading(true)
    api.get('/placements/')
      .then(({ data }) => setPlacements(data))
      .catch(() => showToast('Failed to load placements.', 'error'))
      .finally(() => setLoading(false))
  }

  useEffect(load, [])

  useEffect(() => {
    if (!preview) return
    function onKey(e) { if (e.key === 'Escape') setPreview(null) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [preview])

  async function handleRemove(p) {
    if (!window.confirm(`Remove this placement for ${p.targets.join(', ')}?`)) return
    try {
      await api.delete(`/placements/${p.id}/`)
      if (preview?.id === p.id) setPreview(null)
      load()
      showToast('Placement removed — those stations stop showing it on next sync.')
    } catch {
      showToast('Failed to remove placement.', 'error')
    }
  }

  const previewLayout = preview ? LAYOUTS.find((l) => l.id === preview.layout) : null
  const previewAssignments = preview
    ? Object.fromEntries(Object.entries(preview.ads).map(([slot, ad]) => [slot, ad.id]))
    : {}
  const previewAdsById = preview
    ? Object.fromEntries(Object.values(preview.ads).map((ad) => [ad.id, ad]))
    : {}

  return (
    <div className="flex-1 p-8 w-full">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-800">Placement Overview</h1>
        <p className="text-sm text-gray-500 mt-0.5">Every layout you've assigned, by zone / station.</p>
      </div>

      {loading ? (
        <div className="flex justify-center py-20">
          <div className="w-10 h-10 border-4 border-[#1e3a5f] border-t-transparent rounded-full animate-spin" />
        </div>
      ) : placements.length === 0 ? (
        <div className="flex items-center justify-center py-24">
          <p className="text-sm text-gray-400">No placements yet — create one in the Placement page.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-5">
          {placements.map((p) => {
            const layout = LAYOUTS.find((l) => l.id === p.layout)
            const adCount = Object.keys(p.ads).length
            const chips = p.targets.slice(0, CHIP_CAP)
            const extra = p.targets.length - chips.length
            const created = new Date(p.created_at)
            const title = p.name || `Layout ${p.layout}`
            const chip = STATUS_CHIP[p.status] || null
            const dateRange = (p.start_date || p.end_date)
              ? `${fmtDate(p.start_date) || 'Always'} – ${fmtDate(p.end_date) || 'Ongoing'}`
              : null
            return (
              <div
                key={p.id}
                onClick={() => setPreview(p)}
                className="relative text-left rounded-2xl border-2 border-gray-200 bg-white p-4 cursor-pointer hover:border-gray-300 transition-colors"
              >
                {role !== 'operator' && (
                  <button
                    onClick={(e) => { e.stopPropagation(); handleRemove(p) }}
                    className="absolute top-3 right-3 w-7 h-7 rounded-full bg-gray-50 hover:bg-red-50 text-gray-400 hover:text-red-600 flex items-center justify-center transition-colors z-10"
                    aria-label="Remove placement"
                    title="Remove placement"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                        d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                  </button>
                )}

                <div style={{ width: 120 }} className="mb-3">
                  {layout ? <MiniMockup layout={layout} /> : null}
                </div>

                <div className="flex items-center justify-between gap-2 mb-1 pr-8">
                  <p className="text-sm font-bold text-gray-800 truncate">{title}</p>
                  {chip && (
                    <span className={`shrink-0 text-[10px] font-semibold px-2 py-0.5 rounded-full border ${chip.cls}`}>
                      {chip.label}
                    </span>
                  )}
                </div>
                {(p.advertisers && p.advertisers.length > 0) && (
                  <div className="flex flex-wrap gap-1 mb-1.5">
                    {p.advertisers.map((name) => {
                      // Worst contract state across this client's ads in the placement.
                      const states = Object.values(p.ads).filter((a) => a.advertiser_name === name).map((a) => a.contract_status)
                      const worst = states.includes('expired') ? 'expired'
                        : states.includes('expiring_soon') ? 'expiring_soon'
                        : (states[0] || 'none')
                      return (
                        <span key={name} className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${CLIENT_CHIP[worst]}`}>
                          {name}{worst === 'expired' ? ' · expired' : worst === 'expiring_soon' ? ' · expiring' : ''}
                        </span>
                      )
                    })}
                  </div>
                )}
                {p.total_ads > 0 && p.live_ads < p.total_ads && (() => {
                  const labels = { expired: 'expired', scheduled: 'scheduled', paused: 'paused', out_of_hours: 'outside hours' }
                  const counts = {}
                  Object.values(p.ads).forEach((a) => {
                    if (a.play_state && a.play_state !== 'live') counts[a.play_state] = (counts[a.play_state] || 0) + 1
                  })
                  const parts = Object.entries(counts).map(([k, n]) => `${n} ${labels[k] || k}`)
                  return (
                    <p className="text-[11px] font-semibold text-red-600 mb-1.5">
                      Not playing now: {parts.join(' · ')}
                    </p>
                  )
                })()}
                {dateRange && (
                  <p className="text-[11px] text-gray-400 mb-2">{dateRange}</p>
                )}

                <span className="inline-block text-xs font-semibold px-2 py-0.5 rounded-full bg-[#d9a52b] text-white mb-2">
                  Layout {p.layout}
                </span>

                <div className="flex flex-wrap gap-1.5 mb-2">
                  {chips.map((t) => (
                    <span key={t} className="text-[11px] font-medium px-2 py-0.5 rounded-full"
                      style={{ backgroundColor: 'rgba(30,58,95,0.08)', color: '#1e3a5f' }}>
                      {t}
                    </span>
                  ))}
                  {extra > 0 && (
                    <span className="text-[11px] font-medium px-2 py-0.5 rounded-full text-gray-400">
                      +{extra} more
                    </span>
                  )}
                </div>

                <p className="text-xs text-gray-400">
                  {adCount} ad{adCount === 1 ? '' : 's'} · {created.toLocaleDateString()}
                </p>
              </div>
            )
          })}
        </div>
      )}

      {preview && previewLayout && (
        <div
          className="fixed inset-0 flex items-center justify-center p-6 z-50"
          style={{ backgroundColor: 'rgba(0,0,0,0.7)' }}
          onClick={() => setPreview(null)}
        >
          <div
            className="bg-white rounded-2xl p-6 w-full relative"
            style={{ maxWidth: 1000 }}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={() => setPreview(null)}
              className="absolute top-4 right-4 w-8 h-8 rounded-full bg-gray-100 hover:bg-gray-200 text-gray-500 flex items-center justify-center text-lg leading-none"
              aria-label="Close"
            >
              ×
            </button>

            <ScreenMockup
              layout={previewLayout}
              assignments={previewAssignments}
              adsById={previewAdsById}
              interactive={false}
            />

            <div className="mt-4 flex flex-wrap items-center gap-2">
              <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-[#d9a52b] text-white">
                Layout {preview.layout}
              </span>
              {preview.targets.map((t) => (
                <span key={t} className="text-[11px] font-medium px-2 py-0.5 rounded-full"
                  style={{ backgroundColor: 'rgba(30,58,95,0.08)', color: '#1e3a5f' }}>
                  {t}
                </span>
              ))}
              <span className="text-xs text-gray-400 ml-auto">
                {Object.keys(preview.ads).length} ad{Object.keys(preview.ads).length === 1 ? '' : 's'}
              </span>
            </div>
          </div>
        </div>
      )}

      {toast && (
        <div className={`fixed bottom-6 right-6 px-4 py-3 rounded-xl shadow-xl text-sm font-medium ${
          toast.type === 'error'
            ? 'bg-red-50 border border-red-200 text-red-700'
            : 'bg-green-50 border border-green-200 text-green-700'
        }`}>
          {toast.message}
        </div>
      )}
    </div>
  )
}
