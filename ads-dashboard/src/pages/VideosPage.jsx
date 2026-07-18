import { useEffect, useState, useCallback, useRef } from 'react'
import api from '../api.js'
import validateDimensions, { AD_SPEC_HINT } from '../utils/validateDimensions.js'

export default function VideosPage() {
  const role = localStorage.getItem('role') || 'admin'
  const [videos, setVideos] = useState([])
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

  const fetchVideos = useCallback(async () => {
    try {
      const { data } = await api.get('/ads/')
      setVideos(data.filter((a) => a.media_type === 'video'))
    } catch {
      showToast('Failed to load videos.', 'error')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchVideos() }, [fetchVideos])

  useEffect(() => {
    api.get('/advertisers/').then(({ data }) => setAdvertisers(data)).catch(() => {})
  }, [])

  const displayedVideos = clientFilter
    ? videos.filter((v) => String(v.advertiser || '') === clientFilter)
    : videos

  async function handleFiles(files) {
    if (!uploadAdvertiserId) { showToast('Select a client before uploading.', 'error'); return }
    const videoFiles = Array.from(files).filter((f) => f.type.startsWith('video/'))
    if (!videoFiles.length) { showToast('Please select video files only.', 'error'); return }
    const valid = []
    for (const f of videoFiles) {
      const { ok, error } = await validateDimensions(f)
      if (ok) valid.push(f)
      else showToast(`${f.name} ${error}`, 'error')
    }
    if (!valid.length) return
    await uploadFiles(valid)
  }

  async function uploadFiles(files) {
    setUploading(true)
    const progress = files.map((f) => ({ name: f.name, size: f.size, pct: 0, done: false, error: null }))
    setUploadProgress(progress)

    for (let i = 0; i < files.length; i++) {
      const file = files[i]
      const form = new FormData()
      form.append('file', file)
      form.append('title', file.name.replace(/\.[^.]+$/, ''))
      form.append('duration_seconds', '30')
      form.append('order', String(videos.length + i))
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

    await fetchVideos()
    showToast('Upload complete.')
    setTimeout(() => { setUploading(false); setUploadProgress([]) }, 1500)
  }

  async function handleDelete(id) {
    if (!window.confirm('Delete this video?')) return
    try {
      await api.delete(`/ads/${id}/`)
      setVideos((prev) => prev.filter((a) => a.id !== id))
      showToast('Video deleted.')
    } catch { showToast('Failed to delete.', 'error') }
  }

  async function handleToggle(id, isActive) {
    try {
      const { data } = await api.patch(`/ads/${id}/`, { is_active: isActive })
      setVideos((prev) => prev.map((a) => a.id === id ? data : a))
    } catch { showToast('Failed to update.', 'error') }
  }

  async function handleApprove(id) {
    try {
      const { data } = await api.patch(`/ads/${id}/`, { status: 'approved' })
      setVideos((prev) => prev.map((a) => a.id === id ? data : a))
      showToast('Video approved.')
    } catch { showToast('Failed to approve.', 'error') }
  }

  return (
    <div className="flex-1 p-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-800">Videos</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {videos.filter(v => v.is_active).length} active · {videos.length} total
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
            Upload Videos
          </button>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept="video/mp4,video/webm,video/quicktime"
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
          <p className="text-xs text-gray-400">MP4, WEBM, MOV · Max 200MB each</p>
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

      {/* Video list */}
      {loading ? (
        <div className="flex justify-center py-20">
          <div className="w-10 h-10 border-4 border-[#1e3a5f] border-t-transparent rounded-full animate-spin" />
        </div>
      ) : videos.length === 0 ? (
        <div className="text-center py-20 text-gray-400">
          <svg className="w-14 h-14 mx-auto mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.2}
              d="M15 10l4.553-2.276A1 1 0 0121 8.723v6.554a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
          </svg>
          <p className="font-semibold text-gray-500">No videos yet</p>
          <p className="text-sm mt-1">Upload your first video above</p>
        </div>
      ) : displayedVideos.length === 0 ? (
        <div className="text-center py-20 text-gray-400">
          <p className="font-semibold text-gray-500">No videos match this client filter.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {displayedVideos.map((vid) => (
            <VideoRow key={vid.id} vid={vid} role={role} onDelete={handleDelete} onToggle={handleToggle} onApprove={handleApprove} />
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

function VideoRow({ vid, role, onDelete, onToggle, onApprove }) {
  const isPending = vid.status === 'pending'
  return (
    <div className={`bg-white border border-gray-200 rounded-2xl shadow-sm transition-all ${!vid.is_active ? 'opacity-60' : ''}`}>
      <div className="p-4 flex items-center gap-4">
        {/* Thumb */}
        <div className="w-20 h-14 rounded-xl bg-gray-900 flex items-center justify-center shrink-0 overflow-hidden">
          <video src={vid.url} className="w-full h-full object-cover" muted preload="metadata" />
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-gray-800 truncate">{vid.title}</p>
          <div className="flex flex-wrap items-center gap-1.5 mt-1">
            <span className={`text-xs px-2 py-0.5 rounded-full font-semibold border ${
              vid.is_active ? 'border-green-300 bg-green-50 text-green-700' : 'border-gray-200 bg-gray-50 text-gray-500'
            }`}>
              {vid.is_active ? 'Active' : 'Paused'}
            </span>
            <span className={`text-xs px-2 py-0.5 rounded-full font-semibold border ${
              isPending ? 'border-amber-300 bg-amber-50 text-amber-700' : 'border-green-300 bg-green-50 text-green-700'
            }`}>
              {isPending ? 'Pending' : 'Approved'}
            </span>
            {vid.advertiser_name && (
              <span className="text-xs px-2 py-0.5 rounded-full font-semibold bg-[#1e3a5f]/10 text-[#1e3a5f]">
                {vid.advertiser_name}
              </span>
            )}
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2 shrink-0">
          {isPending && role === 'admin' && (
            <button
              onClick={() => onApprove(vid.id)}
              className="text-xs px-3 py-1.5 rounded-full font-semibold border border-green-300 bg-green-50 text-green-700 hover:bg-green-100 transition-colors"
            >
              Approve
            </button>
          )}
          <button
            onClick={() => onToggle(vid.id, !vid.is_active)}
            className={`text-xs px-3 py-1.5 rounded-full font-semibold border transition-colors ${
              vid.is_active
                ? 'border-green-300 bg-green-50 text-green-700 hover:bg-green-100'
                : 'border-gray-200 bg-gray-50 text-gray-500 hover:bg-gray-100'
            }`}
          >
            {vid.is_active ? 'Active' : 'Inactive'}
          </button>
          <button
            onClick={() => onDelete(vid.id)}
            className="text-xs px-3 py-1.5 rounded-full font-semibold border border-red-200 bg-red-50 text-red-600 hover:bg-red-100 transition-colors"
          >
            Delete
          </button>
        </div>
      </div>
    </div>
  )
}
