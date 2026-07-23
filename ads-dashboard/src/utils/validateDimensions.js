// Ad panels are 512x192 (split) / 1024x192 (full). Any aspect ratio is accepted and
// scaled to fill the panel; we only enforce a minimum size so a tiny image doesn't
// upscale into a blurry mess. Keep these numbers in sync with AD_PANEL_W / AD_PANEL_H
// in ads/views.py.
export const AD_PANEL_W = 512
export const AD_PANEL_H = 192
export const AD_SPEC_HINT = 'Any image/video, min 512×192 — it will be scaled to fill the panel.'

function checkRule(width, height) {
  if (!width || !height) return 'Could not read dimensions.'
  if (width < AD_PANEL_W || height < AD_PANEL_H) return `is ${width}×${height} — minimum size is ${AD_PANEL_W}×${AD_PANEL_H}.`
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
// "is 400×150 — minimum size is 512×192." (caller prefixes the filename).
export default async function validateDimensions(file) {
  const isVideo = file.type.startsWith('video/')
  const { width, height } = isVideo ? await readVideoSize(file) : await readImageSize(file)
  const error = checkRule(width, height)
  return { ok: !error, width, height, error }
}
