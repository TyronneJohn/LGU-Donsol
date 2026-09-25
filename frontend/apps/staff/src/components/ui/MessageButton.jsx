import { MessageSquare } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { useNotifications } from '../../hooks/useNotifications'
import { useAuth } from '../../hooks/useAuth'
import { ROLE_HOME_PATH } from '../../utils/roles'

export default function MessageButton() {
  const { role } = useAuth()
  const navigate = useNavigate()
  const { notifications } = useNotifications()

  const unreadMessages = notifications.filter(
    (notification) => notification.category === 'NEW_MESSAGE' && !notification.is_read,
  ).length

  return (
    <button
      type="button"
      onClick={() => navigate(`${ROLE_HOME_PATH[role]}/messaging`)}
      aria-label="Messaging"
      className="relative rounded-md p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
    >
      <MessageSquare className="h-5 w-5" aria-hidden="true" />
      {unreadMessages > 0 ? (
        <span
          aria-hidden="true"
          className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-semibold leading-none text-white"
        >
          {unreadMessages > 9 ? '9+' : unreadMessages}
        </span>
      ) : null}
    </button>
  )
}
