import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Camera, CameraOff, MapPin, X } from 'lucide-react'
import Button from './ui/Button'

// Live in-page camera, for taking a fresh site photo on the spot rather than
// only ever picking an existing file from the gallery (which says nothing
// about when/where the photo was actually taken). Stays open across
// multiple captures — a site visit usually produces more than one photo —
// closed explicitly via Done or Escape. With `singleShot` it closes on its
// own after one capture instead (the photo shows up where it was asked for). The plain <input type="file"
// capture="environment"> next to it is kept too, since this getUserMedia
// path needs a secure context (HTTPS/localhost) and camera permission, and
// simply won't be available on every device/browser.
export default function CameraCapture({ onCapture, onClose, title = 'Take Site Photo', hint = null, singleShot = false }) {
  const videoRef = useRef(null)
  const streamRef = useRef(null)
  const [error, setError] = useState(null)
  const [shotCount, setShotCount] = useState(0)
  // Device location while the camera is open, attached to each capture.
  // A canvas-made JPEG carries no EXIF, so this is the only GPS these photos get.
  const positionRef = useRef(null)
  const [locationState, setLocationState] = useState('locating') // locating | ready | unavailable
  const [accuracy, setAccuracy] = useState(null)

  useEffect(() => {
    if (!navigator.geolocation) {
      setLocationState('unavailable')
      return undefined
    }
    const watchId = navigator.geolocation.watchPosition(
      (position) => {
        positionRef.current = {
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracy: position.coords.accuracy,
        }
        setAccuracy(position.coords.accuracy)
        setLocationState('ready')
      },
      () => {
        if (!positionRef.current) setLocationState('unavailable')
      },
      { enableHighAccuracy: true, maximumAge: 10000, timeout: 20000 },
    )
    return () => navigator.geolocation.clearWatch(watchId)
  }, [])

  useEffect(() => {
    let cancelled = false

    async function start() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment' },
          audio: false,
        })
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop())
          return
        }
        streamRef.current = stream
        if (videoRef.current) videoRef.current.srcObject = stream
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not access the camera.')
      }
    }
    start()

    return () => {
      cancelled = true
      streamRef.current?.getTracks().forEach((track) => track.stop())
      streamRef.current = null
    }
  }, [])

  useEffect(() => {
    function handleKeyDown(event) {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  function capture() {
    const video = videoRef.current
    if (!video || !video.videoWidth) return
    const canvas = document.createElement('canvas')
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    canvas.getContext('2d').drawImage(video, 0, 0)
    canvas.toBlob(
      (blob) => {
        if (!blob) return
        const file = new File([blob], `site-photo-${Date.now()}.jpg`, { type: 'image/jpeg' })
        onCapture(file, positionRef.current)
        if (singleShot) onClose()
        else setShotCount((count) => count + 1)
      },
      'image/jpeg',
      0.9,
    )
  }

  return createPortal(
    <div className="fixed inset-0 z-1100 flex items-center justify-center bg-slate-950/80 px-4">
      <div className="w-full max-w-lg overflow-hidden rounded-2xl bg-slate-900 shadow-2xl">
        <div className="flex items-center justify-between px-4 py-3">
          <p className="text-sm font-medium text-white">{title}{shotCount > 0 ? ` (${shotCount} taken)` : ''}</p>
          <button
            type="button"
            aria-label="Close camera"
            onClick={onClose}
            className="rounded-md p-1 text-slate-300 hover:bg-white/10 hover:text-white"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>

        {error ? (
          <div className="flex flex-col items-center gap-2 px-6 py-12 text-center">
            <CameraOff className="h-8 w-8 text-slate-500" aria-hidden="true" />
            <p className="text-sm text-slate-300">{error}</p>
            <p className="text-xs text-slate-500">
              Use the regular file picker below instead, or check your browser's camera permission.
            </p>
          </div>
        ) : (
          <video ref={videoRef} autoPlay playsInline muted className="aspect-video w-full bg-black object-cover" />
        )}

        {hint ? <p className="px-4 pt-3 text-center text-xs text-slate-300">{hint}</p> : null}

        <p className="flex items-center justify-center gap-1.5 px-4 pt-3 text-xs text-slate-400">
          <MapPin
            className={`h-3.5 w-3.5 ${locationState === 'ready' ? 'text-emerald-400' : locationState === 'unavailable' ? 'text-amber-400' : ''}`}
            aria-hidden="true"
          />
          {locationState === 'ready'
            ? `Location tracked (±${Math.round(accuracy)} m)`
            : locationState === 'unavailable'
              ? 'Location unavailable — turn on location and allow access to tag photos'
              : 'Getting location...'}
        </p>

        <div className="flex items-center justify-center gap-3 px-4 py-4">
          <Button type="button" variant="secondary" size="sm" onClick={onClose}>
            {singleShot ? 'Cancel' : 'Done'}
          </Button>
          <Button type="button" icon={Camera} onClick={capture} disabled={!!error}>
            Capture
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
