import { useEffect, useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import api from '../api.js'
import UploadZone from '../components/UploadZone.jsx'
import AdCard from '../components/AdCard.jsx'

export default function Dashboard() {
  const [ads, setAds] = useState([])
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [toast, setToast] = useState(null)
  const navigate = useNavigate()

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )

  function showToast(message, type = 'success') {
    setToast({ message, type })
    setTimeout(() => setToast(null), 3500)
  }

  const fetchAds = useCallback(async () => {
    try {
      const { data } = await api.get('/ads/')
      setAds(data)
    } catch (err) {
      if (err.response?.status === 401) navigate('/login')
    } finally {
      setLoading(false)
    }
  }, [navigate])

  useEffect(() => {
    fetchAds()
  }, [fetchAds])

  async function handleUpload(files) {
    setUploading(true)
    let successCount = 0
    let errorMessages = []

    for (const file of files) {
      const formData = new FormData()
      formData.append('file', file)
      formData.append('title', file.name.replace(/\.[^.]+$/, ''))
      formData.append('duration_seconds', '10')
      formData.append('order', String(ads.length + successCount))
      try {
        await api.post('/upload/', formData, {
          headers: { 'Content-Type': 'multipart/form-data' },
        })
        successCount++
      } catch (err) {
        errorMessages.push(err.response?.data?.error || `Failed: ${file.name}`)
      }
    }

    setUploading(false)
    await fetchAds()

    if (successCount > 0) showToast(`${successCount} file(s) uploaded successfully.`)
    if (errorMessages.length > 0) showToast(errorMessages.join(' | '), 'error')
  }

  async function handleDelete(id) {
    if (!window.confirm('Delete this ad? This cannot be undone.')) return
    try {
      await api.delete(`/ads/${id}/`)
      setAds((prev) => prev.filter((a) => a.id !== id))
      showToast('Ad deleted.')
    } catch {
      showToast('Failed to delete.', 'error')
    }
  }

  async function handleToggle(id, isActive) {
    try {
      const { data } = await api.patch(`/ads/${id}/`, { is_active: isActive })
      setAds((prev) => prev.map((a) => (a.id === id ? data : a)))
    } catch {
      showToast('Failed to update.', 'error')
    }
  }

  async function handleDurationChange(id, duration) {
    try {
      const { data } = await api.patch(`/ads/${id}/`, { duration_seconds: duration })
      setAds((prev) => prev.map((a) => (a.id === id ? data : a)))
      showToast('Duration updated.')
    } catch {
      showToast('Failed to update duration.', 'error')
    }
  }

  async function handleDragEnd(event) {
    const { active, over } = event
    if (!over || active.id === over.id) return

    const oldIndex = ads.findIndex((a) => a.id === active.id)
    const newIndex = ads.findIndex((a) => a.id === over.id)
    const reordered = arrayMove(ads, oldIndex, newIndex)
    setAds(reordered)

    // Persist order
    const payload = reordered.map((ad, idx) => ({ id: ad.id, order: idx }))
    try {
      await api.post('/ads/reorder/', payload)
    } catch {
      showToast('Failed to save order.', 'error')
      fetchAds() // rollback
    }
  }

  function handleLogout() {
    localStorage.removeItem('access_token')
    localStorage.removeItem('refresh_token')
    navigate('/login')
  }

  const activeCount = ads.filter((a) => a.is_active).length

  return (
    <div className="min-h-screen bg-gray-950">
      {/* Navbar */}
      <header className="bg-gray-900 border-b border-gray-800 px-6 py-4">
        <div className="max-w-4xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-blue-600 flex items-center justify-center">
              <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
              </svg>
            </div>
            <div>
              <h1 className="font-bold text-white leading-tight">Ads Dashboard</h1>
              <p className="text-xs text-gray-500">
                {activeCount} active · {ads.length} total
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {/* API Hint */}
            <a
              href="/api/playlist/"
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-blue-400 hover:underline hidden sm:block"
              title="Open playlist API"
            >
              /api/playlist/
            </a>
            <button onClick={handleLogout} className="btn-secondary text-sm">
              Logout
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-6 py-8 space-y-8">
        {/* Upload zone */}
        <section>
          <h2 className="text-lg font-semibold text-gray-100 mb-3">Upload Ads</h2>
          <UploadZone onUpload={handleUpload} uploading={uploading} />
        </section>

        {/* Ad list */}
        <section>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-lg font-semibold text-gray-100">
              All Ads
              {ads.length > 0 && (
                <span className="ml-2 text-sm font-normal text-gray-500">
                  — drag to reorder
                </span>
              )}
            </h2>
          </div>

          {loading ? (
            <div className="flex justify-center py-16">
              <div className="w-10 h-10 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : ads.length === 0 ? (
            <div className="text-center py-16 text-gray-600">
              <svg className="w-12 h-12 mx-auto mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                  d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
              <p className="font-medium">No ads yet</p>
              <p className="text-sm mt-1">Upload your first image or video above</p>
            </div>
          ) : (
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={handleDragEnd}
            >
              <SortableContext items={ads.map((a) => a.id)} strategy={verticalListSortingStrategy}>
                <div className="space-y-3">
                  {ads.map((ad) => (
                    <AdCard
                      key={ad.id}
                      ad={ad}
                      onDelete={handleDelete}
                      onToggle={handleToggle}
                      onDurationChange={handleDurationChange}
                    />
                  ))}
                </div>
              </SortableContext>
            </DndContext>
          )}
        </section>

        {/* CCU Integration Info */}
        {ads.length > 0 && (
          <section className="card bg-gray-900/50">
            <h3 className="font-semibold text-gray-300 mb-2 flex items-center gap-2">
              <svg className="w-4 h-4 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
              CCU Integration
            </h3>
            <p className="text-sm text-gray-500 mb-2">
              Your display system should poll this endpoint every 30 seconds:
            </p>
            <code className="block bg-gray-800 rounded-lg px-3 py-2 text-green-400 text-sm font-mono break-all">
              GET http://&lt;this-machine-ip&gt;:8000/api/playlist/
            </code>
          </section>
        )}
      </main>

      {/* Toast notification */}
      {toast && (
        <div className={`fixed bottom-6 right-6 px-4 py-3 rounded-xl shadow-2xl text-sm font-medium transition-all ${
          toast.type === 'error'
            ? 'bg-red-900 border border-red-700 text-red-200'
            : 'bg-green-900 border border-green-700 text-green-200'
        }`}>
          {toast.message}
        </div>
      )}
    </div>
  )
}
