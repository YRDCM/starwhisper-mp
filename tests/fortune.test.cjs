const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const path = require('node:path')

function setup() {
  let page
  const pending = {}
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../pages/fortune/fortune.js'), 'utf8'), {
    Page: (value) => { page = value },
    require: (name) => name.endsWith('/request') ? {
      fetchTodayFortune: (sign) => new Promise((resolve, reject) => { pending[sign] = { resolve, reject } }),
      fetchWeekFortune: async (sign) => [sign],
      // 周运默认直接成功（周运用例见 weekly.test.cjs）
      fetchWeeklyFortune: async (sign) => ({ signNameEn: sign, source: 'SHOWAPI' })
    } : {}
  })
  page.setData = (patch) => Object.assign(page.data, patch)
  page.buildView = () => {}
  page.updateCharts = () => {}
  return { page, pending }
}

test('快速切换星座，晚到的旧结果不能覆盖新结果', async () => {
  const { page, pending } = setup()
  const first = page.loadFortune({ nameEn: 'aries' })
  const second = page.loadFortune({ nameEn: 'leo' })
  pending.leo.resolve({ signNameEn: 'leo' })
  await second
  pending.aries.resolve({ signNameEn: 'aries' })
  await first
  assert.equal(page.data.fortune.signNameEn, 'leo')
  assert.equal(page.data.week[0], 'leo')
  assert.equal(page.data.loading, false)
})

test('旧请求报错不打断正在加载的新星座', async () => {
  const { page, pending } = setup()
  const first = page.loadFortune({ nameEn: 'aries' })
  const second = page.loadFortune({ nameEn: 'leo' })
  pending.aries.reject(new Error('旧请求超时'))
  await first
  assert.equal(page.data.error, '')
  assert.equal(page.data.loading, true)
  pending.leo.resolve({ signNameEn: 'leo' })
  await second
  assert.equal(page.data.fortune.signNameEn, 'leo')
})

test('重复点击不触发加载，手动选择保持最短路径旋转', () => {
  const { page } = setup()
  page.data.signs = Array.from({ length: 12 }, (_, i) => ({ id: i + 1 }))
  page.data.currentSignId = 1
  page.data.animated = true
  let requests = 0
  page.loadFortune = () => { requests++ }
  page.onSignTap({ currentTarget: { dataset: { id: 1 } } })
  assert.equal(requests, 0)
  page.onSignTap({ currentTarget: { dataset: { id: 12 } } })
  assert.equal(requests, 1)
  assert.equal(page.data.ringAngle, 30)
  assert.equal(page._manualSelection, true)
})
