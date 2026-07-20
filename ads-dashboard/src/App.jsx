import { BrowserRouter, Routes, Route, Navigate, Outlet } from 'react-router-dom'
import Login from './pages/Login.jsx'
import Layout from './components/Layout.jsx'
import ImagesPage from './pages/ImagesPage.jsx'
import VideosPage from './pages/VideosPage.jsx'
import PlacementPage from './pages/PlacementPage.jsx'
import OverviewPage from './pages/OverviewPage.jsx'
import MonitorPage from './pages/MonitorPage.jsx'
import LogsPage from './pages/LogsPage.jsx'
import ImpressionsPage from './pages/ImpressionsPage.jsx'
import UsersPage from './pages/UsersPage.jsx'
import AdvertisersPage from './pages/AdvertisersPage.jsx'

function PrivateRoute() {
  const token = localStorage.getItem('access_token')
  return token ? <Outlet /> : <Navigate to="/login" replace />
}

function AdminRoute() {
  const role = localStorage.getItem('role') || 'admin'
  return role === 'admin' ? <Outlet /> : <Navigate to="/overview" replace />
}

function HomeRedirect() {
  const role = localStorage.getItem('role') || 'admin'
  return <Navigate to={role === 'operator' ? '/overview' : '/images'} replace />
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route element={<PrivateRoute />}>
          <Route element={<Layout />}>
            <Route path="/" element={<HomeRedirect />} />
            <Route element={<AdminRoute />}>
              <Route path="/images" element={<ImagesPage />} />
              <Route path="/videos" element={<VideosPage />} />
              <Route path="/placement" element={<PlacementPage />} />
              <Route path="/impressions" element={<ImpressionsPage />} />
            <Route path="/users" element={<UsersPage />} />
              <Route path="/advertisers" element={<AdvertisersPage />} />
            </Route>
            <Route path="/overview" element={<OverviewPage />} />
            <Route path="/monitor" element={<MonitorPage />} />
            <Route path="/logs" element={<LogsPage />} />
          </Route>
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
