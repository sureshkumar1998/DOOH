// Ad panels in the CCU player are fixed 512x192 (8:3). Files must match that ratio
// and be at least panel size, so they render full-bleed (no black bars / no crop).
// Keep these numbers in sync with AD_PANEL_W / AD_PANEL_H / AD_ASPECT in ads/views.py.
export const AD_PANEL_W = 512
export const AD_PANEL_H = 192
export const AD_ASPECT = 8 / 3
export const AD_ASPECT_TOL = 0.02
export const AD_SPEC_HINT = 'Required: 8:3 ratio, min 512×192 (e.g. 512×192 or 1024×384)'

function checkRule(width, height) {
  if (!width || !height) return 'Could not read dimensions.'
  if (width < AD_PANEL_W || height < AD_PANEL_H) return `is ${width}×${height} — minimum size is ${AD_PANEL_W}×${AD_PANEL_H}.`
  if (Math.abs(width / height - AD_ASPECT) > AD_ASPECT_TOL) return `is ${width}×${height} — must be 8:3 aspect (e.g. ${AD_PANEL_W}×${AD_PANEL_H} or 1024×384).`
  return null
}

function readImageSize(file) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => { URL.revokeObjectURL(url); resolve({ width: img.naturalWidth, height: img.naturalHeight }) }
    img.onerror = () => { URL.revokeObjectURL(url); resolve({ width: 0, height: 0 }) }
    img.src = url
  })
}

function readVideoSize(file) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file)
    const video = document.createElement('video')
    video.preload = 'metadata'
    video.onloadedmetadata = () => { URL.revokeObjectURL(url); resolve({ width: video.videoWidth, height: video.videoHeight }) }
    video.onerror = () => { URL.revokeObjectURL(url); resolve({ width: 0, height: 0 }) }
    video.src = url
  })
}

// Returns { ok, width, height, error }. `error` is a phrase like
// "is 1920×1080 — must be 8:3 aspect …" (caller prefixes the filename).
export default async function validateDimensions(file) {
  const isVideo = file.type.startsWith('video/')
  const { width, height } = isVideo ? await readVideoSize(file) : await readImageSize(file)
  const error = checkRule(width, height)
  return { ok: !error, width, height, error }
}
