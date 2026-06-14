function normalizePhone(raw) {
  return String(raw || '').replace(/\D/g, '')
}

function maskPhone(raw) {
  let phone = normalizePhone(raw)
  if (phone.startsWith('86') && phone.length === 13) {
    phone = phone.slice(2)
  }
  if (!/^1\d{10}$/.test(phone)) {
    return ''
  }
  return `${phone.slice(0, 3)}****${phone.slice(7)}`
}

function orderCreatedAtMs(order) {
  const ms = Date.parse(String(order?.createdAt || ''))
  return Number.isNaN(ms) ? 0 : ms
}

function pickUserFirstOrder(orders) {
  return (Array.isArray(orders) ? orders : [])
    .slice()
    .sort((a, b) => orderCreatedAtMs(a) - orderCreatedAtMs(b))[0] || null
}

function formatIssueDateTime(raw) {
  const s = String(raw || '').trim()
  if (!s) {
    return ''
  }
  const d = new Date(s)
  if (Number.isNaN(d.getTime())) {
    return s.slice(0, 16)
  }
  const y = d.getFullYear()
  const m = `${d.getMonth() + 1}`.padStart(2, '0')
  const day = `${d.getDate()}`.padStart(2, '0')
  const hh = `${d.getHours()}`.padStart(2, '0')
  const mm = `${d.getMinutes()}`.padStart(2, '0')
  return `${y}-${m}-${day} ${hh}:${mm}`
}

function buildTrafficPartnerApprovedRowsForChannel(db, channelCode) {
  const code = String(channelCode || '').trim()
  if (!db || !code) {
    return []
  }
  const users = (Array.isArray(db.users) ? db.users : [])
    .filter(u => u && String(u.registerChannelCode || '').trim() === code)
  const orders = Array.isArray(db.orders) ? db.orders : []
  const rows = []

  for (const user of users) {
    const uid = String(user.id || '').trim()
    if (!uid) {
      continue
    }
    const firstOrder = pickUserFirstOrder(orders.filter(o => String(o?.mallUserId || '').trim() === uid))
    if (!firstOrder || firstOrder.status === 'reviewing' || !firstOrder.cardPackageIssued) {
      continue
    }
    rows.push({
      id: String(firstOrder.id || `${uid}-${code}`),
      issuedAt: formatIssueDateTime(firstOrder.cardPackageIssuedAt || firstOrder.createdAt),
      name: String(user.name || firstOrder.receiverName || '').trim() || '-',
      phone: maskPhone(user.phone || firstOrder.receiverPhone || ''),
      status: '已通过',
    })
  }

  return rows.sort((a, b) => String(b.issuedAt || '').localeCompare(String(a.issuedAt || '')))
}

module.exports = {
  buildTrafficPartnerApprovedRowsForChannel,
  maskPhone,
}
