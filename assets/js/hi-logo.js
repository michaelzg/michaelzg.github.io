const titleLink = document.querySelector('.site-title--terminal')

if (titleLink instanceof HTMLAnchorElement) {
  const commandNode = titleLink.querySelector('.site-title__command')
  const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)')
  const commandText = titleLink.dataset['terminalCommand'] ?? 'hi'
  const animationPlayedKey = 'hi-logo-animation-played'

  let timers = []

  const chars = Array.from(commandText)

  function setTypedCount(count) {
    if (!(commandNode instanceof HTMLSpanElement)) return
    const safeCount = Math.max(0, Math.min(chars.length, count))
    const visibleText = Array.from(commandText).slice(0, safeCount).join('')
    commandNode.textContent = visibleText
  }

  function clearTimers() {
    for (let index = 0; index < timers.length; index++) {
      window.clearTimeout(timers[index])
    }
    timers = []
  }

  function queue(ms, fn) {
    const timer = window.setTimeout(() => {
      timers = timers.filter(active => active !== timer)
      fn()
    }, ms)
    timers.push(timer)
  }

  function finishTyping() {
    clearTimers()
    titleLink.classList.remove('site-title--typing')
    setTypedCount(chars.length)
  }

  function hasPlayedInSession() {
    try {
      if (window.sessionStorage.getItem(animationPlayedKey)) {
        return true
      }

      window.sessionStorage.setItem(animationPlayedKey, 'true')
      return false
    } catch (error) {
      return false
    }
  }

  function playTyping() {
    clearTimers()

    if (prefersReducedMotion.matches) {
      finishTyping()
      return
    }

    titleLink.classList.add('site-title--typing')
    setTypedCount(0)

    const baseDelay = 140
    const stepDelay = 120

    for (let index = 0; index < chars.length; index++) {
      queue(baseDelay + index * stepDelay, () => {
        setTypedCount(index + 1)
      })
    }

    queue(baseDelay + chars.length * stepDelay + 60, finishTyping)
  }

  function boot() {
    titleLink.classList.add('site-title--ready')

    if (prefersReducedMotion.matches || hasPlayedInSession()) {
      finishTyping()
    } else {
      playTyping()
    }

    if (typeof prefersReducedMotion.addEventListener === 'function') {
      prefersReducedMotion.addEventListener('change', () => {
        finishTyping()
      })
    }
  }
  boot()
}
