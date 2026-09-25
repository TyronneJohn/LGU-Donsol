import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { ArrowLeft, ExternalLink, FileText, FolderKanban, Paperclip, Search, Send, Upload, X } from 'lucide-react'
import { createPortal } from 'react-dom'
import { supabase } from '@shared/lib/supabaseClient'
import { useAuth } from '../../hooks/useAuth'
import { useToast } from '../../hooks/useToast'
import { useDismissablePopover } from '../../hooks/useDismissablePopover'
import { useFormDraft, readDraft } from '../../hooks/useFormDraft'
import PageHeader from '../../components/ui/PageHeader'
import Button from '../../components/ui/Button'
import Badge from '@shared/components/ui/Badge'
import { LoadingState, Spinner } from '@shared/components/ui/LoadingState'
import EmptyState from '@shared/components/ui/EmptyState'
import { ROLES, ROLE_LABELS, ROLE_HOME_PATH } from '../../utils/roles'
import { formatCurrency, formatDate, formatDateTime, formatRelativeTime } from '@shared/utils/format'
import {
  PROJECT_STATUS_LABELS,
  PROJECT_STATUS_TONES,
  MONITORING_VISIBLE_STATUSES,
  SITE_MONITORING_VISIBLE_STATUSES,
  PROCUREMENT_ELIGIBLE_STATUSES,
} from '@shared/utils/projectStatus'

const MESSAGE_SELECT = `
  id, body, project_id, sender_id, sender_role, recipient_role, is_read, read_at, created_at,
  attachment_path, attachment_name, attachment_type, attachment_size,
  sender:profiles!messages_sender_id_fkey(full_name),
  project:projects(id, project_code, title)
`

const ATTACHMENT_BUCKET = 'message-attachments'
// Matches the bucket's file_size_limit (20260926100000_message_file_attachments.sql).
const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024

// Accounts created without a full name get their email as full_name (see
// handle_new_auth_user in the initial schema), so drop the "@domain" part — the
// office is already clear from the conversation itself.
function senderDisplayName(message) {
  const name = message.sender?.full_name?.trim()
  if (!name) return ROLE_LABELS[message.sender_role]
  return name.includes('@') ? name.split('@')[0] : name
}

// Local calendar day, so the "Today"/"Yesterday" separators follow the
// viewer's clock rather than UTC.
function dayKey(value) {
  const date = new Date(value)
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`
}

function formatDayLabel(value) {
  const today = new Date()
  const yesterday = new Date(today)
  yesterday.setDate(today.getDate() - 1)
  if (dayKey(value) === dayKey(today)) return 'Today'
  if (dayKey(value) === dayKey(yesterday)) return 'Yesterday'
  return new Date(value).toLocaleDateString('en-PH', {
    weekday: 'short',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

function formatMessageTime(value) {
  return new Date(value).toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit' })
}

function isImageType(type) {
  return typeof type === 'string' && type.startsWith('image/')
}

function formatFileSize(bytes) {
  if (bytes == null) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

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

  // An unsent message is kept per thread, so switching offices (or losing
  // the page to a refresh) doesn't throw away what was typed to either one.
  // draftThreadRef marks which thread the text in `draft` currently belongs
  // to: on the render where the selected thread changes, `draft` still holds
  // the *previous* thread's text, and mirroring it then would overwrite the
  // new thread's stored draft before the effect below has read it back.
  const composerDraftKey = selectedRole ? `message:${role}:${selectedRole}` : null
  const draftThreadRef = useRef(composerDraftKey)
  useFormDraft(composerDraftKey, draft, '', draftThreadRef.current === composerDraftKey)

  useEffect(() => {
    draftThreadRef.current = composerDraftKey
    setDraft(composerDraftKey ? (readDraft(composerDraftKey) ?? '') : '')
  }, [composerDraftKey])
  const [attachedProject, setAttachedProject] = useState(null)
  const [attachedFile, setAttachedFile] = useState(null)
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
    if ((!trimmed && !attachedFile) || !selectedRole || sending) return

    setSending(true)

    // The file goes up first so the message row never points at nothing.
    // The path is <sender office>/<recipient office>/..., which is what the
    // bucket's policies key read access off.
    let attachment = null
    if (attachedFile) {
      const safeName = attachedFile.name.replace(/[^\w.-]+/g, '_')
      const path = `${role}/${selectedRole}/${crypto.randomUUID()}-${safeName}`
      const { error: uploadError } = await supabase.storage
        .from(ATTACHMENT_BUCKET)
        .upload(path, attachedFile, { contentType: attachedFile.type || undefined })
      if (uploadError) {
        toast.error('Could not upload the file', uploadError.message)
        setSending(false)
        return
      }
      attachment = {
        attachment_path: path,
        attachment_name: attachedFile.name,
        attachment_type: attachedFile.type || null,
        attachment_size: attachedFile.size,
      }
    }

    const { data: inserted, error } = await supabase
      .from('messages')
      .insert({
        sender_id: user.id,
        sender_role: role,
        recipient_role: selectedRole,
        project_id: attachedProject?.id ?? null,
        body: trimmed,
        ...attachment,
      })
      .select(MESSAGE_SELECT)
      .single()

    if (error || !inserted) {
      if (attachment) supabase.storage.from(ATTACHMENT_BUCKET).remove([attachment.attachment_path])
      toast.error('Could not send message', error?.message)
      setSending(false)
      return
    }

    setMessages((current) => [...current, inserted])
    setDraft('')
    setAttachedProject(null)
    setAttachedFile(null)
    setSending(false)

    const preview = trimmed || `Sent a file: ${inserted.attachment_name}`

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
          message: preview.length > 140 ? `${preview.slice(0, 140)}…` : preview,
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
        p_metadata: {
          recipient_role: selectedRole,
          project_id: inserted.project_id ?? null,
          attachment_name: inserted.attachment_name ?? null,
        },
      })
      .then(({ error }) => {
        if (error) console.error('write_audit_log failed', error)
      })
  }

  function pickFile(file) {
    if (!file) return
    if (file.size > MAX_ATTACHMENT_BYTES) {
      toast.error('File is too large', `Files can be up to ${formatFileSize(MAX_ATTACHMENT_BYTES)}.`)
      return
    }
    setAttachedFile(file)
  }

  async function openAttachment(message) {
    const { data, error } = await supabase.storage
      .from(ATTACHMENT_BUCKET)
      .createSignedUrl(message.attachment_path, 300)
    if (error || !data?.signedUrl) {
      toast.error('Could not open the file', error?.message)
      return
    }
    window.open(data.signedUrl, '_blank', 'noopener')
  }

  async function openProjectPanel(projectId) {
    setProjectPanel({ id: projectId })
    setProjectPanelLoading(true)
    const { data, error } = await supabase
      .from('projects')
      .select(
        `id, project_code, title, description, project_category, barangay, location_text, status,
         estimated_cost, approved_budget, funding_source, created_by,
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
            attachedFile={attachedFile}
            onPickFile={pickFile}
            onClearFile={() => setAttachedFile(null)}
            onOpenAttachment={openAttachment}
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
              role={role}
              userId={user.id}
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
                        ? `${lastItem.sender_id === myUserId ? 'You: ' : ''}${lastItem.body || `📎 ${lastItem.attachment_name}`}`
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
  attachedFile,
  onPickFile,
  onClearFile,
  onOpenAttachment,
  attachPopover,
  onOpenProject,
  threadEndRef,
  className,
}) {
  const fileInputRef = useRef(null)
  const [viewingImage, setViewingImage] = useState(null)

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
          bucket.items.map((message, index) => {
            const previous = bucket.items[index - 1]
            const startsNewDay = !previous || dayKey(previous.created_at) !== dayKey(message.created_at)
            const isMine = message.sender_role === role
            const hasImage = message.attachment_path && isImageType(message.attachment_type)
            const hasFile = message.attachment_path && !hasImage
            // Images sit on their own with no bubble behind them; the bubble
            // only wraps text, file and project content.
            const hasBubble = Boolean(message.body || hasFile || message.project)
            return (
              <Fragment key={message.id}>
              {startsNewDay ? (
                <div className="flex items-center gap-3 py-1" role="separator">
                  <span className="h-px flex-1 bg-slate-200" />
                  <span className="text-[11px] font-medium text-slate-400">{formatDayLabel(message.created_at)}</span>
                  <span className="h-px flex-1 bg-slate-200" />
                </div>
              ) : null}
              <div className={`flex flex-col ${isMine ? 'items-end' : 'items-start'}`}>
                <p className="mb-1 px-1 text-xs font-medium text-slate-500">
                  {senderDisplayName(message)}
                </p>
                <div className={`flex max-w-[80%] flex-col gap-1.5 ${isMine ? 'items-end' : 'items-start'}`}>
                  {hasImage ? (
                    <MessageImage
                      message={message}
                      onView={setViewingImage}
                      onLoad={() => threadEndRef.current?.scrollIntoView({ block: 'end' })}
                    />
                  ) : null}
                  {hasBubble ? (
                    <div className={`rounded-2xl px-3.5 py-2.5 shadow-sm ${isMine ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-800'}`}>
                      {message.body ? (
                        <p className="whitespace-pre-wrap break-words text-sm">{message.body}</p>
                      ) : null}
                      {hasFile ? (
                        <button
                          type="button"
                          onClick={() => onOpenAttachment(message)}
                          title="Open file"
                          className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs font-medium transition-colors ${message.body ? 'mt-2' : ''} ${
                            isMine ? 'bg-blue-700/60 text-white hover:bg-blue-700' : 'bg-white text-blue-700 hover:bg-blue-50'
                          }`}
                        >
                          <FileText className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                          <span className="min-w-0 flex-1 truncate">{message.attachment_name}</span>
                          <span className={`shrink-0 text-[10px] ${isMine ? 'text-blue-100' : 'text-slate-400'}`}>
                            {formatFileSize(message.attachment_size)}
                          </span>
                        </button>
                      ) : null}
                      {message.project ? (
                        <button
                          type="button"
                          onClick={() => onOpenProject(message.project.id)}
                          className={`flex w-full items-center gap-1.5 rounded-lg px-2 py-1.5 text-left text-xs font-medium transition-colors ${message.body || hasFile ? 'mt-2' : ''} ${
                            isMine ? 'bg-blue-700/60 text-white hover:bg-blue-700' : 'bg-white text-blue-700 hover:bg-blue-50'
                          }`}
                        >
                          <FolderKanban className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                          <span className="truncate">
                            {message.project.project_code} — {message.project.title}
                          </span>
                        </button>
                      ) : null}
                    </div>
                  ) : null}
                </div>
                <time
                  dateTime={message.created_at}
                  title={formatDateTime(message.created_at)}
                  className="mt-1 px-1 text-[10px] text-slate-400"
                >
                  {formatMessageTime(message.created_at)}
                </time>
              </div>
              </Fragment>
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

        {attachedFile ? (
          <div className="mb-2 flex items-center gap-2 rounded-lg bg-blue-50 px-2.5 py-1.5 text-xs text-blue-700">
            {isImageType(attachedFile.type) ? (
              <LocalImageThumb file={attachedFile} />
            ) : (
              <FileText className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            )}
            <span className="min-w-0 flex-1 truncate">{attachedFile.name}</span>
            <span className="shrink-0 text-[11px] text-blue-500">{formatFileSize(attachedFile.size)}</span>
            <button
              type="button"
              onClick={onClearFile}
              aria-label="Remove attached file"
              className="rounded p-0.5 hover:bg-blue-100"
            >
              <X className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          </div>
        ) : null}

        <input
          ref={fileInputRef}
          type="file"
          className="hidden"
          onChange={(event) => {
            onPickFile(event.target.files?.[0])
            // Reset so picking the same file again still fires onChange.
            event.target.value = ''
          }}
        />

        <div className="flex items-end gap-2">
          <div className="relative" ref={attachPopover.containerRef}>
            <button
              type="button"
              onClick={() => attachPopover.setOpen((value) => !value)}
              aria-label="Attach a file or project"
              title="Attach a file or project"
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
                onBrowseFiles={() => {
                  attachPopover.close()
                  fileInputRef.current?.click()
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
            disabled={(!draft.trim() && !attachedFile) || sending}
            aria-label="Send message"
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-linear-to-r from-blue-700 to-blue-600 text-white shadow-sm shadow-blue-700/30 transition-all hover:from-blue-800 hover:to-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {sending ? <Spinner className="h-4 w-4 text-white" /> : <Send className="h-4 w-4" aria-hidden="true" />}
          </button>
        </div>
      </form>

      {viewingImage
        ? createPortal(
            <ImageViewer image={viewingImage} onClose={() => setViewingImage(null)} />,
            document.body,
          )
        : null}
    </div>
  )
}

// Signed URLs keyed by storage path, so a message list reload (every
// realtime event refetches the whole thread) doesn't re-sign every image.
const signedImageUrls = new Map()
const SIGNED_IMAGE_TTL_SECONDS = 3600

async function getSignedImageUrl(path) {
  const cached = signedImageUrls.get(path)
  // Re-sign a minute early so an image opened just before expiry still loads.
  if (cached && cached.expiresAt - 60_000 > Date.now()) return cached.url

  const { data, error } = await supabase.storage
    .from(ATTACHMENT_BUCKET)
    .createSignedUrl(path, SIGNED_IMAGE_TTL_SECONDS)
  if (error || !data?.signedUrl) return null

  signedImageUrls.set(path, { url: data.signedUrl, expiresAt: Date.now() + SIGNED_IMAGE_TTL_SECONDS * 1000 })
  return data.signedUrl
}

function MessageImage({ message, onView, onLoad }) {
  const [url, setUrl] = useState(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let active = true
    getSignedImageUrl(message.attachment_path).then((signed) => {
      if (!active) return
      if (signed) setUrl(signed)
      else setFailed(true)
    })
    return () => {
      active = false
    }
  }, [message.attachment_path])

  if (failed) {
    return (
      <p className="rounded-2xl border border-dashed border-slate-300 px-3 py-2 text-xs text-slate-500">
        Could not load image: {message.attachment_name}
      </p>
    )
  }

  if (!url) {
    return <div className="h-48 w-60 max-w-full animate-pulse rounded-2xl bg-slate-100" />
  }

  return (
    <button
      type="button"
      onClick={() => onView({ url, name: message.attachment_name })}
      title="View image"
      className="block overflow-hidden rounded-2xl border border-slate-200 transition-opacity hover:opacity-90"
    >
      <img
        src={url}
        alt={message.attachment_name ?? 'Attached image'}
        onLoad={onLoad}
        onError={() => setFailed(true)}
        className="block max-h-72 w-auto max-w-full object-cover"
      />
    </button>
  )
}

function LocalImageThumb({ file }) {
  const [url, setUrl] = useState(null)

  useEffect(() => {
    const objectUrl = URL.createObjectURL(file)
    setUrl(objectUrl)
    return () => URL.revokeObjectURL(objectUrl)
  }, [file])

  return url ? <img src={url} alt="" className="h-10 w-10 shrink-0 rounded object-cover" /> : null
}

function ImageViewer({ image, onClose }) {
  useEffect(() => {
    function handleKey(event) {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [onClose])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button type="button" aria-label="Close image" onClick={onClose} className="fixed inset-0 bg-slate-900/80" />
      <div role="dialog" aria-modal="true" aria-label={image.name} className="relative flex max-h-full max-w-full flex-col items-center gap-2">
        <div className="flex w-full items-center justify-between gap-3 text-sm text-white">
          <span className="min-w-0 truncate">{image.name}</span>
          <span className="flex shrink-0 items-center gap-1">
            <a
              href={image.url}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Open in new tab"
              title="Open in new tab"
              className="rounded-md p-1.5 hover:bg-white/15"
            >
              <ExternalLink className="h-4 w-4" aria-hidden="true" />
            </a>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="rounded-md p-1.5 hover:bg-white/15"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          </span>
        </div>
        <img src={image.url} alt={image.name} className="max-h-[80vh] max-w-full rounded-lg object-contain shadow-2xl" />
      </div>
    </div>
  )
}

function ProjectPicker({ onPick, onBrowseFiles }) {
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
      <button
        type="button"
        onClick={onBrowseFiles}
        className="mb-2 flex w-full items-center gap-2 rounded-md border border-dashed border-slate-300 px-2.5 py-2 text-left text-xs font-medium text-slate-700 hover:border-blue-400 hover:bg-blue-50 hover:text-blue-700"
      >
        <Upload className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        <span className="flex-1">Upload a file from your computer</span>
        <span className="text-[10px] font-normal text-slate-400">up to 25 MB</span>
      </button>
      <p className="mb-1.5 px-1 text-[11px] font-medium uppercase tracking-wide text-slate-400">Or attach a project</p>
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

// Where the viewer can actually work on a project attached to a message.
// The panel itself is read-only, so "Open" hands them off to the page their
// own role uses for that project at that stage — Engineering's review queue
// before a decision, Site Monitoring once it's being built, BAC's
// procurement record, MPDC's own draft or the monitoring view.
//
// Returns null when this role has no page for the project in its current
// status (Engineering can't open a project still in MPDC's drafts, say);
// the button is then left out rather than pointing somewhere that would
// greet the user with "Project not found".
function projectDestination(role, project, userId) {
  const id = project?.id
  if (!id || !project?.status) return null

  if (role === ROLES.ADMIN) return `/admin/projects/${id}`

  if (role === ROLES.ENGINEERING) {
    if (project.status === 'SUBMITTED_FOR_REVIEW') return `/engineering/review/${id}`
    if (SITE_MONITORING_VISIBLE_STATUSES.includes(project.status)) return `/engineering/monitoring/${id}`
    return null
  }

  if (role === ROLES.BAC) {
    // Procurement's own record stays reachable after the award too, which is
    // when the project has already moved on to the implementation statuses.
    const bacReachable = [...PROCUREMENT_ELIGIBLE_STATUSES, ...SITE_MONITORING_VISIBLE_STATUSES]
    return bacReachable.includes(project.status) ? `/bac/procurement/${id}` : null
  }

  if (role === ROLES.MPDC) {
    if (MONITORING_VISIBLE_STATUSES.includes(project.status)) return `/mpdc/monitoring/${id}`
    // Pre-approval, the only MPDC page for a project is its editor, and that
    // one is scoped to the creator (ProjectForm bails out otherwise).
    return project.created_by === userId ? `/mpdc/projects/${id}` : null
  }

  return null
}

function ProjectPanel({ project, loading, onClose, role, userId }) {
  const destination = loading ? null : projectDestination(role, project, userId)

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

            <div className="flex justify-end pt-1">
              {destination ? (
                <Button size="sm" icon={ExternalLink} to={destination} onClick={onClose}>
                  Open Project
                </Button>
              ) : (
                <p className="text-xs text-slate-400">
                  This project isn&apos;t in your office&apos;s queue right now, so there&apos;s nothing to
                  open — it&apos;s {(PROJECT_STATUS_LABELS[project.status] ?? project.status).toLowerCase()}.
                </p>
              )}
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
