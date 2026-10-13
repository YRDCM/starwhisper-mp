const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const path = require('node:path')

function makePage(api = {}, storage = {}) {
  let page
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../pages/tarot/tarot.js'), 'utf8'), {
    Page: (value) => { page = value },
    require: (name) => name.endsWith('/config') ? {} : api,
    wx: { getStorageSync: () => storage.value, setStorageSync: (_, value) => {
      if (storage.fail) throw new Error('storage full')
      storage.value = value
    } }
  })
  page.setData = (patch) => Object.assign(page.data, patch)
  return page
}

for (const [spread, count] of Object.entries({ single: 1, three: 3, choice: 3, love: 5, celtic: 10, hexagram: 7 })) {
  test(`${spread}：按序揭晓、全部揭晓和重新抽牌`, async () => {
    const cards = Array.from({ length: count }, (_, i) => ({ card: { id: i + 1 }, position: `位置${i + 1}`, keywords: '思考' }))
    const page = makePage({ drawTarot: async () => ({ spread, cards }) })
    await page.doDraw()
    assert.equal(page.data.revealedCards.length, 0)
    page.onRevealCard({ currentTarget: { dataset: { index: 1 } } })
    assert.equal(page.data.revealedCount, 0)
    page.onRevealCard({ currentTarget: { dataset: { index: 0 } } })
    assert.equal(page.data.revealedCards.length, 1)
    assert.equal(page.data.revealedCards[0].position, '位置1')
    page.revealAll()
    page.revealNext()
    assert.equal(page.data.revealedCount, count)
    assert.equal(page.data.nextCard, null)
    page.resetDraw()
    assert.equal(page.data.revealedCount, 0)
    assert.equal(page.data.revealedCards.length, 0)
  })
}

test('学习记录去重、保存失败可重试，未展开不能标记', () => {
  const storage = { value: [1, 1, 99, '2'] }
  const page = makePage({}, storage)
  page.data.daily = { card: { no: 23 } }
  page.markLearned()
  assert.equal(page.data.todayLearned, false)
  page.toggleLesson()
  storage.fail = true
  page.markLearned()
  assert.equal(page.data.todayLearned, false)
  assert.match(page.data.studyError, /未能保存/)
  storage.fail = false
  page.markLearned()
  page.markLearned()
  assert.deepEqual(Array.from(storage.value), [1, 23])
  assert.equal(page.data.studyError, '')
})

test('空抽牌结果保留选牌并提示错误', async () => {
  const page = makePage({ drawTarot: async () => ({ cards: [] }) })
  page.data.picking = true
  await page.doDraw([1])
  assert.equal(page.data.picking, true)
  assert.match(page.data.drawError, /完整牌面/)
})

test('抽牌使用查询参数传递牌阵和有序选牌', async () => {
  let sent
  const context = {
    module: { exports: {} },
    require: () => ({ BASE_URL: 'https://example.test' }),
    wx: {
      getStorageSync: () => '',
      request: (opts) => { sent = opts; opts.success({ statusCode: 200, data: { code: 200, data: {} } }) }
    }
  }
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../utils/request.js'), 'utf8'), context)
  await context.module.exports.drawTarot('three', [22, 1, 37])
  const url = new URL(sent.url)
  assert.equal(sent.method, 'POST')
  assert.equal(url.searchParams.get('spread'), 'three')
  assert.equal(url.searchParams.get('cardNos'), '22,1,37')
})

test('自选失败不会追加随机请求，保留选择且阻止重复提交', async () => {
  let page
  let rejectDraw
  let calls = 0
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../pages/tarot/tarot.js'), 'utf8'), {
    Page: (definition) => { page = definition },
    require: (name) => name.endsWith('/config') ? {} : {
      drawTarot: () => { calls++; return new Promise((resolve, reject) => { rejectDraw = reject }) }
    },
    clearTimeout, setTimeout
  })
  page.setData = (patch) => Object.assign(page.data, patch)
  page.data.picking = true
  page.data.deck = [{ no: 22, selected: true, order: 1 }]
  page.data.pickedCount = 1
  page.data.pickFull = true
  const pending = page.doDraw([22])
  await page.doDraw([22])
  rejectDraw(new Error('请求超时，请稍后重试'))
  await pending
  assert.equal(calls, 1)
  assert.equal(page.data.picking, true)
  assert.equal(page.data.pickedCount, 1)
  assert.equal(page.data.deck[0].no, 22)
  assert.equal(page.data.drawing, false)
  assert.match(page.data.drawError, /超时/)
})
