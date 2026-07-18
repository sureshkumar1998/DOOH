import { useCallback } from 'react'

export default function UploadZone({ onUpload, uploading }) {
  const handleDrop = useCallback(
    (e) => {
      e.preventDefault()
      const files = Array.from(e.dataTransfer.files)
      if (files.length) onUpload(files)
    },
    [onUpload]
  )

  const handleFileInput = (e) => {
    const files = Array.from(e.target.files)
    if (files.length) onUpload(files)
    e.target.value = ''
  }

  return (
    <div
      onDrop={handleDrop}
      onDragOver={(e) => e.preventDefault()}
      className="border-2 border-dashed border-gray-600 hover:border-blue-500 rounded-xl p-8 text-center transition-colors cursor-pointer group"
      onClick={() => document.getElementById('file-input').click()}
    >
      <input
        id="file-input"
        type="file"
        className="hidden"
        multiple
        accept="image/jpeg,image/png,image/gif,image/webp,video/mp4,video/webm"
        onChange={handleFileInput}
      />

      {uploading ? (
        <div className="flex flex-col items-center gap-3">
          <div className="w-10 h-10 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
          <p className="text-gray-300 font-medium">Uploading...</p>
        </div>
      ) : (
        <div className="flex flex-col items-center gap-3">
          <div className="w-14 h-14 rounded-full bg-gray-800 group-hover:bg-blue-900/30 flex items-center justify-center transition-colors">
            <svg className="w-7 h-7 text-gray-400 group-hover:text-blue-400 transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
            </svg>
          </div>
          <div>
            <p className="text-gray-200 font-medium group-hover:text-white transition-colors">
              Drop files here or <span className="text-blue-400">browse</span>
            </p>
            <p className="text-gray-500 text-sm mt-1">
              Images (JPG, PNG, GIF, WEBP) · Videos (MP4, WEBM) · Max 200MB each
            </p>
          </div>
        </div>
      )}
    </div>
  )
}
