import { useEffect, useState, useCallback, useRef } from 'react'
import api from '../api.js'
import validateDimensions, { AD_SPEC_HINT } from '../utils/validateDimensions.js'

export default function ImagesPage() {
  const role = localStorage.getItem('role') || 'admin'
  const [images, setImages] = useState([])
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [uploadProgress, setUploadProgress] = useState([])
  const [toast, setToast] = useState(null)
  const [dragging, setDragging] = useState(false)
  const [advertisers, setAdvertisers] = useState([])
  const [uploadAdvertiserId, setUploadAdvertiserId] = useState('')
  const [clientFilter, setClientFilter] = useState('')
  const fileInputRef = useRef()

  function showToast(message, type = 'success') {
    setToast({ message, type })
    setTimeout(() => setToast(null), 3500)
  }

  const fetchImages = useCallback(async () => {
    try {
      const { data } = await api.get('/ads/')
      setImages(data.filter((a) => a.media_type === 'image'))
    } catch {
      showToast('Failed to load images.', 'error')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchImages() }, [fetchImages])

  useEffect(() => {
    api.get('/advertisers/').then(({ data }) => setAdvertisers(data)).catch(() => {})
  }, [])

  const displayedImages = clientFilter
    ? images.filter((i) => String(i.advertiser || '') === clientFilter)
    : images

  async function handleFiles(files) {
    if (!uploadAdvertiserId) { showToast('Select a client before uploading.', 'error'); return }
    const imageFiles = Array.from(files).filter((f) => f.type.startsWith('image/'))
    if (!imageFiles.length) { showToast('Please select image files only.', 'error'); return }
    const valid = []
    for (const f of imageFiles) {
      const { ok, error } = await validateDimensions(f)
      if (ok) valid.push(f)
      else showToast(`${f.name} ${error}`, 'error')
    }
    if (!valid.length) return
    await uploadFiles(valid)
  }

  async function uploadFiles(files) {
    setUploading(true)
    const progress = files.map((f) => ({ name: f.name, pct: 0, done: false, error: null }))
    setUploadProgress(progress)

    for (let i = 0; i < files.length; i++) {
      const file = files[i]
      const form = new FormData()
      form.append('file', file)
      form.append('title', file.name.replace(/\.[^.]+$/, ''))
      form.append('duration_seconds', '10')
      form.append('order', String(images.length + i))
      if (uploadAdvertiserId) form.append('advertiser', uploadAdvertiserId)

      try {
        await api.post('/upload/', form, {
          headers: { 'Content-Type': 'multipart/form-data' },
          onUploadProgress: (e) => {
            const pct = Math.round((e.loaded * 100) / e.total)
            setUploadProgress((prev) => prev.map((p, idx) => idx === i ? { ...p, pct } : p))
          },
        })
        setUploadProgress((prev) => prev.map((p, idx) => idx === i ? { ...p, pct: 100, done: true } : p))
      } catch (err) {
        const msg = err.response?.data?.error || 'Upload failed'
        setUploadProgress((prev) => prev.map((p, idx) => idx === i ? { ...p, error: msg } : p))
      }
    }

    await fetchImages()
    showToast('Upload complete.')
    setTimeout(() => { setUploading(false); setUploadProgress([]) }, 1500)
  }

  async function handleDelete(id) {
    if (!window.confirm('Delete this image?')) return
    try {
      await api.delete(`/ads/${id}/`)
      setImages((prev) => prev.filter((a) => a.id !== id))
      showToast('Image deleted.')
    } catch { showToast('Failed to delete.', 'error') }
  }

  async function handleToggle(id, isActive) {
    try {
      const { data } = await api.patch(`/ads/${id}/`, { is_active: isActive })
      setImages((prev) => prev.map((a) => a.id === id ? data : a))
    } catch { showToast('Failed to update.', 'error') }
  }

  async function handleDuration(id, val) {
    try {
      const { data } = await api.patch(`/ads/${id}/`, { duration_seconds: val })
      setImages((prev) => prev.map((a) => a.id === id ? data : a))
      showToast('Duration saved.')
    } catch { showToast('Failed to update.', 'error') }
  }

  async function handleApprove(id) {
    try {
      const { data } = await api.patch(`/ads/${id}/`, { status: 'approved' })
      setImages((prev) => prev.map((a) => a.id === id ? data : a))
      showToast('Image approved.')
    } catch { showToast('Failed to approve.', 'error') }
  }

  return (
    <div className="flex-1 p-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-800">Images</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {images.filter(i => i.is_active).length} active · {images.length} total
          </p>
          <p className="text-xs mt-1 font-medium" style={{ color: '#d9a52b' }}>{AD_SPEC_HINT}</p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={uploadAdvertiserId}
            onChange={(e) => setUploadAdvertiserId(e.target.value)}
            className="border border-gray-200 rounded-xl px-3 py-2 text-sm text-gray-600 focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]/30"
          >
            <option value="">— Select client * —</option>
            {advertisers.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
          <button
            onClick={() => fileInputRef.current?.click()}
            className="btn-primary flex items-center gap-2"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            Upload Images
          </button>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept="image/jpeg,image/png,image/gif,image/webp"
          className="hidden"
          onChange={(e) => handleFiles(e.target.files)}
        />
      </div>

      {advertisers.length > 0 && (
        <div className="flex items-center gap-2 mb-4">
          <label className="text-xs font-semibold text-gray-500">Filter by client</label>
          <select
            value={clientFilter}
            onChange={(e) => setClientFilter(e.target.value)}
            className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm text-gray-600 focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]/30"
          >
            <option value="">All clients</option>
            {advertisers.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </div>
      )}

      {/* Drop zone */}
      <div
        onDrop={(e) => { e.preventDefault(); setDragging(false); handleFiles(e.dataTransfer.files) }}
        onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
        onDragLeave={() => setDragging(false)}
        onClick={() => fileInputRef.current?.click()}
        className={`border-2 border-dashed rounded-2xl p-10 text-center cursor-pointer transition-all mb-6 ${
          dragging ? 'border-[#1e3a5f] bg-[#1e3a5f]/5' : 'border-gray-200 bg-white hover:border-[#1e3a5f]/50 hover:bg-[#1e3a5f]/5'
        }`}
      >
        <div className="flex flex-col items-center gap-3">
          <svg className={`w-10 h-10 ${dragging ? 'text-[#1e3a5f]' : 'text-gray-400'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
              d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
          </svg>
          <div>
            <span className="text-[#1e3a5f] font-semibold">Click to upload</span>
            <span className="text-gray-500"> or drag and drop</span>
          </div>
          <p className="text-xs text-gray-400">JPG, PNG, GIF, WEBP · Max 200MB each</p>
        </div>
      </div>

      {/* Upload progress */}
      {uploading && uploadProgress.length > 0 && (
        <div className="bg-white border border-gray-200 rounded-2xl p-4 mb-6 space-y-3 shadow-sm">
          {uploadProgress.map((p, i) => (
            <div key={i}>
              <div className="flex items-center justify-between mb-1">
                <span className="text-sm text-gray-700 font-medium truncate max-w-xs">{p.name}</span>
                <span className="text-sm text-gray-500 font-semibold">{p.pct}%</span>
              </div>
              <div className="w-full bg-gray-100 rounded-full h-2">
                <div
                  className={`h-2 rounded-full transition-all ${p.error ? 'bg-red-400' : 'bg-[#1e3a5f]'}`}
                  style={{ width: `${p.pct}%` }}
                />
              </div>
              {p.error && <p className="text-xs text-red-500 mt-1">{p.error}</p>}
            </div>
          ))}
        </div>
      )}

      {/* Gallery */}
      {loading ? (
        <div className="flex justify-center py-20">
          <div className="w-10 h-10 border-4 border-[#1e3a5f] border-t-transparent rounded-full animate-spin" />
        </div>
      ) : images.length === 0 ? (
        <div className="text-center py-20 text-gray-400">
          <svg className="w-14 h-14 mx-auto mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.2}
              d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
          </svg>
          <p className="font-semibold text-gray-500">No images yet</p>
          <p className="text-sm mt-1">Upload your first image above</p>
        </div>
      ) : displayedImages.length === 0 ? (
        <div className="text-center py-20 text-gray-400">
          <p className="font-semibold text-gray-500">No images match this client filter.</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
          {displayedImages.map((img) => (
            <ImageCard
              key={img.id}
              img={img}
              role={role}
              onDelete={handleDelete}
              onToggle={handleToggle}
              onDuration={handleDuration}
              onApprove={handleApprove}
            />
          ))}
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

function ImageCard({ img, role, onDelete, onToggle, onDuration, onApprove }) {
  const [editingDur, setEditingDur] = useState(false)
  const [dur, setDur] = useState(img.duration_seconds)
  const isPending = img.status === 'pending'

  return (
    <div className={`bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden group transition-all hover:shadow-md ${!img.is_active ? 'opacity-60' : ''}`}>
      <div className="relative aspect-video bg-gray-100 overflow-hidden">
        <img src={img.url} alt={img.title} className="w-full h-full object-cover" />
        <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
          <button
            onClick={() => onToggle(img.id, !img.is_active)}
            className="bg-white/90 hover:bg-white text-gray-700 rounded-lg px-2.5 py-1 text-xs font-semibold transition"
          >
            {img.is_active ? 'Pause' : 'Resume'}
          </button>
          <button
            onClick={() => onDelete(img.id)}
            className="bg-red-500/90 hover:bg-red-600 text-white rounded-lg px-2.5 py-1 text-xs font-semibold transition"
          >
            Delete
          </button>
        </div>
        <div className="absolute top-1.5 left-1.5 flex flex-col gap-1 items-start">
          <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full border ${
            isPending ? 'border-amber-300 bg-amber-50 text-amber-700' : 'border-green-300 bg-green-50 text-green-700'
          }`}>
            {isPending ? 'Pending' : 'Approved'}
          </span>
          {img.advertiser_name && (
            <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-[#1e3a5f]/85 text-white">
              {img.advertiser_name}
            </span>
          )}
        </div>
      </div>

      <div className="px-3 py-2 space-y-1">
        <p className="text-sm font-semibold text-gray-700 truncate">{img.title}</p>

        {/* Duration */}
        <div className="flex items-center justify-between">
          <span className="text-xs text-gray-400">Duration</span>
          {editingDur ? (
            <input
              type="number" min={1} max={300}
              value={dur}
              onChange={(e) => setDur(Number(e.target.value))}
              onBlur={() => { setEditingDur(false); onDuration(img.id, dur) }}
              onKeyDown={(e) => e.key === 'Enter' && e.target.blur()}
              className="w-16 border border-[#1e3a5f]/30 rounded-lg px-1.5 py-0.5 text-xs text-right focus:outline-none focus:ring-1 focus:ring-[#1e3a5f]"
              autoFocus
            />
          ) : (
            <button onClick={() => setEditingDur(true)}
              className="text-xs text-[#1e3a5f] font-semibold hover:underline">
              {dur}s
            </button>
          )}
        </div>

        {isPending && role === 'admin' && (
          <button
            onClick={() => onApprove(img.id)}
            className="w-full mt-1 text-xs font-semibold px-2 py-1.5 rounded-lg bg-green-50 text-green-700 border border-green-300 hover:bg-green-100 transition-colors"
          >
            Approve
          </button>
        )}
      </div>
    </div>
  )
}
