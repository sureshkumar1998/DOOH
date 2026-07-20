import { useEffect, useState, useCallback } from 'react'
import api from '../api.js'

const ROLE_BADGE = {
  admin: 'bg-[#1e3a5f] text-white',
  operator: 'bg-[#d9a52b] text-white',
}

function fmtDate(d) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
}

export default function UsersPage() {
  const [users, setUsers] = useState([])
  const [loading, setLoading] = useState(true)
  const [toast, setToast] = useState(null)
  const [showAdd, setShowAdd] = useState(false)
  const [resetFor, setResetFor] = useState(null) // user object being password-reset

  const me = localStorage.getItem('username') || ''

  function showToast(message, type = 'success') {
    setToast({ message, type })
    setTimeout(() => setToast(null), 4000)
  }

  const fetchUsers = useCallback(async () => {
    try {
      const { data } = await api.get('/users/')
      setUsers(data)
    } catch {
      showToast('Failed to load users.', 'error')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchUsers() }, [fetchUsers])

  async function handleDelete(u) {
    if (!window.confirm(`Delete user "${u.username}"? This cannot be undone.`)) return
    try {
      await api.delete(`/users/${u.id}/`)
      setUsers((prev) => prev.filter((x) => x.id !== u.id))
      showToast(`User "${u.username}" deleted.`)
    } catch (err) {
      showToast(err.response?.data?.error || 'Failed to delete user.', 'error')
    }
  }

  return (
    <div className="flex-1 p-8 w-full">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-800">Users</h1>
          <p className="text-sm text-gray-500 mt-0.5">Manage admin & operator accounts</p>
        </div>
        <button onClick={() => setShowAdd(true)}
          className="flex items-center gap-2 px-4 py-2 rounded-xl bg-[#1e3a5f] text-white text-sm font-semibold hover:bg-[#162d4a] transition-colors">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          Add User
        </button>
      </div>

      {loading ? (
        <div className="flex justify-center py-20">
          <div className="w-10 h-10 border-4 border-[#1e3a5f] border-t-transparent rounded-full animate-spin" />
        </div>
      ) : (
        <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden shadow-sm max-w-4xl">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-500 text-xs uppercase tracking-wider">
              <tr>
                <th className="text-left px-5 py-3 font-semibold">Username</th>
                <th className="text-left px-5 py-3 font-semibold">Role</th>
                <th className="text-left px-5 py-3 font-semibold">Last login</th>
                <th className="text-right px-5 py-3 font-semibold">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {users.map((u) => (
                <tr key={u.id} className="hover:bg-gray-50">
                  <td className="px-5 py-3 font-semibold text-gray-800">
                    {u.username}
                    {u.username === me && <span className="ml-2 text-[10px] text-gray-400">(you)</span>}
                    {!u.is_active && <span className="ml-2 text-[10px] text-red-500">inactive</span>}
                  </td>
                  <td className="px-5 py-3">
                    <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full capitalize ${ROLE_BADGE[u.role]}`}>
                      {u.role}
                    </span>
                  </td>
                  <td className="px-5 py-3 text-gray-500">{fmtDate(u.last_login)}</td>
                  <td className="px-5 py-3 text-right whitespace-nowrap">
                    <button onClick={() => setResetFor(u)}
                      className="text-xs font-semibold text-[#1e3a5f] hover:underline mr-4">
                      Reset password
                    </button>
                    <button onClick={() => handleDelete(u)}
                      disabled={u.username === me}
                      className="text-xs font-semibold text-red-600 hover:underline disabled:opacity-30 disabled:no-underline disabled:cursor-not-allowed">
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showAdd && (
        <AddUserModal
          onClose={() => setShowAdd(false)}
          onCreated={(u) => { setUsers((prev) => [...prev, u]); setShowAdd(false); showToast(`User "${u.username}" created.`) }}
          onError={(m) => showToast(m, 'error')}
        />
      )}

      {resetFor && (
        <ResetPasswordModal
          user={resetFor}
          onClose={() => setResetFor(null)}
          onDone={() => { setResetFor(null); showToast(`Password updated for "${resetFor.username}".`) }}
          onError={(m) => showToast(m, 'error')}
        />
      )}

      {toast && (
        <div className={`fixed bottom-6 right-6 px-4 py-3 rounded-xl shadow-xl text-sm font-medium ${
          toast.type === 'error' ? 'bg-red-50 border border-red-200 text-red-700' : 'bg-green-50 border border-green-200 text-green-700'
        }`}>{toast.message}</div>
      )}
    </div>
  )
}

function Field({ label, children }) {
  return (
    <div>
      <label className="block text-xs font-bold text-[#1e3a5f] uppercase tracking-wider mb-1.5">{label}</label>
      {children}
    </div>
  )
}

const inputCls = 'w-full border-2 border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-[#1e3a5f] transition-colors'

/** Password input, masked by default, with an eye toggle to reveal it. */
function PasswordInput({ value, onChange, autoFocus }) {
  const [show, setShow] = useState(false)
  return (
    <div className="relative">
      <input
        className={inputCls + ' pr-11'}
        type={show ? 'text' : 'password'}
        value={value}
        onChange={onChange}
        placeholder="min 6 characters"
        required
        autoFocus={autoFocus}
      />
      <button type="button" onClick={() => setShow((s) => !s)}
        className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-[#1e3a5f]"
        aria-label={show ? 'Hide password' : 'Show password'} title={show ? 'Hide' : 'Show'}>
        {show ? (
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8}
              d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
          </svg>
        ) : (
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8}
              d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
          </svg>
        )}
      </button>
    </div>
  )
}

function AddUserModal({ onClose, onCreated, onError }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [role, setRole] = useState('operator')
  const [saving, setSaving] = useState(false)

  async function submit(e) {
    e.preventDefault()
    setSaving(true)
    try {
      const { data } = await api.post('/users/', { username: username.trim(), password, role })
      onCreated(data)
    } catch (err) {
      onError(err.response?.data?.error || 'Failed to create user.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <form onClick={(e) => e.stopPropagation()} onSubmit={submit}
        className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden">
        <div className="bg-[#1e3a5f] px-6 py-4">
          <h2 className="text-white font-bold text-lg">Add User</h2>
        </div>
        <div className="p-6 space-y-4">
          <Field label="Username">
            <input className={inputCls} value={username} onChange={(e) => setUsername(e.target.value)} required autoFocus />
          </Field>
          <Field label="Password">
            <PasswordInput value={password} onChange={(e) => setPassword(e.target.value)} />
          </Field>
          <Field label="Role">
            <select className={inputCls} value={role} onChange={(e) => setRole(e.target.value)}>
              <option value="operator">Operator (view-only: Overview, Monitor, Logs, reports)</option>
              <option value="admin">Admin (full access)</option>
            </select>
          </Field>
          <div className="flex gap-3 pt-1">
            <button type="button" onClick={onClose}
              className="flex-1 py-2.5 rounded-xl border-2 border-gray-200 text-sm font-semibold text-gray-500 hover:bg-gray-50">Cancel</button>
            <button type="submit" disabled={saving}
              className="flex-1 py-2.5 rounded-xl bg-[#1e3a5f] text-white text-sm font-semibold hover:bg-[#162d4a] disabled:opacity-50">
              {saving ? 'Creating…' : 'Create'}
            </button>
          </div>
        </div>
      </form>
    </div>
  )
}

function ResetPasswordModal({ user, onClose, onDone, onError }) {
  const [password, setPassword] = useState('')
  const [saving, setSaving] = useState(false)

  async function submit(e) {
    e.preventDefault()
    setSaving(true)
    try {
      await api.patch(`/users/${user.id}/`, { password })
      onDone()
    } catch (err) {
      onError(err.response?.data?.error || 'Failed to reset password.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <form onClick={(e) => e.stopPropagation()} onSubmit={submit}
        className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden">
        <div className="bg-[#1e3a5f] px-6 py-4">
          <h2 className="text-white font-bold text-lg">Reset Password</h2>
          <p className="text-[#d9a52b] text-sm mt-0.5">for {user.username}</p>
        </div>
        <div className="p-6 space-y-4">
          <Field label="New password">
            <PasswordInput value={password} onChange={(e) => setPassword(e.target.value)} autoFocus />
          </Field>
          <div className="flex gap-3">
            <button type="button" onClick={onClose}
              className="flex-1 py-2.5 rounded-xl border-2 border-gray-200 text-sm font-semibold text-gray-500 hover:bg-gray-50">Cancel</button>
            <button type="submit" disabled={saving}
              className="flex-1 py-2.5 rounded-xl bg-[#1e3a5f] text-white text-sm font-semibold hover:bg-[#162d4a] disabled:opacity-50">
              {saving ? 'Saving…' : 'Update'}
            </button>
          </div>
        </div>
      </form>
    </div>
  )
}
