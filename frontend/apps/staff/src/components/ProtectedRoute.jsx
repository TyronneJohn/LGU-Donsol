import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { LoadingState } from '@shared/components/ui/LoadingState'

// Wrap role-restricted routes: <ProtectedRoute allowedRoles={['admin', 'mpdc']}>
export default function ProtectedRoute({ allowedRoles, children }) {
  const { user, role, loading } = useAuth()
  const location = useLocation()

  if (loading) {
    return <LoadingState label="Checking your session..." fullScreen />
  }

  if (!user) {
    return <Navigate to="/login" state={{ from: location }} replace />
  }

  if (allowedRoles && !allowedRoles.includes(role)) {
    return <Navigate to="/unauthorized" replace />
  }

  return children
}
