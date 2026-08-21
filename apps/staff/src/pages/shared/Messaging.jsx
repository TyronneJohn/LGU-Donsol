import { useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { ArrowLeft, FolderKanban, Paperclip, Search, Send, X } from 'lucide-react'
import { createPortal } from 'react-dom'
import { supabase } from '@shared/lib/supabaseClient'
import { useAuth } from '../../hooks/useAuth'
import { useToast } from '../../hooks/useToast'
import { useDismissablePopover } from '../../hooks/useDismissablePopover'
import PageHeader from '../../components/ui/PageHeader'
import Badge from '@shared/components/ui/Badge'
import { LoadingState, Spinner } from '@shared/components/ui/LoadingState'
import EmptyState from '@shared/components/ui/EmptyState'
import { ROLES, ROLE_LABELS, ROLE_HOME_PATH } from '../../utils/roles'
import { formatCurrency, formatDate, formatRelativeTime } from '@shared/utils/format'
import { PROJECT_STATUS_LABELS, PROJECT_STATUS_TONES } from '@shared/utils/projectStatus'

const MESSAGE_SELECT = `
  id, body, project_id, sender_id, sender_role, recipient_role, is_read, read_at, created_at,
  sender:profiles!messages_sender_id_fkey(full_name),
  project:projects(id, project_code, title)
`

// Office-to-office messaging: a "conversation" is every message row touching
// my role on either side (sender_role or recipient_role) — there are only
// three possible counterparts, so the conversation list is always exactly
// the other three offices, not a dynamically discovered set of threads.
export default function Messaging() {
  const { user, role } = useAuth()
  const toast = useToast()
  const [searchParams, setSearchParams] = useSearchParams()

  const otherRoles = useMemo(() => Object.values(ROLES).filter((value) => value !== role), [role])

  const [messages, setMessages] = useState([])
  const [loading, setLoading] = useState(true)
  const [selectedRole, setSelectedRole] = useState(() => {
    const withParam = searchParams.get('with')
    return otherRoles.includes(withParam) ? withParam : null
  })
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [attachedProject, setAttachedProject] = useState(null)
  const [projectPanel, setProjectPanel] = useState(null)
  const [projectPanelLoading, setProjectPanelLoading] = useState(false)

  const threadEndRef = useRef(null)
  const attachPopover = useDismissablePopover()

  async function loadMessages() {
    setLoading(true)
    const { data, error } = await supabase
      .from('messages')
      .select(MESSAGE_SELECT)
      .or(`sender_role.eq.${role},recipient_role.eq.${role}`)
      .order('created_at', { ascending: true })

    if (error) {
      toast.error('Could not load messages', error.message)
    } else {
      setMessages(data ?? [])
    }
    setLoading(false)
  }

  useEffect(() => {
    loadMessages()
  }, [role])

  useEffect(() => {
    const withParam = searchParams.get('with')
    if (withParam && otherRoles.includes(withParam) && withParam !== selectedRole) {
      setSelectedRole(withParam)
    }
  }, [searchParams])

  useEffect(() => {
    const channel = supabase
      .channel(`messages-office-${role}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'messages', filter: `recipient_role=eq.${role}` },
        () => loadMessages(),
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'messages', filter: `sender_role=eq.${role}` },
        () => loadMessages(),
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [role])

  const buckets = useMemo(() => {
    const map = new Map(otherRoles.map((value) => [value, { role: value, items: [], unread: 0 }]))
    for (const message of messages) {
      const counterpart = message.sender_role === role ? message.recipient_role : message.sender_role
      const bucket = map.get(counterpart)
      if (!bucket) continue
      bucket.items.push(message)
      if (message.recipient_role === role && message.sender_role === counterpart && !message.is_read) {
        bucket.unread += 1
      }
    }
    return [...map.values()].sort((a, b) => {
      const at = a.items.at(-1)?.created_at ?? ''
      const bt = b.items.at(-1)?.created_at ?? ''
      return bt.localeCompare(at)
    })
  }, [messages, otherRoles, role])

  const activeBucket = buckets.find((bucket) => bucket.role === selectedRole) ?? null

  useEffect(() => {
    threadEndRef.current?.scrollIntoView({ block: 'end' })
  }, [activeBucket?.items.length, selectedRole])

  // Opening a conversation marks its unread messages — and the notification
  // that was raised for each of them — as read. Never on mere existence,
  // only once the recipient has actually selected this thread.
  useEffect(() => {
    if (!selectedRole) return

    const unreadIds = messages
      .filter((message) => message.recipient_role === role && message.sender_role === selectedRole && !message.is_read)
      .map((message) => message.id)

    if (unreadIds.length === 0) return

    const now = new Date().toISOString()
    setMessages((current) =>
      current.map((message) => (unreadIds.includes(message.id) ? { ...message, is_read: true, read_at: now } : message)),
    )

    supabase
      .from('messages')
      .update({ is_read: true, read_at: now })
      .in('id', unreadIds)
      .then(({ error }) => {
        if (error) toast.error('Could not mark messages as read', error.message)
      })
    supabase
      .from('notifications')
      .update({ is_read: true, read_at: now })
      .eq('recipient_id', user.id)
      .eq('category', 'NEW_MESSAGE')
      .in('related_message_id', unreadIds)
      .then(({ error }) => {
        if (error) toast.error('Could not mark notifications as read', error.message)
      })
  }, [selectedRole, messages])

  function selectRole(value) {
    setSelectedRole(value)
    setSearchParams(value ? { with: value } : {}, { replace: true })
  }

  async function handleSend(event) {
    event.preventDefault()
    const trimmed = draft.trim()
    if (!trimmed || !selectedRole || sending) return

    setSending(true)
    const { data: inserted, error } = await supabase
      .from('messages')
      .insert({
        sender_id: user.id,
        sender_role: role,
        recipient_role: selectedRole,
        project_id: attachedProject?.id ?? null,
        body: trimmed,
      })
      .select(MESSAGE_SELECT)
      .single()

    if (error || !inserted) {
      toast.error('Could not send message', error?.message)
      setSending(false)
      return
    }

    setMessages((current) => [...current, inserted])
    setDraft('')
    setAttachedProject(null)
    setSending(false)

    const { data: recipients, error: recipientsError } = await supabase
      .from('profiles')
      .select('id')
      .eq('role', selectedRole)
      .eq('is_active', true)

    if (recipientsError) {
      toast.error('Sent, but could not notify the recipient office', recipientsError.message)
    } else if (recipients?.length) {
      const { error: notifyError } = await supabase.from('notifications').insert(
        recipients.map((recipient) => ({
          recipient_id: recipient.id,
          sender_id: user.id,
          category: 'NEW_MESSAGE',
          title: `New message from ${ROLE_LABELS[role]}`,
          message: trimmed.length > 140 ? `${trimmed.slice(0, 140)}…` : trimmed,
          related_project_id: attachedProject?.id ?? null,
          related_message_id: inserted.id,
        })),
      )
      if (notifyError) toast.error('Sent, but could not notify the recipient office', notifyError.message)
    }

    supabase
      .rpc('write_audit_log', {
        p_action: 'MESSAGE_SENT',
        p_entity_type: 'message',
        p_entity_id: inserted.id,
        p_description: `Message sent to ${ROLE_LABELS[selectedRole]}`,
        p_metadata: { recipient_role: selectedRole, project_id: attachedProject?.id ?? null },
      })
      .then(({ error }) => {
        if (error) console.error('write_audit_log failed', error)
      })
  }

  async function openProjectPanel(projectId) {
    setProjectPanel({ id: projectId })
    setProjectPanelLoading(true)
    const { data, error } = await supabase
      .from('projects')
      .select(
        `id, project_code, title, description, project_category, barangay, location_text, status,
         estimated_cost, approved_budget, funding_source,
         start_date_planned, end_date_planned, start_date_actual, end_date_actual`,
      )
      .eq('id', projectId)
      .maybeSingle()

    if (error || !data) {
      toast.error('Could not load project', error?.message)
      setProjectPanel(null)
    } else {
      setProjectPanel(data)
    }
    setProjectPanelLoading(false)
  }

  return (
    <div>
      <PageHeader
        title="Messages"
        description="Send and receive messages with the other offices and the admin."
        breadcrumbs={[{ label: 'Dashboard', to: ROLE_HOME_PATH[role] }, { label: 'Messages' }]}
      />

      {loading ? (
        <LoadingState label="Loading conversations..." />
      ) : (
        <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
          <ConversationList
            buckets={buckets}
            selectedRole={selectedRole}
            onSelect={selectRole}
            myUserId={user.id}
            className={selectedRole ? 'hidden lg:flex' : 'flex'}
          />

          <Thread
            role={role}
            selectedRole={selectedRole}
            bucket={activeBucket}
            draft={draft}
            onDraftChange={setDraft}
            onSend={handleSend}
            sending={sending}
            onBack={() => selectRole(null)}
            attachedProject={attachedProject}
            onAttach={setAttachedProject}
            onClearAttach={() => setAttachedProject(null)}
            attachPopover={attachPopover}
            onOpenProject={openProjectPanel}
            threadEndRef={threadEndRef}
            className={selectedRole ? 'flex' : 'hidden lg:flex'}
          />
        </div>
      )}

      {projectPanel
        ? createPortal(
            <ProjectPanel
              project={projectPanel}
              loading={projectPanelLoading}
              onClose={() => setProjectPanel(null)}
            />,
            document.body,
          )
        : null}
    </div>
  )
}

function ConversationList({ buckets, selectedRole, onSelect, myUserId, className }) {
  return (
    <div className={`${className} h-[70vh] flex-col overflow-hidden rounded-xl border border-slate-200/70 bg-white shadow-sm shadow-slate-200/60`}>
      <div className="border-b border-slate-200 px-4 py-3">
        <p className="text-sm font-semibold text-slate-800">Conversations</p>
      </div>
      <ul className="flex-1 overflow-y-auto">
        {buckets.map((bucket) => {
          const lastItem = bucket.items.at(-1)
          const isActive = bucket.role === selectedRole
          return (
            <li key={bucket.role}>
              <button
                type="button"
                onClick={() => onSelect(bucket.role)}
                className={`flex w-full items-start gap-3 border-b border-slate-100 px-4 py-3 text-left transition-colors hover:bg-slate-50 ${
                  isActive ? 'bg-blue-50' : ''
                }`}
              >
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-linear-to-br from-blue-600 to-blue-800 text-xs font-semibold text-white">
                  {ROLE_LABELS[bucket.role]?.charAt(0)}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center justify-between gap-2">
                    <span className="truncate text-sm font-medium text-slate-800">{ROLE_LABELS[bucket.role]}</span>
                    {lastItem ? (
                      <span className="shrink-0 text-xs text-slate-400">{formatRelativeTime(lastItem.created_at)}</span>
                    ) : null}
                  </span>
                  <span className="flex items-center justify-between gap-2">
                    <span className="truncate text-xs text-slate-500">
                      {lastItem
                        ? `${lastItem.sender_id === myUserId ? 'You: ' : ''}${lastItem.body}`
                        : 'No messages yet'}
                    </span>
                    {bucket.unread > 0 ? (
                      <span className="flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-blue-600 px-1.5 text-[11px] font-semibold text-white">
                        {bucket.unread}
                      </span>
                    ) : null}
                  </span>
                </span>
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

function Thread({
  role,
  selectedRole,
  bucket,
  draft,
  onDraftChange,
  onSend,
  sending,
  onBack,
  attachedProject,
  onAttach,
  onClearAttach,
  attachPopover,
  onOpenProject,
  threadEndRef,
  className,
}) {
  if (!selectedRole) {
    return (
      <div className={`${className} h-[70vh] items-center justify-center rounded-xl border border-slate-200/70 bg-white shadow-sm shadow-slate-200/60`}>
        <EmptyState
          title="Select a conversation"
          description="Choose an office on the left to view or start a conversation."
        />
      </div>
    )
  }

  return (
    <div className={`${className} h-[70vh] flex-col overflow-hidden rounded-xl border border-slate-200/70 bg-white shadow-sm shadow-slate-200/60`}>
      <div className="flex items-center gap-2 border-b border-slate-200 px-4 py-3">
        <button
          type="button"
          onClick={onBack}
          aria-label="Back to conversations"
          className="rounded-md p-1 text-slate-500 hover:bg-slate-100 lg:hidden"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        </button>
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-linear-to-br from-blue-600 to-blue-800 text-xs font-semibold text-white">
          {ROLE_LABELS[selectedRole]?.charAt(0)}
        </span>
        <p className="text-sm font-semibold text-slate-800">{ROLE_LABELS[selectedRole]}</p>
      </div>

      <div className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
        {bucket?.items.length ? (
          bucket.items.map((message) => {
            const isMine = message.sender_role === role
            return (
              <div key={message.id} className={`flex ${isMine ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[80%] rounded-2xl px-3.5 py-2.5 shadow-sm ${isMine ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-800'}`}>
                  <p className={`text-xs font-medium ${isMine ? 'text-blue-100' : 'text-slate-500'}`}>
                    {message.sender?.full_name ?? ROLE_LABELS[message.sender_role]}
                  </p>
                  <p className="mt-0.5 whitespace-pre-wrap break-words text-sm">{message.body}</p>
                  {message.project ? (
                    <button
                      type="button"
                      onClick={() => onOpenProject(message.project.id)}
                      className={`mt-2 flex w-full items-center gap-1.5 rounded-lg px-2 py-1.5 text-left text-xs font-medium transition-colors ${
                        isMine ? 'bg-blue-700/60 text-white hover:bg-blue-700' : 'bg-white text-blue-700 hover:bg-blue-50'
                      }`}
                    >
                      <FolderKanban className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                      <span className="truncate">
                        {message.project.project_code} — {message.project.title}
                      </span>
                    </button>
                  ) : null}
                  <p className={`mt-1 text-right text-[10px] ${isMine ? 'text-blue-100' : 'text-slate-400'}`}>
                    {formatRelativeTime(message.created_at)}
                  </p>
                </div>
              </div>
            )
          })
        ) : (
          <EmptyState
            title={`Start the conversation with ${ROLE_LABELS[selectedRole]}`}
            description="Messages you send here are visible to everyone in that office."
            bordered={false}
          />
        )}
        <div ref={threadEndRef} />
      </div>

      <form onSubmit={onSend} className="border-t border-slate-200 p-3">
        {attachedProject ? (
          <div className="mb-2 flex items-center gap-2 rounded-lg bg-blue-50 px-2.5 py-1.5 text-xs text-blue-700">
            <FolderKanban className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span className="min-w-0 flex-1 truncate">
              {attachedProject.project_code} — {attachedProject.title}
            </span>
            <button
              type="button"
              onClick={onClearAttach}
              aria-label="Remove attached project"
              className="rounded p-0.5 hover:bg-blue-100"
            >
              <X className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          </div>
        ) : null}

        <div className="flex items-end gap-2">
          <div className="relative" ref={attachPopover.containerRef}>
            <button
              type="button"
              onClick={() => attachPopover.setOpen((value) => !value)}
              aria-label="Attach a project"
              title="Attach a project"
              className="rounded-md p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-700"
            >
              <Paperclip className="h-4 w-4" aria-hidden="true" />
            </button>
            {attachPopover.open ? (
              <ProjectPicker
                onPick={(project) => {
                  onAttach(project)
                  attachPopover.close()
                }}
              />
            ) : null}
          </div>

          <textarea
            value={draft}
            onChange={(event) => onDraftChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault()
                onSend(event)
              }
            }}
            rows={1}
            placeholder={`Message ${ROLE_LABELS[selectedRole]}...`}
            className="max-h-32 flex-1 resize-none rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-600 focus:outline-none focus:ring-1 focus:ring-blue-600"
          />

          <button
            type="submit"
            disabled={!draft.trim() || sending}
            aria-label="Send message"
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-linear-to-r from-blue-700 to-blue-600 text-white shadow-sm shadow-blue-700/30 transition-all hover:from-blue-800 hover:to-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {sending ? <Spinner className="h-4 w-4 text-white" /> : <Send className="h-4 w-4" aria-hidden="true" />}
          </button>
        </div>
      </form>
    </div>
  )
}

function ProjectPicker({ onPick }) {
  const [term, setTerm] = useState('')
  const [results, setResults] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let active = true
    setLoading(true)
    const timeout = setTimeout(async () => {
      let query = supabase
        .from('projects')
        .select('id, project_code, title')
        .order('created_at', { ascending: false })
        .limit(15)
      if (term.trim()) query = query.ilike('title', `%${term.trim()}%`)

      const { data } = await query
      if (active) {
        setResults(data ?? [])
        setLoading(false)
      }
    }, 250)

    return () => {
      active = false
      clearTimeout(timeout)
    }
  }, [term])

  return (
    <div className="animate-pop-in absolute bottom-full left-0 z-30 mb-2 w-72 rounded-xl border border-slate-200 bg-white p-2 shadow-xl shadow-slate-900/10">
      <div className="relative mb-1.5">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" aria-hidden="true" />
        <input
          autoFocus
          value={term}
          onChange={(event) => setTerm(event.target.value)}
          placeholder="Search a project to attach..."
          className="w-full rounded-md border border-slate-300 py-1.5 pl-8 pr-2 text-xs focus:border-blue-600 focus:outline-none focus:ring-1 focus:ring-blue-600"
        />
      </div>
      <div className="max-h-56 overflow-y-auto">
        {loading ? (
          <p className="px-2 py-3 text-center text-xs text-slate-400">Searching...</p>
        ) : results.length === 0 ? (
          <p className="px-2 py-3 text-center text-xs text-slate-400">No projects found.</p>
        ) : (
          results.map((project) => (
            <button
              key={project.id}
              type="button"
              onClick={() => onPick(project)}
              className="flex w-full flex-col rounded-md px-2 py-1.5 text-left hover:bg-slate-50"
            >
              <span className="truncate text-xs font-medium text-slate-800">{project.title}</span>
              <span className="text-[11px] text-slate-400">{project.project_code}</span>
            </button>
          ))
        )}
      </div>
    </div>
  )
}

function ProjectPanel({ project, loading, onClose }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
      <button type="button" aria-label="Dismiss dialog" onClick={onClose} className="fixed inset-0 bg-slate-900/50" />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="project-panel-title"
        className="relative max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-lg bg-white p-5 shadow-xl"
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs font-medium uppercase tracking-wide text-slate-400">{project.project_code ?? ''}</p>
            <h2 id="project-panel-title" className="truncate text-base font-semibold text-slate-800">
              {project.title ?? 'Project'}
            </h2>
          </div>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="shrink-0 rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        {loading ? (
          <LoadingState label="Loading project..." />
        ) : (
          <div className="space-y-3 text-sm">
            <Badge tone={PROJECT_STATUS_TONES[project.status] ?? 'neutral'}>
              {PROJECT_STATUS_LABELS[project.status] ?? project.status}
            </Badge>

            {project.description ? <p className="text-slate-600">{project.description}</p> : null}

            <div className="grid grid-cols-2 gap-3">
              <PanelField label="Category">{project.project_category}</PanelField>
              <PanelField label="Barangay">{project.barangay}</PanelField>
              <PanelField label="Location">{project.location_text}</PanelField>
              <PanelField label="Funding Source">{project.funding_source}</PanelField>
              <PanelField label="Estimated Cost">
                {project.estimated_cost != null ? formatCurrency(project.estimated_cost) : null}
              </PanelField>
              <PanelField label="Approved Budget">
                {project.approved_budget != null ? formatCurrency(project.approved_budget) : null}
              </PanelField>
              <PanelField label="Planned Start">
                {project.start_date_planned ? formatDate(project.start_date_planned) : null}
              </PanelField>
              <PanelField label="Planned End">
                {project.end_date_planned ? formatDate(project.end_date_planned) : null}
              </PanelField>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function PanelField({ label, children }) {
  return (
    <div>
      <p className="text-xs font-medium uppercase tracking-wide text-slate-400">{label}</p>
      <p className="mt-0.5 text-sm text-slate-800">{children ?? '—'}</p>
    </div>
  )
}
