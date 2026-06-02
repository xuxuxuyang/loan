import NProgress from 'nprogress'

NProgress.configure({
  showSpinner: false,
  minimum: 0.16,
  trickleSpeed: 120,
})

let pendingCount = 0

export function startPageProgress() {
  if (pendingCount === 0) {
    NProgress.start()
  }
  pendingCount += 1
}

export function donePageProgress() {
  if (pendingCount <= 0) return
  pendingCount -= 1
  if (pendingCount === 0) {
    NProgress.done()
  }
}
