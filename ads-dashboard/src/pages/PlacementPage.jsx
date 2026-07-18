import { useEffect, useMemo, useState } from 'react'
import api from '../api.js'
import { LAYOUTS, SLOT_LABELS, rowsForLayout, slotsForLayout, MiniMockup, ScreenMockup } from '../components/screenLayout.jsx'

/**
 * Placement wizard — owns all CCU screen placement in 4 steps:
 *   1. Choose Layout   — pick one of 6 fixed screen layouts
 *   2. Arrange Ads     — drag images/videos onto the layout's ad panels
 *   3. Target          — choose zones or stations this placement applies to
 *   4. Preview & Save  — review the assembled screen and persist
 *
 * The swap UI block is always a single, un-split block (50% of screen height);
 * only its POSITION moves (top / middle / bottom). The remaining two 25%-tall
 * bands hold ads, each either one full-width ad or two split ads.
 *
 * Slot mapping is fixed regardless of swap position:
 *   bands[0] (first ad band in layout order) -> top_left / top_right
 *   bands[1] (second ad band)                -> bottom_left / bottom_right
 *
 * LAYOUTS, slot metadata, and the mockup renderers live in
 * ../components/screenLayout.jsx so the Overview page can reuse them.
 */

const RENDER_CAP = 200

export default function PlacementPage() {
  const [step, setStep] = useState(1)
  const [toast, setToast] = useState(null)

  // Step 1
  const [selectedLayoutId, setSelectedLayoutId] = useState(null)
  const [layoutLoaded, setLayoutLoaded] = useState(false)

  // Step 2
  const [ads, setAds] = useState([])
  const [adsLoading, setAdsLoading] = useState(true)
  const [assignments, setAssignments] = useState({}) // { slot: adId }
  const [selectedLibraryId, setSelectedLibraryId] = useState(null)

  // Step 3
  const [targetType, setTargetType] = useState('zone')
  const [options, setOptions] = useState([])
  const [loadingTargets, setLoadingTargets] = useState(true)
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState([])

  // Step 4
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [advertisers, setAdvertisers] = useState([])

  function showToast(message, type = 'success') {
    setToast({ message, type })
    setTimeout(() => setToast(null), 3500)
  }

  useEffect(() => {
    api.get('/layout/')
      .then(({ data }) => { if (data?.layout) setSelectedLayoutId(data.layout) })
      .catch(() => {})
      .finally(() => setLayoutLoaded(true))

    api.get('/ads/')
      .then(({ data }) => setAds(data))
      .catch(() => showToast('Failed to load ad library.', 'error'))
      .finally(() => setAdsLoading(false))

    api.get('/advertisers/')
      .then(({ data }) => setAdvertisers(data))
      .catch(() => {})
  }, [])

  useEffect(() => {
    setSelected([])
    setSearch('')
    setLoadingTargets(true)
    api.get(`/targets/?type=${targetType}`)
      .then(({ data }) => setOptions(data))
      .catch(() => setOptions([]))
      .finally(() => setLoadingTargets(false))
  }, [targetType])

  const adsById = useMemo(() => Object.fromEntries(ads.map((a) => [a.id, a])), [ads])
  const images = useMemo(() => ads.filter((a) => a.media_type === 'image' && a.status === 'approved'), [ads])
  const videos = useMemo(() => ads.filter((a) => a.media_type === 'video' && a.status === 'approved'), [ads])
  const layout = LAYOUTS.find((l) => l.id === selectedLayoutId) || null

  const q = search.trim().toLowerCase()
  const filteredOptions = q
    ? options.filter((o) =>
        o.name?.toLowerCase().includes(q) ||
        o.location?.toLowerCase().includes(q) ||
        o.zone?.toLowerCase().includes(q) ||
        o.id?.toLowerCase().includes(q))
    : options
  const cappedOptions = filteredOptions.slice(0, RENDER_CAP)

  function assignAd(slot, adId) {
    setAssignments((prev) => {
      const next = {}
      for (const [s, id] of Object.entries(prev)) {
        if (id !== adId) next[s] = id
      }
      next[slot] = adId
      return next
    })
  }

  function clearSlot(slot) {
    setAssignments((prev) => {
      const next = { ...prev }
      delete next[slot]
      return next
    })
  }

  function toggleTarget(id) {
    setSelected((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id])
  }

  function assignedSlotFor(adId) {
    return Object.entries(assignments).find(([, id]) => id === adId)?.[0] || null
  }

  async function handleSave() {
    setSaving(true)
    try {
      // Name, advertiser, and dates are all derived server-side.
      await api.post('/placements/', {
        layout: selectedLayoutId,
        target_type: targetType,
        targets: selected,
        assignments,
      })
      setSaved(true)
      showToast('Placement saved')
    } catch (err) {
      showToast(err.response?.data?.error || 'Failed to save placement.', 'error')
    } finally {
      setSaving(false)
    }
  }

  function startAgain() {
    setStep(1)
    setSaved(false)
    setAssignments({})
    setSelectedLibraryId(null)
    setSelected([])
  }

  const stepTitles = {
    1: 'Choose Layout',
    2: 'Arrange Ads',
    3: 'Target',
    4: 'Preview & Save',
  }
  const stepSubtitles = {
    1: 'Pick a screen layout for the CCU display',
    2: 'Drag ads onto the layout, or select one and tap a panel',
    3: 'Choose which zones or stations this placement applies to',
    4: 'Review the assembled screen before saving',
  }

  const canNext = {
    1: selectedLayoutId != null,
    2: Object.keys(assignments).length > 0,
    3: selected.length > 0,
    4: true,
  }[step]

  const selectedNames = options.filter((o) => selected.includes(o.id)).map((o) => o.name)
  const targetSummary = selectedNames.length > 3
    ? `${selectedNames.slice(0, 3).join(', ')} +${selectedNames.length - 3} more`
    : selectedNames.join(', ')

  // Distinct client names across the assigned ads (derived — the single source of truth).
  const assignedClientNames = [...new Set(
    Object.values(assignments)
      .map((adId) => adsById[adId]?.advertiser_name)
      .filter(Boolean)
  )]

  return (
    <div className="flex-1 p-8 w-full">
      {/* Header + step indicator */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-800">Placement</h1>
        <p className="text-sm text-gray-500 mt-0.5">{stepSubtitles[step]}</p>
        <div className="flex items-center gap-2 mt-4">
          {[1, 2, 3, 4].map((s) => (
            <div key={s} className="flex-1">
              <div className={`h-1.5 rounded-full transition-colors ${s <= step ? 'bg-[#d9a52b]' : 'bg-gray-200'}`} />
              <p className={`text-xs mt-1.5 font-semibold ${s === step ? 'text-[#1e3a5f]' : 'text-gray-400'}`}>
                {s}. {stepTitles[s]}
              </p>
            </div>
          ))}
        </div>
      </div>

      {saved ? (
        <div className="flex flex-col items-center justify-center py-24 text-center">
          <div className="w-16 h-16 rounded-full flex items-center justify-center mb-4" style={{ backgroundColor: 'rgba(34,197,94,0.12)' }}>
            <svg className="w-9 h-9 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <p className="text-lg font-bold text-gray-800">Saved.</p>
          <p className="text-sm text-gray-500 mt-1 max-w-sm">
            Stations will pick this up on their next sync.
          </p>
          <button
            onClick={startAgain}
            className="mt-6 px-6 py-2.5 rounded-xl bg-[#1e3a5f] text-white text-sm font-semibold hover:bg-[#162d4a] transition-colors"
          >
            Start again
          </button>
        </div>
      ) : (
        <>
          {/* Step 1 — Choose Layout */}
          {step === 1 && (
            <div>
              {!layoutLoaded ? (
                <div className="flex justify-center py-20">
                  <div className="w-10 h-10 border-4 border-[#1e3a5f] border-t-transparent rounded-full animate-spin" />
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
                  {LAYOUTS.map((l) => {
                    const isSelected = selectedLayoutId === l.id
                    return (
                      <button
                        key={l.id}
                        onClick={() => setSelectedLayoutId(l.id)}
                        className={`text-left rounded-2xl border-2 p-4 transition-colors ${
                          isSelected ? 'border-[#d9a52b] bg-[#d9a52b]/10' : 'border-gray-200 bg-white hover:border-gray-300'
                        }`}
                      >
                        <div className="flex items-center justify-between mb-2">
                          <span className={`text-lg font-bold ${isSelected ? 'text-[#1e3a5f]' : 'text-gray-700'}`}>
                            Layout {l.id}
                          </span>
                          {isSelected && (
                            <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-[#d9a52b] text-white">Selected</span>
                          )}
                        </div>
                        <p className="text-xs text-gray-500 mb-3">{l.name}</p>
                        <MiniMockup layout={l} />
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
          )}

          {/* Step 2 — Arrange Ads */}
          {step === 2 && layout && (
            <div className="grid grid-cols-1 lg:grid-cols-[220px_minmax(0,1fr)_220px] gap-8 items-start">
              <LibraryColumn
                title="Images"
                items={images}
                loading={adsLoading}
                selectedLibraryId={selectedLibraryId}
                onSelect={setSelectedLibraryId}
                assignedSlotFor={assignedSlotFor}
              />

              <div className="flex flex-col items-center">
                <div style={{ width: '100%', maxWidth: 1000 }}>
                  <ScreenMockup
                    layout={layout}
                    assignments={assignments}
                    adsById={adsById}
                    interactive
                    onDrop={assignAd}
                    onClear={clearSlot}
                    onPanelClick={(slot) => {
                      if (!selectedLibraryId) return
                      if (assignments[slot]) return
                      assignAd(slot, selectedLibraryId)
                      setSelectedLibraryId(null)
                    }}
                  />
                </div>
                <p className="text-xs text-gray-400 mt-3 text-center max-w-xs">
                  Drag a thumbnail onto a panel, or tap a thumbnail then tap an empty panel.
                </p>
              </div>

              <LibraryColumn
                title="Videos"
                items={videos}
                loading={adsLoading}
                selectedLibraryId={selectedLibraryId}
                onSelect={setSelectedLibraryId}
                assignedSlotFor={assignedSlotFor}
              />
            </div>
          )}

          {/* Step 3 — Target */}
          {step === 3 && (
            <div className="w-full">
              <div className="flex bg-gray-100 rounded-xl p-1 gap-1 mb-4 max-w-md">
                {['zone', 'station'].map((t) => (
                  <button
                    key={t}
                    onClick={() => setTargetType(t)}
                    className={`flex-1 py-2 rounded-lg text-sm font-semibold transition-colors capitalize ${
                      targetType === t ? 'bg-[#1e3a5f] text-white shadow-sm' : 'text-gray-500 hover:text-gray-700'
                    }`}
                  >
                    {t === 'zone' ? 'Zone' : 'Station'}
                  </button>
                ))}
              </div>

              {!loadingTargets && options.length > 0 && (
                <div className="mb-3">
                  <input
                    type="text"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder={`Search ${targetType}s…`}
                    className="w-full max-w-lg border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]/30"
                  />
                  <div className="flex items-center justify-between mt-1.5 px-0.5">
                    <span className="text-xs text-gray-400">
                      {filteredOptions.length} {targetType}{filteredOptions.length === 1 ? '' : 's'}
                      {selected.length > 0 && ` · ${selected.length} selected`}
                    </span>
                    {selected.length > 0 && (
                      <button onClick={() => setSelected([])} className="text-xs text-[#1e3a5f] hover:underline">Clear</button>
                    )}
                  </div>
                </div>
              )}

              <div className="bg-white border border-gray-200 rounded-2xl px-4 py-3 max-h-[26rem] overflow-y-auto">
                {loadingTargets ? (
                  <div className="flex justify-center py-8">
                    <div className="w-7 h-7 border-3 border-[#1e3a5f] border-t-transparent rounded-full animate-spin" />
                  </div>
                ) : options.length === 0 ? (
                  <p className="text-center text-gray-400 text-sm py-8">No {targetType}s available.</p>
                ) : filteredOptions.length === 0 ? (
                  <p className="text-center text-gray-400 text-sm py-8">No {targetType}s match "{search}".</p>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-2">
                    {cappedOptions.map((opt) => {
                      const isSelected = selected.includes(opt.id)
                      const sub = [opt.location, opt.zone].filter(Boolean).join(' · ')
                      return (
                        <button
                          key={opt.id}
                          onClick={() => toggleTarget(opt.id)}
                          className={`w-full flex items-center justify-between px-4 py-3 rounded-xl border-2 transition-colors text-left ${
                            isSelected ? 'border-[#1e3a5f] bg-[#1e3a5f]/5' : 'border-gray-200 hover:border-gray-300'
                          }`}
                        >
                          <div className="min-w-0">
                            <p className={`text-sm font-semibold truncate ${isSelected ? 'text-[#1e3a5f]' : 'text-gray-700'}`}>
                              {opt.name}
                            </p>
                            {sub && <p className="text-xs text-gray-400 truncate">{sub}</p>}
                          </div>
                          {isSelected && (
                            <svg className="w-5 h-5 text-[#1e3a5f] shrink-0 ml-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                            </svg>
                          )}
                        </button>
                      )
                    })}
                    {filteredOptions.length > RENDER_CAP && (
                      <p className="col-span-full text-center text-xs text-gray-400 py-2">
                        Showing first {RENDER_CAP} of {filteredOptions.length} — refine your search to narrow down.
                      </p>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Step 4 — Preview & Save */}
          {step === 4 && layout && (
            <div className="flex flex-col items-center">
              <div style={{ width: '100%', maxWidth: 1000 }}>
                <ScreenMockup layout={layout} assignments={assignments} adsById={adsById} interactive={false} />
              </div>
              <p className="text-sm text-gray-600 font-medium mt-4">
                Layout {layout.id} · {Object.keys(assignments).length} ad{Object.keys(assignments).length === 1 ? '' : 's'} ·{' '}
                {targetType === 'zone' ? 'Zone' : 'Station'}: {targetSummary || '—'}
              </p>

              {/* Clients + dates are derived from the ads; the placement names itself by zone + layout. */}
              <div className="w-full max-w-lg mt-6 bg-white border border-gray-200 rounded-2xl p-4">
                <p className="text-xs text-gray-500">
                  Client{assignedClientNames.length > 1 ? 's' : ''}:{' '}
                  <span className="font-semibold text-[#1e3a5f]">{assignedClientNames.join(', ') || '—'}</span>
                  {' '}· each ad runs per its client's contract dates automatically.
                </p>
              </div>

              <button
                onClick={handleSave}
                disabled={saving}
                className="mt-5 px-8 py-3 rounded-xl bg-[#1e3a5f] text-white text-sm font-bold hover:bg-[#162d4a] disabled:opacity-50 transition-colors"
              >
                {saving ? 'Saving…' : 'Save Placement'}
              </button>
            </div>
          )}

          {/* Footer nav */}
          <div className="flex items-center justify-between mt-10 pt-6 border-t border-gray-200">
            <button
              onClick={() => setStep((s) => Math.max(1, s - 1))}
              disabled={step === 1}
              className="px-5 py-2.5 rounded-xl border-2 border-gray-200 text-sm font-semibold text-gray-500 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              Back
            </button>
            {step < 4 && (
              <button
                onClick={() => setStep((s) => Math.min(4, s + 1))}
                disabled={!canNext}
                className="px-6 py-2.5 rounded-xl bg-[#1e3a5f] text-white text-sm font-semibold disabled:opacity-40 hover:bg-[#162d4a] transition-colors"
              >
                Next
              </button>
            )}
          </div>
        </>
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

function LibraryColumn({ title, items, loading, selectedLibraryId, onSelect, assignedSlotFor }) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-widest text-gray-400 mb-2">{title}</p>
      <div className="max-h-[60vh] overflow-y-auto pr-1 space-y-2">
        {loading ? (
          <div className="flex justify-center py-8">
            <div className="w-7 h-7 border-3 border-[#1e3a5f] border-t-transparent rounded-full animate-spin" />
          </div>
        ) : items.length === 0 ? (
          <p className="text-xs text-gray-400 py-4 text-center">No {title.toLowerCase()} uploaded yet.</p>
        ) : (
          items.map((ad) => {
            const isSelected = selectedLibraryId === ad.id
            const assignedSlot = assignedSlotFor(ad.id)
            return (
              <div
                key={ad.id}
                draggable
                onDragStart={(e) => e.dataTransfer.setData('text/plain', String(ad.id))}
                onClick={() => onSelect(isSelected ? null : ad.id)}
                className={`cursor-pointer rounded-xl border-2 overflow-hidden transition-colors bg-white ${
                  isSelected ? 'border-[#d9a52b] ring-2 ring-[#d9a52b]/40' : 'border-gray-200 hover:border-gray-300'
                }`}
              >
                <div className="relative aspect-video bg-gray-100">
                  {ad.media_type === 'video' ? (
                    <video src={ad.url} className="w-full h-full object-cover" muted preload="metadata" />
                  ) : (
                    <img src={ad.url} alt={ad.title} className="w-full h-full object-cover" />
                  )}
                  {assignedSlot && (
                    <span className="absolute top-1 right-1 text-[9px] font-semibold px-1.5 py-0.5 rounded-full bg-[#1e3a5f] text-white">
                      {SLOT_LABELS[assignedSlot]}
                    </span>
                  )}
                </div>
                <p className="text-xs text-gray-600 truncate px-2 py-1.5">{ad.title}</p>
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
