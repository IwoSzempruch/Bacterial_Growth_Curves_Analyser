import { useEffect, useRef, useState } from 'react'

export function useMeasuredWidth<T extends HTMLElement>() {
  const ref = useRef<T | null>(null)
  const [width, setWidth] = useState<number>(0)

  useEffect(() => {
    const el = ref.current
    if (!el) return

    const measure = () => {
      setWidth(Math.max(0, Math.floor(el.getBoundingClientRect().width)))
    }

    let ro: ResizeObserver | null = null

    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(() => measure())
      ro.observe(el)
    } else {
      window.addEventListener('resize', measure)
    }

    measure()

    return () => {
      if (ro) ro.disconnect()
      else window.removeEventListener('resize', measure)
    }
  }, [])

  return { ref, width }
}
