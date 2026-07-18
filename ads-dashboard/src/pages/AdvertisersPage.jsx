import { useEffect, useState, useCallback } from 'react'
import api from '../api.js'

const STATUS_BADGE = {
  active: { label: 'Active', cls: 'border-green-300 bg-green-50 text-green-700' },
  expiring_soon: { label: 'Expiring soon', cls: 'border-amber-300 bg-amber-50 text-amber-700' },
  expired: { label: 'Expired', cls: 'border-red-300 bg-red-50 text-red-700' },
  none: { label: 'No contract', cls: 'border-gray-200 bg-gray-50 text-gray-500' },
}

const EMPTY_FORM = {
  name: '', contact_person: '', phone: '', email: '',
  contract_start: '', contract_end: '', notes: '',
}

export default function AdvertisersPage() {
  const [advertisers, setAdvertisers] = useState([])
  const [loading, setLoading] = useState(true)
  const [toast, setToast] = useState(null)
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState(null) // advertiser being edited, or null for create
  const [form, setForm] = useState(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')

  function showToast(message, type = 'success') {
    setToast({ message, type })
    setTimeout(() => setToast(null), 3500)
  }

  const fetchAdvertisers = useCallback(async () => {
    try {
      const { data } = await api.get('/advertisers/')
      setAdvertisers(data)
    } catch {
      showToast('Failed to load advertisers.', 'error')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchAdvertisers() }, [fetchAdvertisers])

  function openCreate() {
    setEditing(null)
    setForm(EMPTY_FORM)
    setFormError('')
    setModalOpen(true)
  }

  function openEdit(a) {
    setEditing(a)
    setForm({
      name: a.name || '',
      contact_person: a.contact_person || '',
      phone: a.phone || '',
      email: a.email || '',
      contract_start: a.contract_start || '',
      contract_end: a.contract_end || '',
      notes: a.notes || '',
    })
    setFormError('')
    setModalOpen(true)
  }

  function closeModal() {
    setModalOpen(false)
    setEditing(null)
  }

  async function handleSubmit(e) {
    e.preventDefault()
    if (!form.name.trim()) {
      setFormError('Name is required.')
      return
    }
    setSaving(true)
    setFormError('')
    try {
      if (editing) {
        const { data } = await api.patch(`/advertisers/${editing.id}/`, form)
        setAdvertisers((prev) => prev.map((a) => a.id === data.id ? data : a))
        showToast('Advertiser updated.')
      } else {
        const { data } = await api.post('/advertisers/', form)
        setAdvertisers((prev) => [...prev, data].sort((a, b) => a.name.localeCompare(b.name)))
        showToast('Advertiser added.')
      }
      closeModal()
    } catch (err) {
      setFormError(err.response?.data?.error || 'Failed to save advertiser.')
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(a) {
    if (!window.confirm(`Delete advertiser "${a.name}"? Ads and placements keep running, unlinked from this client.`)) return
    try {
      await api.delete(`/advertisers/${a.id}/`)
      setAdvertisers((prev) => prev.filter((x) => x.id !== a.id))
      showToast('Advertiser deleted.')
    } catch {
      showToast('Failed to delete advertiser.', 'error')
    }
  }

  function fmtDate(d) {
    if (!d) return '—'
    return new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
  }

  return (
    <div className="flex-1 p-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-800">Advertisers</h1>
          <p className="text-sm text-gray-500 mt-0.5">{advertisers.length} client{advertisers.length === 1 ? '' : 's'}</p>
        </div>
        <button
          onClick={openCreate}
          className="btn-primary flex items-center gap-2"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          Add Advertiser
        </button>
      </div>

      {loading ? (
        <div className="flex justify-center py-20">
          <div className="w-10 h-10 border-4 border-[#1e3a5f] border-t-transparent rounded-full animate-spin" />
        </div>
      ) : advertisers.length === 0 ? (
        <div className="text-center py-20 text-gray-400">
          <svg className="w-14 h-14 mx-auto mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.2}
              d="M17 20h5v-2a4 4 0 00-3-3.87M9 20H4v-2a4 4 0 013-3.87m6-4.13a4 4 0 10-4-4 4 4 0 004 4zm6 0a4 4 0 10-4-4" />
          </svg>
          <p className="font-semibold text-gray-500">No advertisers yet.</p>
          <p className="text-sm mt-1">Add your first client above.</p>
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-gray-500 border-b border-gray-200" style={{ backgroundColor: '#f8fafc' }}>
                <th className="px-4 py-3 font-semibold">Name</th>
                <th className="px-4 py-3 font-semibold">Contact</th>
                <th className="px-4 py-3 font-semibold">Contract period</th>
                <th className="px-4 py-3 font-semibold">Ads</th>
                <th className="px-4 py-3 font-semibold">Placements</th>
                <th className="px-4 py-3 font-semibold">Status</th>
                <th className="px-4 py-3 font-semibold text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {advertisers.map((a) => {
                const badge = STATUS_BADGE[a.contract_status] || STATUS_BADGE.none
                return (
                  <tr key={a.id} className="border-b border-gray-100 hover:bg-gray-50">
                    <td className="px-4 py-3 font-semibold text-gray-800">{a.name}</td>
                    <td className="px-4 py-3 text-gray-600">
                      <div>{a.contact_person || '—'}</div>
                      <div className="text-xs text-gray-400">{[a.phone, a.email].filter(Boolean).join(' · ')}</div>
                    </td>
                    <td className="px-4 py-3 text-gray-600">
                      {a.contract_start || a.contract_end
                        ? `${fmtDate(a.contract_start)} – ${fmtDate(a.contract_end)}`
                        : '—'}
                    </td>
                    <td className="px-4 py-3 text-gray-600">{a.ad_count}</td>
                    <td className="px-4 py-3 text-gray-600">{a.placement_count}</td>
                    <td className="px-4 py-3">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-semibold border ${badge.cls}`}>
                        {badge.label}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          onClick={() => openEdit(a)}
                          className="w-8 h-8 rounded-full bg-gray-50 hover:bg-[#1e3a5f]/10 text-gray-400 hover:text-[#1e3a5f] flex items-center justify-center transition-colors"
                          aria-label="Edit advertiser"
                          title="Edit"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                              d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                          </svg>
                        </button>
                        <button
                          onClick={() => handleDelete(a)}
                          className="w-8 h-8 rounded-full bg-gray-50 hover:bg-red-50 text-gray-400 hover:text-red-600 flex items-center justify-center transition-colors"
                          aria-label="Delete advertiser"
                          title="Delete"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                              d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                          </svg>
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {modalOpen && (
        <div
          className="fixed inset-0 flex items-center justify-center p-6 z-50"
          style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}
          onClick={closeModal}
        >
          <div
            className="bg-white rounded-2xl p-6 w-full max-w-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-lg font-bold text-gray-800 mb-4">
              {editing ? 'Edit Advertiser' : 'Add Advertiser'}
            </h2>
            <form onSubmit={handleSubmit} className="space-y-3">
              <div>
                <label className="block text-xs font-semibold text-gray-500 mb-1">Name *</label>
                <input
                  type="text"
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]/30"
                  autoFocus
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-gray-500 mb-1">Contact Person</label>
                  <input
                    type="text"
                    value={form.contact_person}
                    onChange={(e) => setForm((f) => ({ ...f, contact_person: e.target.value }))}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]/30"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-500 mb-1">Phone</label>
                  <input
                    type="text"
                    value={form.phone}
                    onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]/30"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-500 mb-1">Email</label>
                <input
                  type="email"
                  value={form.email}
                  onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]/30"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-gray-500 mb-1">Contract Start</label>
                  <input
                    type="date"
                    value={form.contract_start}
                    onChange={(e) => setForm((f) => ({ ...f, contract_start: e.target.value }))}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]/30"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-500 mb-1">Contract End</label>
                  <input
                    type="date"
                    value={form.contract_end}
                    onChange={(e) => setForm((f) => ({ ...f, contract_end: e.target.value }))}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]/30"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-500 mb-1">Notes</label>
                <textarea
                  value={form.notes}
                  onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                  rows={3}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]/30"
                />
              </div>

              {formError && <p className="text-xs text-red-600">{formError}</p>}

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={closeModal}
                  className="px-4 py-2 rounded-xl border-2 border-gray-200 text-sm font-semibold text-gray-500 hover:bg-gray-50 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="px-5 py-2 rounded-xl bg-[#1e3a5f] text-white text-sm font-semibold hover:bg-[#162d4a] disabled:opacity-50 transition-colors"
                >
                  {saving ? 'Saving…' : editing ? 'Save Changes' : 'Add Advertiser'}
                </button>
              </div>
            </form>
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
