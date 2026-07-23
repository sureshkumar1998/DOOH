import { useState } from 'react'
import swapUI from '../assets/swap-ui.png'

/**
 * Shared screen-layout building blocks used by the Placement wizard and the
 * Overview page: the 6 fixed layouts, slot metadata, and the two mockup
 * renderers (a small decorative thumbnail and the real interactive/preview
 * screen mockup).
 *
 * The swap UI block is always a single, un-split block (50% of screen height);
 * only its POSITION moves (top / middle / bottom). The remaining two 25%-tall
 * bands hold ads, each either one full-width ad or two split ads.
 *
 * Slot mapping is fixed regardless of swap position:
 *   bands[0] (first ad band in layout order) -> top_left / top_right
 *   bands[1] (second ad band)                -> bottom_left / bottom_right
 */

export const LAYOUTS = [
  { id: 1, name: 'Swap middle · Ads full',  swap: 'middle', bands: ['full', 'full'] },
  { id: 2, name: 'Swap middle · Ads split', swap: 'middle', bands: ['split', 'split'] },
  { id: 3, name: 'Swap top · Ads full',     swap: 'top',    bands: ['full', 'full'] },
  { id: 4, name: 'Swap top · Ads split',    swap: 'top',    bands: ['split', 'split'] },
  { id: 5, name: 'Swap bottom · Ads full',  swap: 'bottom', bands: ['full', 'full'] },
  { id: 6, name: 'Swap bottom · Ads split', swap: 'bottom', bands: ['split', 'split'] },
]

export const SLOT_LABELS = {
  top_left: 'Top Left',
  top_right: 'Top Right',
  bottom_left: 'Bottom Left',
  bottom_right: 'Bottom Right',
}

/** Ordered slot ids for a layout's ad panels, e.g. full/full -> [top_left, bottom_left]. */
export function slotsForLayout(layout) {
  const slots = []
  layout.bands.forEach((mode, i) => {
    const prefix = i === 0 ? 'top' : 'bottom'
    slots.push(`${prefix}_left`)
    if (mode === 'split') slots.push(`${prefix}_right`)
  })
  return slots
}

/** Ordered rows (swap + ad bands) for rendering a layout top-to-bottom. */
export function rowsForLayout(layout) {
  const adRows = layout.bands.map((mode, i) => ({ type: 'ad', mode, which: i === 0 ? 'top' : 'bottom' }))
  if (layout.swap === 'top') return [{ type: 'swap' }, ...adRows]
  if (layout.swap === 'bottom') return [...adRows, { type: 'swap' }]
  return [adRows[0], { type: 'swap' }, adRows[1]]
}

/** Decorative, non-interactive layout thumbnail used on the Step 1 picker cards
 * and the Overview page's placement cards. */
export function MiniMockup({ layout }) {
  const rows = rowsForLayout(layout)
  return (
    <div className="w-full flex flex-col rounded-md overflow-hidden border border-gray-200" style={{ aspectRatio: '4 / 3' }}>
      {rows.map((row, ri) => (
        <div key={ri} style={{ display: 'contents' }}>
          {ri > 0 && <div style={{ height: 2, background: '#1e3a5f', flexShrink: 0 }} />}
          {row.type === 'swap' ? (
            <div style={{ height: '50%', position: 'relative', background: '#1e3a5f' }}>
              <img src={swapUI} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', opacity: 0.35 }} />
            </div>
          ) : (
            <div className="flex" style={{ height: '25%' }}>
              {row.mode === 'full' ? (
                <div className="flex-1" style={{ background: 'rgba(217,165,43,0.35)' }} />
              ) : (
                <>
                  <div className="flex-1" style={{ background: 'rgba(217,165,43,0.35)' }} />
                  <div style={{ width: 2, background: '#1e3a5f' }} />
                  <div className="flex-1" style={{ background: 'rgba(217,165,43,0.35)' }} />
                </>
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

/** The real screen mockup — renders assigned ad media in each panel, swap block in position. */
export function ScreenMockup({ layout, assignments, adsById, interactive, onDrop, onClear, onPanelClick }) {
  const rows = rowsForLayout(layout)
  return (
    <div
      className="mx-auto rounded-lg overflow-hidden shadow-lg flex flex-col"
      style={{ width: '100%', aspectRatio: '1024 / 768', backgroundColor: '#0f172a' }}
    >
      {rows.map((row, ri) => (
        <div key={ri} style={{ display: 'contents' }}>
          {ri > 0 && <div style={{ height: 2, background: '#0f172a', flexShrink: 0 }} />}
          {row.type === 'swap' ? (
            <div style={{ height: '50%', position: 'relative', background: '#fff' }}>
              <img src={swapUI} alt="Swap UI" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              <span className="absolute bottom-1 right-2 text-[10px] font-semibold px-1.5 py-0.5 rounded"
                style={{ background: 'rgba(15,23,42,0.6)', color: '#fff' }}>
                Swap UI
              </span>
            </div>
          ) : (
            <Band
              mode={row.mode}
              which={row.which}
              assignments={assignments}
              adsById={adsById}
              interactive={interactive}
              onDrop={onDrop}
              onClear={onClear}
              onPanelClick={onPanelClick}
            />
          )}
        </div>
      ))}
    </div>
  )
}

function Band({ mode, which, assignments, adsById, interactive, onDrop, onClear, onPanelClick }) {
  if (mode === 'full') {
    return (
      <div className="flex" style={{ height: '25%' }}>
        <Panel slot={`${which}_left`} {...{ assignments, adsById, interactive, onDrop, onClear, onPanelClick }} />
      </div>
    )
  }
  return (
    <div className="flex" style={{ height: '25%' }}>
      <Panel slot={`${which}_left`} {...{ assignments, adsById, interactive, onDrop, onClear, onPanelClick }} />
      <div style={{ width: 2, background: '#0f172a' }} />
      <Panel slot={`${which}_right`} {...{ assignments, adsById, interactive, onDrop, onClear, onPanelClick }} />
    </div>
  )
}

/** A single ad panel — media render (image/video), slot label, and (when interactive)
 * drop-zone + clear-button behavior. */
function Panel({ slot, assignments, adsById, interactive, onDrop, onClear, onPanelClick }) {
  const [dragOver, setDragOver] = useState(false)
  const adId = assignments[slot]
  const ad = adId != null ? adsById[adId] : null

  return (
    <div
      className="flex-1 relative overflow-hidden"
      style={{
        background: ad ? '#000' : '#1e293b',
        outline: dragOver ? '2px dashed #d9a52b' : 'none',
        outlineOffset: -2,
        cursor: interactive ? 'pointer' : 'default',
      }}
      onDragOver={interactive ? (e) => { e.preventDefault(); setDragOver(true) } : undefined}
      onDragLeave={interactive ? () => setDragOver(false) : undefined}
      onDrop={interactive ? (e) => {
        e.preventDefault()
        setDragOver(false)
        const id = Number(e.dataTransfer.getData('text/plain'))
        if (id) onDrop(slot, id)
      } : undefined}
      onClick={interactive ? () => onPanelClick(slot) : undefined}
    >
      {ad ? (
        <>
          {(() => {
            const notLive = ad.is_live === false
            const dim = notLive ? { filter: 'grayscale(1) brightness(0.5)' } : {}
            // Stretch to fill the panel (no crop, no bars) — matches the intended
            // on-screen fit; far-off-ratio media looks distorted, which is accepted.
            return ad.media_type === 'video' ? (
              <video src={ad.url} muted autoPlay loop playsInline
                style={{ width: '100%', height: '100%', objectFit: 'fill', ...dim }} />
            ) : (
              <img src={ad.url} alt={ad.title}
                style={{ width: '100%', height: '100%', objectFit: 'fill', ...dim }} />
            )
          })()}
          {ad.is_live === false && (() => {
            const meta = {
              expired: { label: 'Expired', bg: 'rgba(220,38,38,0.9)' },
              scheduled: { label: 'Scheduled', bg: 'rgba(37,99,235,0.9)' },
              paused: { label: 'Paused', bg: 'rgba(75,85,99,0.9)' },
              out_of_hours: { label: 'Outside hours', bg: 'rgba(75,85,99,0.9)' },
            }[ad.play_state] || { label: 'Not playing', bg: 'rgba(75,85,99,0.9)' }
            return (
              <span className="absolute inset-0 flex items-center justify-center">
                <span className="text-[10px] font-bold px-2 py-1 rounded" style={{ background: meta.bg, color: '#fff' }}>
                  {meta.label}
                </span>
              </span>
            )
          })()}
          <span className="absolute top-1 left-1 text-[9px] font-semibold px-1.5 py-0.5 rounded"
            style={{ background: 'rgba(15,23,42,0.7)', color: '#fff' }}>
            {SLOT_LABELS[slot]}
          </span>
          {interactive && (
            <button
              onClick={(e) => { e.stopPropagation(); onClear(slot) }}
              className="absolute top-1 right-1 w-5 h-5 rounded-full bg-black/60 hover:bg-black/80 text-white flex items-center justify-center text-xs leading-none"
              aria-label="Remove"
            >
              ×
            </button>
          )}
        </>
      ) : (
        <div className="flex flex-col items-center justify-center h-full gap-0.5">
          <span style={{ fontSize: 10, color: '#64748b', fontWeight: 600 }}>{SLOT_LABELS[slot]}</span>
          {interactive && <span style={{ fontSize: 9, color: '#475569' }}>drop ad here</span>}
        </div>
      )}
    </div>
  )
}
