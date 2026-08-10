const { isInstallmentProfileComplete } = require('./validation')

function maskName(value) {
  const name = String(value || '').trim()
  if (!name) return ''
  return `${name.slice(0, 1)}${'*'.repeat(Math.max(1, name.length - 1))}`
}

function maskPhone(value) {
  const phone = String(value || '').replace(/\D/g, '')
  return /^1\d{10}$/.test(phone) ? `${phone.slice(0, 3)}****${phone.slice(-4)}` : ''
}

function maskIdNumber(value) {
  const id = String(value || '').trim().toUpperCase()
  if (id.length < 7) return ''
  return `${id.slice(0, 3)}${'*'.repeat(Math.max(1, id.length - 7))}${id.slice(-4)}`
}

function buildProfileStatus(user) {
  const target = user && typeof user === 'object' ? user : {}
  const contacts = Array.isArray(target.emergencyContacts) ? target.emergencyContacts.slice(0, 2) : []
  const complete = isInstallmentProfileComplete(target)
  return {
    complete,
    canReuse: complete,
    nameMasked: maskName(target.name),
    idNumberMasked: maskIdNumber(target.idNumber),
    hasIdCardFront: Boolean(String(target.idCardFront || '').trim()),
    hasIdCardBack: Boolean(String(target.idCardBack || '').trim()),
    hasIdCardHandheld: Boolean(String(target.idCardHandheld || '').trim()),
    emergencyContactsMasked: contacts.map(item => ({
      nameMasked: maskName(item && item.name),
      phoneMasked: maskPhone(item && item.phone),
    })),
  }
}

module.exports = {
  buildProfileStatus,
  maskIdNumber,
  maskName,
  maskPhone,
}
