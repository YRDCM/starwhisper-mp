const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const path = require('node:path')

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
