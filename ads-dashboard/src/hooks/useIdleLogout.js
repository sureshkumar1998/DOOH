import { useEffect, useRef } from 'react'

const ACTIVITY_EVENTS = ['mousemove', 'keydown', 'click', 'scroll', 'touchstart']

/**
 * Calls onLogout() after timeoutMs of user inactivity.
 * Resets the timer on any mouse/keyboard/touch/scroll activity.
 */
export default function useIdleLogout(timeoutMs, onLogout) {
  const timerRef = useRef(null)
  const onLogoutRef = useRef(onLogout)
  onLogoutRef.current = onLogout

  useEffect(() => {
    function reset() {
      clearTimeout(timerRef.current)
      timerRef.current = setTimeout(() => onLogoutRef.current(), timeoutMs)
    }

    reset()
    ACTIVITY_EVENTS.forEach((evt) => window.addEventListener(evt, reset, { passive: true }))

    return () => {
      clearTimeout(timerRef.current)
      ACTIVITY_EVENTS.forEach((evt) => window.removeEventListener(evt, reset))
    }
  }, [timeoutMs])
}
