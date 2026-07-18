import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import axios from 'axios'

/**
 * Split-screen login: the left half plays our own live ads (fetched from the
 * public /api/playlist/ endpoint — it's an ads platform, the login page is
 * inventory too); the right half is the sign-in panel in the navy/gold theme.
 */
export default function Login() {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [logoError, setLogoError] = useState(false)
  const navigate = useNavigate()

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const { data } = await axios.post('/api/auth/login/', { username, password })
      localStorage.setItem('access_token', data.access)
      localStorage.setItem('refresh_token', data.refresh)
      try {
        const me = await axios.get('/api/me/', { headers: { Authorization: `Bearer ${data.access}` } })
        localStorage.setItem('role', me.data.role)
        navigate(me.data.role === 'operator' ? '/overview' : '/')
      } catch {
        localStorage.setItem('role', 'admin')
        navigate('/')
      }
    } catch (err) {
      setError(err.response?.data?.detail || 'Invalid username or password.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex bg-white">
      {/* Left — live ad panel (hidden on small screens) */}
      <div className="hidden md:block md:w-[55%] relative overflow-hidden">
        <AdShowcase />
      </div>

      {/* Right — sign-in panel */}
      <div className="flex-1 flex flex-col justify-center items-center px-6 py-10 relative">
        <div className="w-full max-w-sm relative z-10">
          {/* Logo */}
          <div className="flex flex-col items-center mb-8">
            {logoError ? (
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-full bg-[#1e3a5f] flex items-center justify-center shadow">
                  <svg className="w-7 h-7 text-[#d9a52b]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                      d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                  </svg>
                </div>
                <div className="text-left">
                  <div className="text-xl font-extrabold text-[#1e3a5f] leading-tight">Ads Manager</div>
                  <div className="text-xs text-gray-400 font-medium tracking-wide">Display Control System</div>
                </div>
              </div>
            ) : (
              <img src="/images/logo.png" alt="Logo" className="h-14 object-contain"
                onError={() => setLogoError(true)} />
            )}
          </div>

          <h1 className="text-4xl font-extrabold text-[#1e3a5f] text-center">Welcome</h1>
          <p className="text-gray-400 text-sm text-center mt-2 mb-8">Sign in to your Ads Manager</p>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-bold text-[#1e3a5f] uppercase tracking-wider mb-1.5">Username</label>
              <div className="relative">
                <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8}
                      d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                  </svg>
                </span>
                <input
                  type="text"
                  className="w-full border-2 border-gray-200 rounded-xl pl-12 pr-4 py-3 text-sm focus:outline-none focus:border-[#1e3a5f] transition-colors"
                  placeholder="Enter your username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  required
                  autoFocus
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold text-[#1e3a5f] uppercase tracking-wider mb-1.5">Password</label>
              <div className="relative">
                <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8}
                      d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                  </svg>
                </span>
                <input
                  type="password"
                  className="w-full border-2 border-gray-200 rounded-xl pl-12 pr-4 py-3 text-sm focus:outline-none focus:border-[#1e3a5f] transition-colors"
                  placeholder="Enter your password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
              </div>
            </div>

            {error && (
              <div className="bg-red-50 border border-red-200 text-red-600 rounded-xl px-4 py-2.5 text-sm">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full py-3 rounded-xl text-white font-bold text-base mt-2 bg-[#1e3a5f] hover:bg-[#162d4a] transition-all disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {loading ? 'Signing in…' : 'Login'}
            </button>
          </form>
        </div>

        {/* Decorative skyline strip at the bottom (navy/gold, like the reference) */}
        <div className="absolute bottom-0 left-0 right-0 pointer-events-none opacity-90">
          <svg viewBox="0 0 800 90" preserveAspectRatio="none" className="w-full h-20" xmlns="http://www.w3.org/2000/svg">
            <g fill="#1e3a5f" opacity="0.12">
              <rect x="20" y="40" width="34" height="50" />
              <rect x="60" y="22" width="42" height="68" />
              <rect x="108" y="48" width="28" height="42" />
              <rect x="640" y="30" width="40" height="60" />
              <rect x="688" y="50" width="30" height="40" />
              <rect x="724" y="18" width="44" height="72" />
            </g>
            <g>
              <rect x="360" y="46" width="80" height="44" fill="#1e3a5f" opacity="0.18" rx="4" />
              <rect x="372" y="36" width="56" height="14" fill="#d9a52b" opacity="0.55" rx="2" />
              <text x="400" y="72" fontSize="11" fill="#1e3a5f" opacity="0.45" textAnchor="middle" fontWeight="bold">SWAP</text>
            </g>
          </svg>
        </div>
      </div>
    </div>
  )
}

/** Left panel — rotates live ads from the public playlist; branded fallback when none. */
function AdShowcase() {
  const [ads, setAds] = useState(null)   // null = loading, [] = none
  const [idx, setIdx] = useState(0)

  useEffect(() => {
    // Prefer dedicated login media (login_ad/ folder); fall back to live playlist.
    axios.get('/api/login-ads/')
      .then(({ data }) => {
        if (Array.isArray(data) && data.length) { setAds(data); return null }
        return axios.get('/api/playlist/')
      })
      .then((res) => { if (res) setAds(Array.isArray(res.data) ? res.data : []) })
      .catch(() => setAds([]))
  }, [])

  const cur = ads && ads.length ? ads[idx % ads.length] : null

  // Images advance by their duration; videos advance on 'ended'.
  useEffect(() => {
    if (!cur || ads.length <= 1) return
    if (cur.media_type === 'image') {
      const t = setTimeout(() => setIdx((i) => i + 1), (cur.duration_seconds || 8) * 1000)
      return () => clearTimeout(t)
    }
  }, [idx, ads, cur])

  return (
    <div className="absolute inset-0 bg-[#1e3a5f]">
      {/* Media */}
      {cur ? (
        cur.media_type === 'video' ? (
          <video
            key={cur.id}
            src={cur.url}
            muted
            autoPlay
            playsInline
            loop={ads.length === 1}
            onEnded={() => ads.length > 1 && setIdx((i) => i + 1)}
            className="absolute inset-0 w-full h-full object-contain"
          />
        ) : (
          <img
            key={cur.id}
            src={cur.url}
            alt={cur.title}
            className="absolute inset-0 w-full h-full object-cover"
          />
        )
      ) : (
        /* Branded fallback — no live ads (or still loading) */
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-4">
          <div className="w-16 h-16 rounded-2xl border-2 border-[#d9a52b]/60 flex items-center justify-center">
            <svg className="w-9 h-9 text-[#d9a52b]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.6}
                d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
          </div>
          <p className="text-white/50 text-sm tracking-widest uppercase">Powering every swap screen</p>
        </div>
      )}

      {/* Readability gradient */}
      <div className="absolute inset-0 bg-gradient-to-b from-black/55 via-transparent to-black/45 pointer-events-none" />

      {/* Brand overlay (top) */}
      <div className="absolute top-0 left-0 right-0 pt-12 px-10 text-center">
        <h2 className="text-white text-4xl font-bold" style={{ fontFamily: 'Georgia, "Times New Roman", serif', fontStyle: 'italic' }}>
          SunMobility Digital Signage
        </h2>
        {/* <p className="text-white/80 text-sm mt-3 max-w-md mx-auto">
          Your brand, in front of every battery swap — measurable, captive, citywide.
        </p> */}
        <div className="w-14 h-0.5 bg-[#d9a52b] mx-auto mt-4" />
      </div>

      {/* Bottom chip + rotation dots */}
      {cur && (
        <div className="absolute bottom-5 left-0 right-0 px-8 flex items-center justify-between">
          <span className="text-[11px] font-semibold text-white/90 px-2.5 py-1 rounded-full"
            style={{ background: 'rgba(15,23,42,0.55)' }}>
            Ad · {cur.title}
          </span>
          {ads.length > 1 && (
            <div className="flex items-center gap-1.5">
              {ads.map((a, i) => (
                <span key={a.id} className="rounded-full transition-all"
                  style={{
                    width: i === idx % ads.length ? 18 : 7, height: 7,
                    background: i === idx % ads.length ? '#d9a52b' : 'rgba(255,255,255,0.45)',
                  }} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
