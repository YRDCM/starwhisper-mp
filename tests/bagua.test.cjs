const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const path = require('node:path')

// 把逐爻显现动画加速到 0ms，测试里 await sleep 等动画播完
const realSetInterval = setInterval
const fakeTimers = {
  setInterval: (fn) => realSetInterval(fn, 0),
  clearInterval,
  setTimeout: (fn) => setTimeout(fn, 0),
  clearTimeout
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function makePage(api = {}) {
  let page
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../pages/bagua/bagua.js'), 'utf8'), {
    Page: (value) => { page = value },
    require: () => api,
    ...fakeTimers
  })
  page.setData = (patch) => Object.assign(page.data, patch)
  return page
}

const CAST = {
  primary: { seqNumber: 24, name: '地雷复', lines: '100000', upperTrigram: '坤', lowerTrigram: '震', fortuneLevel: '中吉', judgment: '亨。出入无疾', meaning: '一阳来复' },
  changed: { seqNumber: 2, name: '坤为地', lines: '000000', upperTrigram: '坤', lowerTrigram: '坤', fortuneLevel: '上上', judgment: '元亨', meaning: '厚德载物' },
  changingLines: [1],
  linesDetail: [
    { position: 1, label: '老阳', yang: true, changing: true },
    { position: 2, label: '少阴', yang: false, changing: false },
    { position: 3, label: '少阴', yang: false, changing: false },
    { position: 4, label: '少阴', yang: false, changing: false },
    { position: 5, label: '少阴', yang: false, changing: false },
    { position: 6, label: '少阴', yang: false, changing: false }
  ]
}

test('AI 解卦：未起卦不请求；起卦后请求带卦面身份与问题；成功后不重复请求', async () => {
  let sent
  const page = makePage({
    fetchBaguaDaily: async () => null,
    castBagua: async () => CAST,
    fetchBaguaReading: async (payload) => { sent = payload; return { summary: '总览', detail: '详情' } }
  })
  await page.readWithAi()
  assert.equal(sent, undefined)

  await page.doCast()
  await sleep(300)
  assert.equal(page.data.showResult, true)
  page.onAiQuestion({ detail: { value: '  事业如何？  ' } })
  await page.readWithAi()
  assert.equal(JSON.stringify(sent), JSON.stringify({ primarySeq: 24, changedSeq: 2, changingLines: [1], question: '事业如何？' }))
  assert.equal(page.data.aiResult.summary, '总览')
  await page.readWithAi() // 已有结果不重复请求
  assert.deepEqual(sent.question, '事业如何？')
  page.toggleAiDetail()
  assert.equal(page.data.aiExpanded, true)
})

test('AI 解卦：失败保留卦面并可重试，重新起卦清空 AI 态', async () => {
  let calls = 0
  const page = makePage({
    fetchBaguaDaily: async () => null,
    castBagua: async () => CAST,
    fetchBaguaReading: async () => { if (++calls === 1) throw new Error('今日 AI 解读名额已用完，明天再来看看'); return { summary: '总览', detail: '详情' } }
  })
  await page.doCast()
  await sleep(300)
  await page.readWithAi()
  assert.equal(page.data.aiError, '今日 AI 解读名额已用完，明天再来看看')
  assert.ok(page.data.castResult) // 卦面保留
  await page.readWithAi()
  assert.equal(calls, 2)
  assert.equal(page.data.aiResult.summary, '总览')
  page.resetCast()
  assert.equal(page.data.aiResult, null)
  assert.equal(page.data.aiError, '')
  assert.equal(page.data.aiQuestion, '')
})

test('AI 解卦：重新起卦后忽略旧卦的迟到响应', async () => {
  let resolveOld
  const page = makePage({
    fetchBaguaDaily: async () => null,
    castBagua: async () => CAST,
    fetchBaguaReading: () => new Promise((resolve) => { resolveOld = resolve })
  })
  await page.doCast()
  await sleep(300)
  const pending = page.readWithAi()
  assert.equal(page.data.aiLoading, true)
  page.resetCast()
  resolveOld({ summary: '旧卦总览', detail: '旧卦详情' })
  await pending
  assert.equal(page.data.aiResult, null)
  assert.equal(page.data.aiLoading, false)
})

test('无变爻时起卦请求不带之卦', async () => {
  let sent
  const stillCast = { ...CAST, changed: null, changingLines: [], linesDetail: CAST.linesDetail.map((l) => ({ ...l, changing: false, label: l.yang ? '少阳' : '少阴' })) }
  const page = makePage({
    fetchBaguaDaily: async () => null,
    castBagua: async () => stillCast,
    fetchBaguaReading: async (payload) => { sent = payload; return { summary: '总览', detail: '详情' } }
  })
  await page.doCast()
  await sleep(300)
  await page.readWithAi()
  assert.equal(JSON.stringify(sent), JSON.stringify({ primarySeq: 24, changedSeq: null, changingLines: [], question: '' }))
})

test('AI 解卦请求发到 /bagua/ai-reading 并带长超时', async () => {
  let sentReq
  const context = {
    module: { exports: {} },
    require: () => ({ BASE_URL: 'https://example.test' }),
    wx: {
      getStorageSync: () => '',
      request: (opts) => { sentReq = opts; opts.success({ statusCode: 200, data: { code: 200, data: {} } }) }
    }
  }
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../utils/request.js'), 'utf8'), context)
  await context.module.exports.fetchBaguaReading({ primarySeq: 1, changedSeq: null, changingLines: [], question: '' })
  assert.equal(sentReq.method, 'POST')
  assert.ok(sentReq.url.endsWith('/bagua/ai-reading'))
  assert.equal(sentReq.timeout, 60000)
  assert.equal(sentReq.data.primarySeq, 1)
})
