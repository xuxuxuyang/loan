const ID_CARD_RE = /^[1-9]\d{5}(18|19|20)\d{2}(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])\d{3}[\dX]$/
const CONTACT_NAME_RE = /^[\u4e00-\u9fff\u3400-\u4DBFa-zA-Z· ]+$/

function normalizeName(value) {
  return String(value || '').trim().replace(/\s+/g, ' ').replace(/\u00b7|・|･/g, '·')
}

function normalizePhone(value) {
  return String(value || '').replace(/\D/g, '')
}

function validateContactName(value) {
  const name = normalizeName(value)
  return Boolean(name && name.length <= 32 && CONTACT_NAME_RE.test(name) && /[\u4e00-\u9fff\u3400-\u4DBFa-zA-Z]/.test(name))
}

function validateInstallmentProfile(payload, ownerPhoneRaw) {
  const body = payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : {}
  const name = normalizeName(body.name)
  if (!validateContactName(name)) {
    return { ok: false, code: 'INVALID_NAME', msg: '姓名格式不正确' }
  }

  const idNumber = String(body.idNumber || '').trim().toUpperCase()
  if (!ID_CARD_RE.test(idNumber)) {
    return { ok: false, code: 'INVALID_ID_NUMBER', msg: '身份证号格式不正确' }
  }

  const idCardFront = String(body.idCardFront || '').trim()
  const idCardBack = String(body.idCardBack || '').trim()
  const idCardHandheld = String(body.idCardHandheld || '').trim()
  if (!idCardFront || !idCardBack || !idCardHandheld) {
    return { ok: false, code: 'ID_CARD_IMAGES_REQUIRED', msg: '请完整上传三张身份证资料' }
  }

  const contactsRaw = Array.isArray(body.emergencyContacts) ? body.emergencyContacts : []
  if (contactsRaw.length !== 2) {
    return { ok: false, code: 'EMERGENCY_CONTACTS_REQUIRED', msg: '请完整填写两位紧急联系人' }
  }
  const ownerPhone = normalizePhone(ownerPhoneRaw)
  const emergencyContacts = []
  for (let i = 0; i < contactsRaw.length; i += 1) {
    const item = contactsRaw[i] && typeof contactsRaw[i] === 'object' ? contactsRaw[i] : {}
    const contactName = normalizeName(item.name)
    const phone = normalizePhone(item.phone)
    if (!validateContactName(contactName) || !/^1\d{10}$/.test(phone)) {
      return { ok: false, code: 'INVALID_EMERGENCY_CONTACT', msg: `第 ${i + 1} 位紧急联系人格式不正确` }
    }
    if (phone === ownerPhone) {
      return { ok: false, code: 'EMERGENCY_CONTACT_IS_SELF', msg: '紧急联系人不能填写本人手机号' }
    }
    emergencyContacts.push({ name: contactName, phone })
  }
  if (emergencyContacts[0].phone === emergencyContacts[1].phone) {
    return { ok: false, code: 'DUPLICATE_EMERGENCY_CONTACT', msg: '两位紧急联系人手机号不能相同' }
  }

  return {
    ok: true,
    value: {
      name,
      idNumber,
      idCardFront,
      idCardBack,
      idCardHandheld,
      emergencyContacts,
    },
  }
}

function isInstallmentProfileComplete(user) {
  if (!user || typeof user !== 'object') {
    return false
  }
  return validateInstallmentProfile(user, user.phone).ok
}

module.exports = {
  isInstallmentProfileComplete,
  normalizePhone,
  validateInstallmentProfile,
}
