import { atom } from 'nanostores'

/** One short status line at the bottom ("Sent to Pancho"), gone after a few seconds. */
export const toast = atom<{ id: number; text: string } | null>(null)

let seq = 0
let timer: ReturnType<typeof setTimeout> | null = null

export function showToast(text: string, ms = 3500): void {
  const id = ++seq
  toast.set({ id, text })
  if (timer) clearTimeout(timer)
  timer = setTimeout(() => {
    if (toast.get()?.id === id) toast.set(null)
  }, ms)
}
