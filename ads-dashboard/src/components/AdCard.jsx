import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { useState } from 'react'

export default function AdCard({ ad, onDelete, onToggle, onDurationChange }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: ad.id })

  const [duration, setDuration] = useState(ad.duration_seconds)
  const [editingDuration, setEditingDuration] = useState(false)

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  }

  const isImage = ad.media_type === 'image'

  function handleDurationBlur() {
    setEditingDuration(false)
    if (duration !== ad.duration_seconds) {
      onDurationChange(ad.id, duration)
    }
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`card flex gap-4 items-start group transition-all ${
        isDragging ? 'shadow-2xl ring-2 ring-blue-500' : ''
      } ${!ad.is_active ? 'opacity-50' : ''}`}
    >
      {/* Drag handle */}
      <button
        {...attributes}
        {...listeners}
        className="mt-1 cursor-grab active:cursor-grabbing text-gray-600 hover:text-gray-400 touch-none shrink-0"
        title="Drag to reorder"
      >
        <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
          <path d="M8 6a2 2 0 1 0 0-4 2 2 0 0 0 0 4zm8 0a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM8 14a2 2 0 1 0 0-4 2 2 0 0 0 0 4zm8 0a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM8 22a2 2 0 1 0 0-4 2 2 0 0 0 0 4zm8 0a2 2 0 1 0 0-4 2 2 0 0 0 0 4z"/>
        </svg>
      </button>

      {/* Thumbnail */}
      <div className="w-28 h-20 rounded-lg overflow-hidden bg-gray-800 shrink-0 relative">
        {isImage ? (
          <img
            src={ad.url}
            alt={ad.title}
            className="w-full h-full object-cover"
          />
        ) : (
          <div className="w-full h-full flex flex-col items-center justify-center gap-1">
            <svg className="w-8 h-8 text-blue-400" fill="currentColor" viewBox="0 0 24 24">
              <path d="M8 5v14l11-7z"/>
            </svg>
            <span className="text-xs text-gray-400">VIDEO</span>
          </div>
        )}
        {/* Type badge */}
        <span className={`absolute top-1 right-1 text-xs px-1.5 py-0.5 rounded font-medium ${
          isImage ? 'bg-green-900/80 text-green-300' : 'bg-blue-900/80 text-blue-300'
        }`}>
          {isImage ? 'IMG' : 'VID'}
        </span>
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <p className="font-semibold text-white truncate">{ad.title}</p>
        <p className="text-xs text-gray-500 mt-0.5">
          Uploaded: {new Date(ad.uploaded_at).toLocaleDateString()}
        </p>

        {/* Duration (images only) */}
        {isImage && (
          <div className="mt-2 flex items-center gap-2">
            <span className="text-xs text-gray-400">Duration:</span>
            {editingDuration ? (
              <input
                type="number"
                min={1}
                max={300}
                value={duration}
                onChange={(e) => setDuration(Number(e.target.value))}
                onBlur={handleDurationBlur}
                onKeyDown={(e) => e.key === 'Enter' && handleDurationBlur()}
                className="w-16 bg-gray-700 border border-gray-500 text-white rounded px-2 py-0.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
                autoFocus
              />
            ) : (
              <button
                onClick={() => setEditingDuration(true)}
                className="text-sm text-blue-400 hover:text-blue-300 underline decoration-dotted"
                title="Click to edit"
              >
                {duration}s
              </button>
            )}
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="flex flex-col gap-2 shrink-0">
        {/* Active toggle */}
        <button
          onClick={() => onToggle(ad.id, !ad.is_active)}
          className={`text-xs px-2.5 py-1 rounded-full font-medium border transition-colors ${
            ad.is_active
              ? 'border-green-600 text-green-400 hover:bg-green-900/30'
              : 'border-gray-600 text-gray-500 hover:bg-gray-700'
          }`}
          title={ad.is_active ? 'Click to deactivate' : 'Click to activate'}
        >
          {ad.is_active ? 'Active' : 'Inactive'}
        </button>

        {/* Delete */}
        <button
          onClick={() => onDelete(ad.id)}
          className="btn-danger text-xs"
          title="Delete ad"
        >
          Delete
        </button>
      </div>
    </div>
  )
}
