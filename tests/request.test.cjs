// 请求层回归测试：401 单飞（并发失效只提示/跳转一次）+ storage 与 globalData 同时清干净
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const path = require('node:path')

// 每个用例独立加载 request.js：单飞节流是模块级状态，不能跨用例复用
// bodyCode 默认跟随 HTTP 状态码，可单独指定（验证 HTTP 200 但包体 code=401 的情况）
function makeContext(statusCode, bodyCode = statusCode) {
  const events = { toasts: [], switches: [], removed: [] }
  const globalData = { token: 'stale-token', userInfo: { id: 1 } }
  const context = {
    module: { exports: {} },
    require: () => ({ BASE_URL: 'https://example.test' }),
    getApp: () => ({ globalData }),
    wx: {
      getStorageSync: () => 'stale-token',
      removeStorageSync: (key) => { events.removed.push(key) },
      showToast: (opt) => { events.toasts.push(opt.title) },
      switchTab: (opt) => { events.switches.push(opt.url) },
      request: (opts) => { opts.success({ statusCode, data: { code: bodyCode } }) }
    }
  }
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../utils/request.js'), 'utf8'), context)
  return { api: context.module.exports, events, globalData }
}

test('并发 401：只弹一次 toast、只 switchTab 一次，storage 与 globalData 都清空', async () => {
  const { api, events, globalData } = makeContext(401)
  const results = await Promise.allSettled([
    api.fetchCheckinStatus(),
    api.fetchMe(),
    api.fetchHistory('TAROT')
  ])

  assert.deepEqual(results.map((r) => r.status), ['rejected', 'rejected', 'rejected'])
  assert.match(results[0].reason.message, /登录已失效/)
  // 单飞：3 个并发 401 只提示、只跳转一次
  assert.deepEqual(events.toasts, ['请先登录'])
  assert.deepEqual(events.switches, ['/pages/profile/profile'])
  // 但每个请求都要清 storage（幂等），避免有请求漏清
  assert.deepEqual(events.removed, ['token', 'userInfo', 'token', 'userInfo', 'token', 'userInfo'])
  assert.equal(globalData.token, '')
  assert.equal(globalData.userInfo, null)
})

test('业务码 401（HTTP 200 包体带 code 401）同样走登录失效处理', async () => {
  const { api, events, globalData } = makeContext(200, 401)
  await assert.rejects(() => api.fetchMe(), /登录已失效/)
  assert.deepEqual(events.toasts, ['请先登录'])
  assert.equal(globalData.token, '')
})

test('非 401 错误不弹登录提示，直接抛出可读文案', async () => {
  const { api, events } = makeContext(500)
  await assert.rejects(() => api.fetchMe(), /HTTP 500/)
  assert.deepEqual(events.toasts, [])
  assert.deepEqual(events.switches, [])
})
