import type { VNode } from 'vue'

type MessageType = 'success' | 'warning' | 'error' | 'info'

let epLoadPromise: Promise<{
  ElMessage: {
    success: (message: string) => void
    warning: (message: string) => void
    error: (message: string) => void
    info: (message: string) => void
  }
  ElMessageBox: {
    confirm: (message: string | VNode, title: string, options?: Record<string, unknown>) => Promise<unknown>
    alert: (message: string | VNode, title: string, options?: Record<string, unknown>) => Promise<unknown>
  }
}> | null = null

function loadEpFeedback() {
  if (!epLoadPromise) {
    epLoadPromise = Promise.all([
      import('element-plus/es/components/message/style/css'),
      import('element-plus/es/components/message-box/style/css'),
      import('element-plus/es/components/message/index'),
      import('element-plus/es/components/message-box/index'),
    ]).then(([, , messageModule, messageBoxModule]) => ({
      ElMessage: messageModule.ElMessage,
      ElMessageBox: messageBoxModule.ElMessageBox,
    }))
  }
  return epLoadPromise
}

function notify(type: MessageType, message: string) {
  void loadEpFeedback().then(({ ElMessage }) => {
    ElMessage[type](message)
  })
}

export function notifySuccess(message: string) {
  notify('success', message)
}

export function notifyWarning(message: string) {
  notify('warning', message)
}

export function notifyError(message: string) {
  notify('error', message)
}

export function notifyInfo(message: string) {
  notify('info', message)
}

export async function confirmDialog(message: string | VNode, title: string, options?: Record<string, unknown>) {
  const { ElMessageBox } = await loadEpFeedback()
  return ElMessageBox.confirm(message, title, options)
}

export async function alertDialog(message: string | VNode, title: string, options?: Record<string, unknown>) {
  const { ElMessageBox } = await loadEpFeedback()
  return ElMessageBox.alert(message, title, options)
}
