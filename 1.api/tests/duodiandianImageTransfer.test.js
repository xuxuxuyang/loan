const assert = require('node:assert/strict')
const test = require('node:test')

const { transferDuodiandianImage } = require('../src/duodiandianImageTransfer')

const tinyPng = Buffer.from(
  '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c6360000002000100ffff03000006000557bfabdc0000000049454e44ae426082',
  'hex',
)

function makeResponse({ ok = true, status = 200, contentType = 'image/png', body = tinyPng } = {}) {
  return {
    ok,
    status,
    headers: {
      get(name) {
        return String(name).toLowerCase() === 'content-type' ? contentType : ''
      },
    },
    async arrayBuffer() {
      return body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength)
    },
  }
}

test('downloads a supported duodiandian image and uploads with detected mime metadata', async () => {
  const uploads = []
  const result = await transferDuodiandianImage({
    url: 'https://img.example.com/id?id=1',
    scene: 'front',
    phone: '13900139000',
    applyNo: 'A001',
  }, {
    fetchImpl: async (_url, options) => {
      assert.equal(options.signal.aborted, false)
      return makeResponse()
    },
    uploadImage: async (args) => {
      uploads.push(args)
      return { url: 'https://oss.example.com/front.png', key: 'front.png' }
    },
    now: () => 1748400093574,
  })

  assert.equal(result.url, 'https://oss.example.com/front.png')
  assert.equal(result.originalUrl, 'https://img.example.com/id?id=1')
  assert.equal(result.contentType, 'image/png')
  assert.equal(result.size, tinyPng.length)
  assert.equal(uploads[0].contentType, 'image/png')
  assert.equal(uploads[0].originalName, 'duodiandian-A001-front.png')
})

test('rejects unsupported formats and oversized duodiandian images before upload', async () => {
  await assert.rejects(
    () => transferDuodiandianImage({
      url: 'https://img.example.com/a.gif',
      scene: 'front',
      phone: '13900139000',
      applyNo: 'A001',
    }, {
      fetchImpl: async () => makeResponse({ contentType: 'image/gif', body: Buffer.from('GIF89a') }),
      uploadImage: async () => {
        throw new Error('upload should not run')
      },
    }),
    /unsupported|格式|image/i,
  )

  await assert.rejects(
    () => transferDuodiandianImage({
      url: 'https://img.example.com/large.png',
      scene: 'front',
      phone: '13900139000',
      applyNo: 'A001',
    }, {
      fetchImpl: async () => makeResponse({ body: Buffer.alloc(10) }),
      uploadImage: async () => {
        throw new Error('upload should not run')
      },
      maxBytes: 5,
    }),
    /too large|过大|size/i,
  )
})

test('times out slow duodiandian image reads and uploads', async () => {
  await assert.rejects(
    () => transferDuodiandianImage({
      url: 'https://img.example.com/slow.png',
      scene: 'front',
      phone: '13900139000',
      applyNo: 'A001',
    }, {
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        headers: { get: () => 'image/png' },
        async arrayBuffer() {
          await new Promise(resolve => setTimeout(resolve, 30))
          return tinyPng.buffer.slice(tinyPng.byteOffset, tinyPng.byteOffset + tinyPng.byteLength)
        },
      }),
      uploadImage: async () => {
        throw new Error('upload should not run')
      },
      timeoutMs: 5,
    }),
    /timeout/i,
  )

  await assert.rejects(
    () => transferDuodiandianImage({
      url: 'https://img.example.com/front.png',
      scene: 'front',
      phone: '13900139000',
      applyNo: 'A001',
    }, {
      fetchImpl: async () => makeResponse(),
      uploadImage: async () => {
        await new Promise(resolve => setTimeout(resolve, 30))
        return { url: 'https://oss.example.com/front.png', key: 'front.png' }
      },
      uploadTimeoutMs: 5,
    }),
    /upload timeout/i,
  )
})
