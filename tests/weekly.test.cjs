// 本周运势（小程序端）测试：timeRange 格式化纯函数 + 页面周运数据流
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const path = require('node:path')
const { formatWeekRange } = require('../utils/weekly')

/* ===== formatWeekRange 纯函数 ===== */

test('formatWeekRange：标准区间格式化为可读形式', () => {
  assert.equal(formatWeekRange('20261011-20261018'), '10.11 – 10.18')
  assert.equal(formatWeekRange('20260913-20260920'), '09.13 – 09.20') // 前导零保留
  assert.equal(formatWeekRange('20261228-20270103'), '12.28 – 01.03') // 跨年
})

test('formatWeekRange：异常输入一律返回空串', () => {
  assert.equal(formatWeekRange(null), '')
  assert.equal(formatWeekRange(undefined), '')
  assert.equal(formatWeekRange(''), '')
  assert.equal(formatWeekRange('20261011'), '')       // 缺结束段
  assert.equal(formatWeekRange('10.11-10.18'), '')     // 已是展示格式不重复处理
  assert.equal(formatWeekRange('2026-10-11~2026-10-18'), '')
})

/* ===== 页面周运数据流 ===== */

function setup() {
  let page
  const pending = {}
  const calls = []
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../pages/fortune/fortune.js'), 'utf8'), {
    Page: (value) => { page = value },
    require: (name) => {
      if (name.endsWith('/request')) {
        return {
          fetchTodayFortune: async (sign) => ({ signNameEn: sign }),
          fetchWeekFortune: async (sign) => [sign],
          fetchWeeklyFortune: (sign) => {
            calls.push(sign)
            return new Promise((resolve, reject) => { pending[sign] = { resolve, reject } })
          }
        }
      }
      if (name.endsWith('/weekly')) return { formatWeekRange }
      return {}
    }
  })
  page.setData = (patch) => Object.assign(page.data, patch)
  page.buildView = () => {}
  page.updateCharts = () => {}
  return { page, pending, calls }
}

test('周运失败显示专属错误态，不显示旧数据', async () => {
  const { page, pending } = setup()
  const req = page.loadWeekly({ nameEn: 'leo' })
  assert.equal(page.data.weeklyLoading, true)
  pending.leo.reject(new Error('ShowAPI 调用失败'))
  await req
  assert.equal(page.data.weekly, null)
  assert.equal(page.data.weeklyLoading, false)
  assert.ok(page.data.weeklyError.includes('本周运势'))
})

test('同星座周运命中缓存，来回切换不重复请求', async () => {
  const { page, pending, calls } = setup()
  const first = page.loadWeekly({ nameEn: 'leo' })
  pending.leo.resolve({ signNameEn: 'leo', timeRange: '20261011-20261018' })
  await first
  assert.deepEqual(calls, ['leo'])
  // 再次加载同星座：走缓存，不再发请求
  await page.loadWeekly({ nameEn: 'leo' })
  assert.deepEqual(calls, ['leo'])
  assert.equal(page.data.weekly.signNameEn, 'leo')
  // 周区间已格式化
  assert.equal(page.data.weeklyView.rangeText, '10.11 – 10.18')
  // force=true（下拉刷新/重试）绕过缓存
  const forced = page.loadWeekly({ nameEn: 'leo', }, true)
  pending.leo.resolve({ signNameEn: 'leo' })
  await forced
  assert.deepEqual(calls, ['leo', 'leo'])
})

test('快速切换星座，晚到的旧周运不能覆盖新结果', async () => {
  const { page, pending } = setup()
  const first = page.loadWeekly({ nameEn: 'aries' })
  const second = page.loadWeekly({ nameEn: 'leo' })
  pending.leo.resolve({ signNameEn: 'leo' })
  await second
  pending.aries.resolve({ signNameEn: 'aries' })
  await first
  assert.equal(page.data.weekly.signNameEn, 'leo')
  assert.equal(page.data.weeklyLoading, false)
  assert.equal(page.data.weeklyError, '')
})

test('切到本周 tab 且无数据时才触发加载', async () => {
  const { page, pending, calls } = setup()
  page.data.currentSign = { nameEn: 'leo' }
  page.onModeTap({ currentTarget: { dataset: { mode: 'week' } } })
  assert.equal(page.data.mode, 'week')
  assert.deepEqual(calls, ['leo'])
  pending.leo.resolve({ signNameEn: 'leo' })
  await Promise.resolve(); await Promise.resolve()
  // 已有数据后再点同一 tab / 重复切 tab 都不重复请求
  page.onModeTap({ currentTarget: { dataset: { mode: 'today' } } })
  page.onModeTap({ currentTarget: { dataset: { mode: 'week' } } })
  assert.deepEqual(calls, ['leo'])
})
