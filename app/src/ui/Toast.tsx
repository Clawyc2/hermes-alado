import { useStore } from '@nanostores/react'
import { toast } from './toast-store'

export function ToastHost() {
  const current = useStore(toast)
  if (!current) return null
  return (
    <div className="toast" role="status" aria-live="polite" key={current.id}>
      {current.text}
    </div>
  )
}
