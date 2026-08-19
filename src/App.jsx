import { BrowserRouter } from 'react-router-dom'
import { AuthProvider } from './contexts/AuthContext'
import { NotificationsProvider } from './contexts/NotificationsContext'
import { ToastProvider } from './contexts/ToastContext'
import { ConfirmProvider } from './contexts/ConfirmContext'
import AppRoutes from './routes/AppRoutes'

function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <NotificationsProvider>
          <ToastProvider>
            <ConfirmProvider>
              <AppRoutes />
            </ConfirmProvider>
          </ToastProvider>
        </NotificationsProvider>
      </AuthProvider>
    </BrowserRouter>
  )
}

export default App
