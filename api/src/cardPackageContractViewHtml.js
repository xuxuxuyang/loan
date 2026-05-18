/**
 * 卡包本地模拟合同：专业版《商品购销及服务协议》式 HTML（UTF-8）
 * 结构与常见先享后付商城三方协议一致，关键字通过环境变量配置为与本商城主体一致。
 */

function escapeHtml(text) {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function fmtMoney(n) {
  const x = Number(n || 0)
  if (!Number.isFinite(x)) {
    return '0.00'
  }
  return x.toFixed(2)
}

function fmtDateTime(iso) {
  if (!iso) {
    return ''
  }
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) {
    return String(iso)
  }
  const y = d.getFullYear()
  const m = `${d.getMonth() + 1}`.padStart(2, '0')
  const day = `${d.getDate()}`.padStart(2, '0')
  const hh = `${d.getHours()}`.padStart(2, '0')
  const mm = `${d.getMinutes()}`.padStart(2, '0')
  return `${y}-${m}-${day} ${hh}:${mm}`
}

function fmtDateYmd(iso) {
  if (!iso) {
    return '—'
  }
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) {
    return String(iso).slice(0, 10)
  }
  const y = d.getFullYear()
  const m = `${d.getMonth() + 1}`.padStart(2, '0')
  const day = `${d.getDate()}`.padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** 协议中的乙方（商户）、丙方（平台）等展示信息：请在 api/.env 中配置为企业真实信息 */
function mallContractBrandFromEnv() {
  return {
    docTitle: String(process.env.MALL_CONTRACT_DOC_TITLE || '商品购销及服务协议（先享后付商城）').trim(),
    platformName: String(process.env.MALL_PLATFORM_NAME || process.env.MALL_CONTRACT_PLATFORM_NAME || '商城先享后付服务平台').trim(),
    platformUscc: String(process.env.MALL_CONTRACT_PLATFORM_USCC || '—').trim(),
    platformAddress: String(process.env.MALL_CONTRACT_PLATFORM_ADDRESS || '—').trim(),
    platformPhone: String(process.env.MALL_CONTRACT_PLATFORM_PHONE || '—').trim(),
    platformLegal: String(process.env.MALL_CONTRACT_PLATFORM_LEGAL || '—').trim(),
    merchantName: String(process.env.MALL_CONTRACT_MERCHANT_NAME || '宁波海曙文硕贸易商行').trim(),
    merchantUscc: String(process.env.MALL_CONTRACT_MERCHANT_USCC || '92330203MACLPR42X1').trim(),
    merchantAddress: String(process.env.MALL_CONTRACT_MERCHANT_ADDRESS || '浙江省宁波市海曙区高桥镇新丰路1107弄25号516室').trim(),
    merchantPhone: String(process.env.MALL_CONTRACT_MERCHANT_PHONE || '18968327662').trim(),
    merchantLegal: String(process.env.MALL_CONTRACT_MERCHANT_LEGAL || '竺文军').trim(),
    serviceHotline: String(process.env.MALL_CONTRACT_SERVICE_HOTLINE || '').trim(),
    disputeClause: String(process.env.MALL_CONTRACT_DISPUTE_TEXT || '').trim()
      || '因本协议引起的或与本协议有关的争议，各方应友好协商；协商不成的，任何一方均可向丙方住所地有管辖权的人民法院提起诉讼。',
    creditHotlineNote: String(process.env.MALL_CONTRACT_CREDIT_HOTLINE_NOTE || '').trim()
      || '如您对本协议或征信授权条款有疑问，可于工作日通过丙方公示的客服渠道咨询。',
  }
}

/**
 * @param {{
 *   order: Record<string, unknown>,
 *   user: Record<string, unknown> | null | undefined,
 *   phone: string,
 *   contractNo: string,
 *   contractTitle: string,
 *   signedAt?: string,
 *   apiOrigin: string,
 *   orderId: string,
 *   forPdfSnapshot?: boolean,
 * }} p
 */
function buildCardPackageContractViewHtml(p) {
  const brand = mallContractBrandFromEnv()
  const order = p.order || {}
  const user = p.user || {}
  const phone = escapeHtml(p.phone)
  const contractNo = escapeHtml(p.contractNo || '')
  const docTitle = escapeHtml(brand.docTitle || p.contractTitle || '商品购销及服务协议')
  const orderId = escapeHtml(String(p.orderId || ''))

  const buyerName = escapeHtml(String(user.name || '').trim() || '—')
  const idNumberRaw = String(user.idNumber || '').trim()
  const idNumber = escapeHtml(idNumberRaw)
  const residence = escapeHtml(String(user.locationText || '').trim() || '—')
  const productName = escapeHtml(String(order.name || '—').trim())
  const productSpec = escapeHtml(String(order.spec || '').trim() || '—')
  const totalAmt = escapeHtml(fmtMoney(order.totalAmount))
  const recvName = escapeHtml(String(order.receiverName || '').trim() || '—')
  const recvPhone = escapeHtml(String(order.receiverPhone || '').trim() || '—')
  const recvAddr = escapeHtml(String(order.receiverAddress || '').trim() || '—')
  const orderDate = escapeHtml(fmtDateYmd(order.createdAt))

  const platName = escapeHtml(brand.platformName)
  const platUscc = escapeHtml(brand.platformUscc)
  const platAddr = escapeHtml(brand.platformAddress)
  const platPhone = escapeHtml(brand.platformPhone)
  const platLegal = escapeHtml(brand.platformLegal)
  const merName = escapeHtml(brand.merchantName)
  const merUscc = escapeHtml(brand.merchantUscc)
  const merAddr = escapeHtml(brand.merchantAddress)
  const merPhone = escapeHtml(brand.merchantPhone)
  const merLegal = escapeHtml(brand.merchantLegal)
  const disputeHtml = escapeHtml(brand.disputeClause)
  const creditNote = escapeHtml(brand.creditHotlineNote)

  const signedAt = p.signedAt ? escapeHtml(fmtDateTime(p.signedAt)) : ''
  const alreadySigned = Boolean(p.signedAt)
  const forPdf = Boolean(p.forPdfSnapshot)

  const oidEnc = encodeURIComponent(String(p.orderId || ''))
  const phoneEnc = encodeURIComponent(String(p.phone || ''))
  const ackUrl = `${p.apiOrigin}/api/card-packages/${oidEnc}/contract-ack?phone=${phoneEnc}`

  const signGuideNameRaw = String(user.name || '').trim()
  const signGuideBadDisplay = new Set(['—', '-', '―', '－', '暂无', '无', '未填写'])
  const signGuideEligible = signGuideNameRaw.length >= 2 && !signGuideBadDisplay.has(signGuideNameRaw)
  const signGuideNameJson = JSON.stringify(signGuideEligible ? signGuideNameRaw : '')

  const sigReadStored = String(order.cardPackageContractSignaturePng || '').trim()
  const sigReadImgHtml = sigReadStored.startsWith('data:image/')
    ? `<div class="sig-readonly"><p class="muted sig-readonly-label">甲方手写签</p><img class="sig-readonly-img" src="${sigReadStored.replace(/"/g, '')}" alt="" /></div>`
    : ''

  const signBlock = forPdf
    ? (alreadySigned
        ? `<div class="signed-banner">您已于 ${signedAt} 在本页完成手写签名并提交。本 PDF 所载正文与签署当时页面展示内容一致。</div>${sigReadImgHtml}`
        : `<div class="warn"><strong>说明：</strong>本 PDF 载明订单及您的身份与联系信息，便于留存核对；<strong class="hl">在线电子签署</strong>请在商城「卡包」流程内手写签名并提交后方可生效。</div>`)
    : (alreadySigned
        ? `<div class="signed-banner">您已于 ${signedAt} 在本页完成手写签名并提交，可关闭窗口返回商城。</div>${sigReadImgHtml}`
        : `<div class="sign-area">
        <div class="sig-wrap">
          <p class="sig-label">${signGuideEligible
    ? '请在下层<strong class="hl">浅色姓名笔画</strong>上描摹书写，笔画尽量与背景轨迹重合；签名完成后于下方勾选条款，再点击「提交签署」。'
    : '请在下方<strong class="hl">手写签名</strong>（支持触摸屏或鼠标），字迹应清晰可辨；完成后于下方勾选条款并提交。'}</p>
          <div class="sig-stack" id="sig-stack">
            <canvas id="sig-guide" class="sig-canvas sig-canvas-guide" width="600" height="320" aria-hidden="true"></canvas>
            <canvas id="sig-canvas" class="sig-canvas sig-canvas-ink" width="600" height="320" aria-label="签名书写层"></canvas>
          </div>
          <button type="button" class="btn-secondary" id="sig-clear">清除重写</button>
        </div>
        <label class="chk chk-below-sig"><input type="checkbox" id="agree"> 本人（甲方）已完整阅读并理解本协议及附件全部条款（含加粗提示），自愿与乙方、丙方达成合意并承担相应履约责任。</label>
        <button type="button" class="btn-primary" id="btn-sign" disabled>提交签署</button>
        <p class="hint" id="hint"></p>
      </div>`)

  const script = (forPdf || alreadySigned)
    ? ''
    : `<script>
(function(){
  var SIGN_GUIDE_NAME = ${signGuideNameJson};
  var agree = document.getElementById('agree');
  var btn = document.getElementById('btn-sign');
  var hint = document.getElementById('hint');
  var guideCanvas = document.getElementById('sig-guide');
  var inkCanvas = document.getElementById('sig-canvas');
  var btnClear = document.getElementById('sig-clear');
  var stack = document.getElementById('sig-stack');
  if (!agree || !btn || !guideCanvas || !inkCanvas || !btnClear) return;
  var gctx = guideCanvas.getContext('2d');
  var ctx = inkCanvas.getContext('2d');
  if (!gctx || !ctx) return;
  var drawing = false;
  var hasInk = false;
  var last = { x: 0, y: 0 };
  var inkSamples = [];
  var guideLayout = { ready: false, boxes: [], fontPx: 0, cx: 0, cy: 0 };
  var wCss = 300;
  var hCss = 260;

  function layoutCssSize() {
    var rect = (stack || inkCanvas).getBoundingClientRect();
    wCss = Math.max(300, Math.floor(rect.width));
    hCss = 260;
  }

  function drawGuideLayer() {
    layoutCssSize();
    var dpr = window.devicePixelRatio || 1;
    var pw = Math.floor(wCss * dpr);
    var ph = Math.floor(hCss * dpr);
    guideCanvas.width = pw;
    guideCanvas.height = ph;
    gctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    gctx.fillStyle = '#fafafa';
    gctx.fillRect(0, 0, wCss, hCss);
    guideLayout.ready = false;
    guideLayout.boxes = [];
    if (!SIGN_GUIDE_NAME) return;
    var padX = 10;
    var maxW = wCss - padX * 2;
    var fontPx = Math.min(96, Math.floor(wCss * 0.36));
    var fp;
    for (fp = fontPx; fp >= 22; fp -= 2) {
      gctx.font = 'bold ' + fp + 'px "Microsoft YaHei","PingFang SC","SimHei",sans-serif';
      if (gctx.measureText(SIGN_GUIDE_NAME).width <= maxW) {
        fontPx = fp;
        break;
      }
    }
    gctx.textAlign = 'center';
    gctx.textBaseline = 'middle';
    gctx.lineJoin = 'round';
    gctx.lineCap = 'round';
    var cx = wCss / 2;
    var cy = hCss / 2;
    var lw = Math.max(2.8, fontPx * 0.14);
    gctx.lineWidth = lw;
    gctx.strokeStyle = 'rgba(11, 123, 110, 0.38)';
    gctx.strokeText(SIGN_GUIDE_NAME, cx, cy);
    gctx.fillStyle = 'rgba(11, 123, 110, 0.07)';
    gctx.fillText(SIGN_GUIDE_NAME, cx, cy);
    gctx.lineWidth = lw * 0.45;
    gctx.strokeStyle = 'rgba(15, 23, 42, 0.16)';
    gctx.strokeText(SIGN_GUIDE_NAME, cx, cy);
    var tw = gctx.measureText(SIGN_GUIDE_NAME).width;
    var chars = Array.from(SIGN_GUIDE_NAME);
    var startX = cx - tw / 2;
    var curX = startX;
    var halfH = fontPx * 0.56;
    guideLayout.ready = true;
    guideLayout.fontPx = fontPx;
    guideLayout.cx = cx;
    guideLayout.cy = cy;
    guideLayout.boxes = [];
    for (var ci = 0; ci < chars.length; ci++) {
      var cw = gctx.measureText(chars[ci]).width;
      guideLayout.boxes.push({ x0: curX, x1: curX + cw, y0: cy - halfH, y1: cy + halfH });
      curX += cw;
    }
  }

  function clearInkLayer() {
    layoutCssSize();
    var dpr = window.devicePixelRatio || 1;
    inkCanvas.width = Math.floor(wCss * dpr);
    inkCanvas.height = Math.floor(hCss * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, wCss, hCss);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = 2.35;
    ctx.strokeStyle = '#0f172a';
    ctx.globalAlpha = 1;
    inkSamples = [];
  }

  function fitAll() {
    drawGuideLayer();
    clearInkLayer();
    hasInk = false;
    syncBtn();
  }

  function getPos(ev) {
    var r = inkCanvas.getBoundingClientRect();
    return { x: ev.clientX - r.left, y: ev.clientY - r.top };
  }

  function syncBtn() {
    btn.disabled = !(agree.checked && hasInk);
  }

  function clearPad() {
    fitAll();
  }

  function totalPathLengthCss(pts) {
    var s = 0;
    for (var i = 1; i < pts.length; i++) {
      var a = pts[i - 1], b = pts[i];
      s += Math.hypot(b.x - a.x, b.y - a.y);
    }
    return s;
  }

  function sampleStrokeAlong(from, to) {
    var dx = to.x - from.x;
    var dy = to.y - from.y;
    var d = Math.hypot(dx, dy);
    if (d < 0.4) return;
    var step = 3.5;
    var n = Math.max(1, Math.ceil(d / step));
    for (var i = 1; i <= n; i++) {
      var t = i / n;
      inkSamples.push({ x: from.x + dx * t, y: from.y + dy * t });
    }
  }

  function dilateCellMap(map, radius, gwCells) {
    var out = {};
    var k, idx, ix, iy, dy, dx;
    function ck(ix2, iy2) { return String(iy2 * gwCells + ix2); }
    for (k in map) {
      if (!Object.prototype.hasOwnProperty.call(map, k)) continue;
      idx = Number(k);
      if (!Number.isFinite(idx)) continue;
      ix = idx % gwCells;
      iy = Math.floor(idx / gwCells);
      for (dy = -radius; dy <= radius; dy++) {
        for (dx = -radius; dx <= radius; dx++) {
          if (Math.abs(dx) + Math.abs(dy) <= radius) {
            out[ck(ix + dx, iy + dy)] = 1;
          }
        }
      }
    }
    return out;
  }

  function minDistPointToSamples(px, py, pts) {
    var best = 1e18;
    var i, q, d;
    for (i = 0; i < pts.length; i++) {
      q = pts[i];
      d = (px - q.x) * (px - q.x) + (py - q.y) * (py - q.y);
      if (d < best) best = d;
    }
    return Math.sqrt(best);
  }

  /** 轨迹 + 字形走廊：拒绝与姓名笔画无关的大叉乱涂 */
  function validateSignatureTrajectoryStrict() {
    if (!SIGN_GUIDE_NAME) return true;
    if (!guideLayout.ready || !guideLayout.boxes.length) return true;
    var gw = guideCanvas.width;
    var gh = guideCanvas.height;
    if (gw < 24 || gh < 24) return true;
    if (inkSamples.length < 14) return false;
    var plen = totalPathLengthCss(inkSamples);
    var minLen = guideLayout.fontPx * (0.75 * guideLayout.boxes.length + 0.35);
    if (plen < minLen) return false;

    var marginCss = 10;
    var i, b, cnt, q;
    for (i = 0; i < guideLayout.boxes.length; i++) {
      b = guideLayout.boxes[i];
      cnt = 0;
      for (var j = 0; j < inkSamples.length; j++) {
        q = inkSamples[j];
        if (q.x >= b.x0 - marginCss && q.x <= b.x1 + marginCss && q.y >= b.y0 - marginCss && q.y <= b.y1 + marginCss) {
          cnt++;
        }
      }
      var need = Math.max(5, Math.min(10, Math.ceil(22 / guideLayout.boxes.length)));
      if (cnt < need) return false;
    }

    var gctx2 = guideCanvas.getContext('2d', { willReadFrequently: true });
    var uctx2 = inkCanvas.getContext('2d', { willReadFrequently: true });
    var gImg = gctx2.getImageData(0, 0, gw, gh);
    var uImg = uctx2.getImageData(0, 0, gw, gh);
    var gd = gImg.data;
    var ud = uImg.data;
    var cell = Math.max(2, Math.round((window.devicePixelRatio || 1) * 2));
    var gwCells = Math.ceil(gw / cell);
    function ckey(ix, iy) { return iy * gwCells + ix; }
    var guideMap = {};
    var userMap = {};
    var x, y, ii, dr;
    for (y = 0; y < gh; y += cell) {
      for (x = 0; x < gw; x += cell) {
        ii = (y * gw + x) * 4;
        dr = Math.abs(gd[ii] - 250) + Math.abs(gd[ii + 1] - 250) + Math.abs(gd[ii + 2] - 250);
        if (gd[ii + 3] > 14 && dr > 7) {
          guideMap[ckey(Math.floor(x / cell), Math.floor(y / cell))] = 1;
        }
      }
    }
    var gk = Object.keys(guideMap);
    var guideCount = gk.length;
    if (guideCount < 20) return true;

    for (y = 0; y < gh; y += cell) {
      for (x = 0; x < gw; x += cell) {
        ii = (y * gw + x) * 4;
        if (ud[ii + 3] > 22) {
          userMap[ckey(Math.floor(x / cell), Math.floor(y / cell))] = 1;
        }
      }
    }
    var corridor = dilateCellMap(guideMap, 5, gwCells);
    var userKeys = Object.keys(userMap);
    var uTot = userKeys.length;
    if (uTot < 8) return false;
    var outside = 0;
    for (i = 0; i < uTot; i++) {
      var uidx = Number(userKeys[i]);
      if (!corridor[uidx]) outside++;
    }
    if (outside / uTot > 0.055) return false;

    var covR = 3;
    var matched = 0;
    for (i = 0; i < gk.length; i++) {
      var gidx = Number(gk[i]);
      var gix = gidx % gwCells;
      var giy = Math.floor(gidx / gwCells);
      var hit = false;
      var dy, dx;
      for (dy = -covR; dy <= covR && !hit; dy++) {
        for (dx = -covR; dx <= covR; dx++) {
          if (userMap[ckey(gix + dx, giy + dy)]) { hit = true; break; }
        }
      }
      if (hit) matched++;
    }
    if (matched / guideCount < 0.62) return false;

    var cssPerPxX = wCss / gw;
    var cssPerPxY = hCss / gh;
    var sampleStep = Math.max(1, Math.floor(guideCount / 120));
    var nearPath = 0;
    var totalS = 0;
    for (i = 0; i < gk.length; i += sampleStep) {
      totalS++;
      var gi2 = Number(gk[i]);
      var gx = (gi2 % gwCells) * cell + cell * 0.5;
      var gy = Math.floor(gi2 / gwCells) * cell + cell * 0.5;
      var cpx = gx * cssPerPxX;
      var cpy = gy * cssPerPxY;
      if (minDistPointToSamples(cpx, cpy, inkSamples) <= 14) nearPath++;
    }
    if (totalS > 0 && nearPath / totalS < 0.58) return false;

    return true;
  }

  function exportMergedJpeg() {
    layoutCssSize();
    var dpr = window.devicePixelRatio || 1;
    var pw = Math.floor(wCss * dpr);
    var ph = Math.floor(hCss * dpr);
    var tmp = document.createElement('canvas');
    tmp.width = pw;
    tmp.height = ph;
    var t = tmp.getContext('2d');
    t.drawImage(guideCanvas, 0, 0);
    t.drawImage(inkCanvas, 0, 0);
    return tmp.toDataURL('image/jpeg', 0.88);
  }

  agree.addEventListener('change', syncBtn);
  btnClear.addEventListener('click', function() { clearPad(); });

  inkCanvas.addEventListener('pointerdown', function(e) {
    if (e.button === 2) return;
    e.preventDefault();
    try { inkCanvas.setPointerCapture(e.pointerId); } catch (err) {}
    drawing = true;
    last = getPos(e);
    inkSamples.push({ x: last.x, y: last.y });
  });
  inkCanvas.addEventListener('pointermove', function(e) {
    if (!drawing) return;
    e.preventDefault();
    var p = getPos(e);
    ctx.beginPath();
    ctx.moveTo(last.x, last.y);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    sampleStrokeAlong(last, p);
    last = p;
    hasInk = true;
    syncBtn();
  });
  function endDraw(e) {
    if (!drawing) return;
    drawing = false;
    try { if (e && e.pointerId != null) inkCanvas.releasePointerCapture(e.pointerId); } catch (err2) {}
  }
  inkCanvas.addEventListener('pointerup', endDraw);
  inkCanvas.addEventListener('pointercancel', endDraw);

  window.addEventListener('resize', function() {
    if (hasInk) return;
    drawGuideLayer();
    clearInkLayer();
  });

  requestAnimationFrame(function() { clearPad(); });

  btn.addEventListener('click', function() {
    if (!agree.checked || !hasInk) return;
    if (SIGN_GUIDE_NAME && !validateSignatureTrajectoryStrict()) {
      var hintMsg = '检测到签名轨迹与姓名描摹要求不符（请在浅色笔画上书写、避免整幅乱涂或单笔画叉），请清除后按笔画认真描摹再提交。';
      try {
        if (window.parent && window.parent !== window) {
          window.parent.postMessage({
            type: 'mall-card-package-signature-hint',
            orderId: ${JSON.stringify(String(p.orderId || ''))},
            message: hintMsg,
            variant: 'warning'
          }, '*');
        } else {
          window.alert(hintMsg);
        }
      } catch (e0) {
        try { window.alert(hintMsg); } catch (e1) {}
      }
      clearPad();
      hint.textContent = '';
      return;
    }
    btn.disabled = true;
    hint.textContent = '提交中…';
    var dataUrl = exportMergedJpeg();
    fetch(${JSON.stringify(ackUrl)}, {
      method: 'POST',
      headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ signaturePng: dataUrl })
    })
      .then(function(r){ return r.json().then(function(j){ return { ok: r.ok, j: j }; }); })
      .then(function(x){
        if (x.j && x.j.success) {
          hint.textContent = '';
          try {
            if (window.parent && window.parent !== window) {
              var pkg = (x.j && x.j.data && typeof x.j.data.cardPackageRow === 'object') ? x.j.data.cardPackageRow : null;
              window.parent.postMessage({ type: 'mall-card-package-contract-signed', orderId: ${JSON.stringify(String(p.orderId || ''))}, cardPackageRow: pkg }, '*');
            }
          } catch (e) {}
          document.body.innerHTML = '<div class="wrap"><div class="signed-banner ok">签署已成功记录，请关闭本页返回商城继续操作。</div></div>';
        } else {
          var errMsg = (x.j && x.j.msg) ? x.j.msg : '提交失败';
          hint.textContent = errMsg;
          btn.disabled = false;
        }
      })
      .catch(function(e){
        hint.textContent = e.message || '网络错误';
        btn.disabled = false;
      });
  });
})();
<\/script>`

  const idRowsUser = idNumberRaw
    ? `<tr><td>身份证号</td><td>${idNumber}</td></tr>`
    : ''

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${docTitle}</title>
  <style>
    body { font-family: "Microsoft YaHei", "PingFang SC", "SimSun", serif; margin: 0; background: #eef1f6; color: #1a1a1a; }
    .wrap { max-width: 52rem; margin: 0 auto; padding: 1rem 1rem 2.5rem; }
    .card { background: #fff; border-radius: .35rem; padding: 1.35rem 1.25rem 2rem; box-shadow: 0 4px 18px rgba(24,39,75,.07); border: 1px solid #e2e6ef; }
    .doc-head { text-align: center; margin-bottom: 1.25rem; }
    h1 { font-size: 1.35rem; margin: 0 0 .5rem; letter-spacing: .12em; font-weight: 700; }
    .sub-meta { font-size: .78rem; color: #444; line-height: 1.5; }
    .warn { font-size: .82rem; background: #fffbeb; border: 1px solid #fcd34d; color: #78350f; padding: .75rem .85rem; border-radius: .35rem; margin: 1rem 0; line-height: 1.65; }
    h2 { font-size: 1rem; margin: 1.35rem 0 .55rem; font-weight: 700; border-left: 4px solid #0b7b6e; padding-left: .5rem; }
    h3 { font-size: .92rem; margin: .85rem 0 .35rem; font-weight: 600; }
    p, li { font-size: .86rem; line-height: 1.75; margin: .4rem 0; text-align: justify; }
    .party-table { width: 100%; border-collapse: collapse; font-size: .82rem; margin: .6rem 0 1rem; }
    .party-table th, .party-table td { border: 1px solid #cbd5e1; padding: .45rem .5rem; vertical-align: top; }
    .party-table th { background: #f8fafc; width: 7rem; font-weight: 600; color: #334155; }
    .order-box { border: 1px solid #94a3b8; border-radius: .35rem; padding: .75rem .85rem; margin: .5rem 0; background: #f8fafc; }
    .muted { color: #64748b; font-size: .8rem; }
    ol.decimal { padding-left: 1.35rem; margin: .35rem 0; }
    ol.decimal li { margin: .35rem 0; }
    strong.hl { font-weight: 700; color: #0f172a; }
    .sign-area { margin-top: 1.5rem; padding-top: 1.1rem; border-top: 2px dashed #cbd5e1; }
    .sig-wrap { margin-top: .85rem; }
    .sig-label { font-size: .8rem; color: #334155; margin: 0 0 .45rem; line-height: 1.55; }
    .sig-stack {
      position: relative; width: 100%; height: 260px; min-height: 260px; max-width: 100%;
      border: 1px dashed #94a3b8; border-radius: .35rem; overflow: hidden;
      background: #fafafa;
    }
    .sig-stack .sig-canvas {
      position: absolute; left: 0; top: 0; width: 100%; height: 100%;
      display: block; border: none; border-radius: 0; background: transparent;
    }
    .sig-canvas-guide { pointer-events: none; z-index: 0; }
    .sig-canvas-ink { z-index: 1; touch-action: none; cursor: crosshair; }
    .btn-secondary {
      margin-top: .55rem; padding: .42rem .85rem; font-size: .8rem;
      border: 1px solid #cbd5e1; border-radius: .35rem; background: #fff;
      color: #334155; cursor: pointer;
    }
    .btn-secondary:active { background: #f1f5f9; }
    .sig-readonly { margin-top: .75rem; }
    .sig-readonly-label { margin: 0 0 .35rem; font-size: .82rem; }
    .sig-readonly-img { max-width: 100%; max-height: 140px; object-fit: contain; border: 1px solid #e2e8f0; border-radius: .35rem; background: #fafafa; }
    .chk { display: flex; gap: .55rem; align-items: flex-start; font-size: .84rem; cursor: pointer; line-height: 1.55; }
    .chk-below-sig { margin-top: .95rem; margin-bottom: .35rem; padding: .65rem .75rem; border-radius: .35rem; background: #f8fafc; border: 1px solid #e2e8f0; }
    .btn-primary {
      margin-top: .9rem; width: 100%; padding: .78rem 1rem; font-size: .95rem; font-weight: 600;
      color: #fff; border: none; border-radius: .45rem;
      background: linear-gradient(135deg, #0b7b6e, #0f766e); cursor: pointer;
    }
    .btn-primary:disabled { opacity: .45; cursor: not-allowed; }
    .hint { font-size: .8rem; color: #b45309; margin: .55rem 0 0; min-height: 1.2em; }
    .signed-banner { margin-top: 1rem; padding: .9rem; border-radius: .45rem; background: #ecfdf5; color: #065f46; font-size: .88rem; text-align: center; border: 1px solid #a7f3d0; }
    .signed-banner.ok { background: #ecfdf5; }
    .sig-row { display: grid; grid-template-columns: 1fr; gap: .75rem; margin-top: 1.25rem; font-size: .82rem; }
    @media print { body { background: #fff; } .sign-area .sig-stack, .sign-area .btn-secondary, .sign-area .btn-primary { display: none !important; } .wrap { max-width: 100%; } }
  </style>
</head>
<body>
  <div class="wrap">
    <div class="card">
      <div class="doc-head">
        <h1>${docTitle}</h1>
        <p class="sub-meta">协议编号：<strong>${contractNo}</strong>　｜　订单编号：<strong>${orderId}</strong>　｜　订单生成日：${orderDate}</p>
      </div>

      <div class="warn">
        <strong>特别提醒：</strong>请您在签署前仔细阅读本协议全部条款（特别是以<strong class="hl">加粗</strong>标示的条款），确保理解各条款含义及相应法律后果。
        您通过<strong class="hl">手写签名并提交</strong>即视为已阅读并接受本协议；若不同意，请停止使用本服务。
        ${brand.serviceHotline ? `客服电话：${escapeHtml(brand.serviceHotline)}。` : ''}
      </div>

      <h2>协议主体</h2>
      <p class="muted">本协议由以下三方就甲方通过<strong class="hl">${platName}</strong>（丙方运营的先享后付商城）向乙方购买商品/服务并就价款支付等事宜订立。</p>

      <table class="party-table" aria-label="甲方用户">
        <tr><th colspan="2">甲方（用户）</th></tr>
        <tr><td>姓名</td><td>${buyerName}</td></tr>
        ${idRowsUser}
        <tr><td>住所地</td><td>${residence}</td></tr>
        <tr><td>联系电话</td><td>${phone}</td></tr>
      </table>

      <table class="party-table" aria-label="乙方商家">
        <tr><th colspan="2">乙方（文硕商城）</th></tr>
        <tr><td>名称</td><td>${merName}</td></tr>
        <tr><td>统一社会信用代码</td><td>${merUscc}</td></tr>
        <tr><td>住所</td><td>${merAddr}</td></tr>
        <tr><td>法定代表人</td><td>${merLegal}</td></tr>
        <tr><td>联系电话</td><td>${merPhone}</td></tr>
      </table>

      <h2>第一条　术语定义</h2>
      <ol class="decimal">
        <li><strong class="hl">平台规则：</strong>指丙方在${platName}上公示的、与用户使用服务有关的规则（含购物流程、先享后付说明、售后政策等）。</li>
        <li><strong class="hl">订单：</strong>指甲方就特定商品提交并经乙方/丙方系统确认的交易指令，订单所载商品、价款、收货信息以系统记录为准。</li>
        <li><strong class="hl">先享后付支付 / 账期：</strong>指甲方将应付货款按约定<strong class="hl">期数与到期日</strong>先享后付偿付的支付方式（营销推广名称可能调整，以页面展示为准）。</li>
        <li><strong class="hl">应付款：</strong>指甲方基于本订单应向乙方支付的货款总额（含先享后付安排下的全部应付金额）。</li>
        <li><strong class="hl">到期付款日：</strong>指甲方各期款项的最晚支付日期，具体以本协议第二条账单或订单页为准。</li>
      </ol>

      <h2>第二条　标的与订单信息</h2>
      <div class="order-box">
        <p><strong>订单编号：</strong>${orderId}</p>
        <p><strong>商品名称：</strong>${productName}</p>
        <p><strong>规格 / 说明：</strong>${productSpec}</p>
        <p><strong>货款支付安排：</strong>先享后付支付（具体期数、每期金额及到期日以订单及账单为准）</p>
        <p><strong>应付款总额：</strong>人民币 <strong class="hl">￥${totalAmt}</strong> 元</p>
      </div>
      <p>甲乙双方确认：上述订单信息以丙方系统生成并经甲方确认的记录为准；商品交付、所有权转移及发票开具依照法律法规及平台规则执行。</p>

      <h2>第三条　交付与签收</h2>
      <ol class="decimal">
        <li><strong class="hl">收货信息：</strong>收件人 ${recvName}；联系电话 ${recvPhone}；收货地址 ${recvAddr}。</li>
        <li>乙方应在甲方下单成功后合理期限内发货；遇不可抗力或库存等原因需延期时，应及时通知甲方并可协商处理。</li>
        <li>甲方签收商品时应当场查验；如发现与订单严重不符，应在<strong class="hl">合理期限内</strong>按平台规则提出异议并留存凭证。</li>
      </ol>

      <h2>第四条　价款支付</h2>
      <p>甲方应按订单及账单约定的<strong class="hl">到期付款日</strong>足额支付各期款项。甲方可通过丙方平台提供的支付渠道主动还款；在符合法律法规及甲方授权的前提下，丙方可协助发起扣款。</p>
      <p><strong class="hl">逾期责任：</strong>甲方未按期足额支付的，乙方/丙方有权依据平台规则采取提醒、催收、限制下单、追究违约责任等措施；甲方应承担由此产生的合理费用（含催收、诉讼、律师费等，以法律规定及约定为准）。</p>

      <h2>第五条　违约责任</h2>
      <ol class="decimal">
        <li>任何一方违反本协议约定给对方造成损失的，应依法承担赔偿责任。</li>
        <li>甲方逾期支付任一期款项的，乙方有权要求甲方一次性支付<strong class="hl">剩余全部未付款项</strong>，并可主张自逾期之日起至清偿之日止的违约金（具体比例以平台公示为准，常见为应付未付部分的万分之五/日，若平台规则不同则以平台为准）。</li>
      </ol>

      <h2>第六条　争议解决</h2>
      <p>${disputeHtml}</p>

      <h2>第七条　征信与信息授权（摘要）</h2>
      <p>为履行本协议、评估信用及风险控制需要，甲方理解并同意：丙方可在<strong class="hl">合法合规</strong>前提下，向依法设立的征信机构或合作机构查询、报送甲方与信用相关的必要信息；甲方应按丙方要求完成实名认证及授权流程。</p>
      <p class="muted">${creditNote}</p>

      <h2>第八条　电子签署与生效</h2>
      <p>本协议以数据电文形式订立。甲方在丙方页面<strong class="hl">手写签名并提交</strong>即视为签署本协议；甲方与乙方、丙方之间权利义务以本协议及订单、平台规则为准。</p>

      <div class="sig-row">
        <p><strong>甲方（用户）确认：</strong>本人已阅读并理解上述全部条款。</p>
        <p><strong>乙方（商家）：</strong>${merName}</p>
        <p><strong>丙方（平台）：</strong>${platName}</p>
      </div>

      ${signBlock}
    </div>
  </div>
${script}
</body>
</html>`
}

module.exports = {
  buildCardPackageContractViewHtml,
  escapeHtml,
  mallContractBrandFromEnv,
}
