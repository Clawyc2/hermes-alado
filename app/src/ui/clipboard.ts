/**
 * Clipboard helper shared across the app.
 * navigator.clipboard first (needs a secure context + user gesture);
 * hidden-textarea + execCommand fallback for non-secure contexts.
 * The fallback uses fontSize 16px so iOS doesn't zoom on focus.
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    try {
      const ta = document.createElement('textarea')
      ta.value = text
      ta.readOnly = true
      ta.style.position = 'fixed'
      ta.style.opacity = '0'
      ta.style.fontSize = '16px'
      document.body.appendChild(ta)
      ta.select()
      document.execCommand('copy')
      document.body.removeChild(ta)
      return true
    } catch {
      return false
    }
  }
}
