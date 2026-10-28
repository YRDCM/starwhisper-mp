// 分享链路回归测试：修复过的两个真 bug（星运链接丢星座、配对读错分数）+ 卡片图取值规则
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const path = require('node:path')
const { shareImageUrl } = require('../utils/share')

function loadPage(file) {
  let page
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), {
    Page: (value) => { page = value },
    require: (name) => name.endsWith('/share') ? { shareImageUrl } : {},
    wx: {
      getStorageSync: () => '',
      setStorageSync: () => {},
      removeStorageSync: () => {},
      switchTab: () => {},
      showToast: () => {}
    }
  })
  page.setData = (patch) => Object.assign(page.data, patch)
  return page
}

test('shareImageUrl：本地临时文件可用，base64 / 空值一律丢弃', () => {
  assert.equal(shareImageUrl('wxfile://tmp_poster.png'), 'wxfile://tmp_poster.png')
  assert.equal(shareImageUrl('http://tmp/poster.png'), 'http://tmp/poster.png')
  assert.equal(shareImageUrl('data:image/png;base64,AAAA'), undefined)
  assert.equal(shareImageUrl(''), undefined)
  assert.equal(shareImageUrl('   '), undefined)
  assert.equal(shareImageUrl(null), undefined)
})

test('星运分享：path 带上当前星座 nameEn，海报是本地路径才当卡片图', () => {
  const page = loadPage('pages/fortune/fortune.js')
  page.data.fortune = { signName: '狮子座', overallScore: 4 }
  page.data.currentSign = { nameEn: 'leo' }

  assert.equal(page.onShareAppMessage().path, '/pages/fortune/fortune?sign=leo')
  assert.equal(page.onShareAppMessage().imageUrl, undefined) // 没海报时不传 imageUrl

  page.data.posterImage = 'wxfile://tmp_poster.png'
  assert.equal(page.onShareAppMessage().imageUrl, 'wxfile://tmp_poster.png')

  page.data.posterImage = 'data:image/png;base64,AAAA' // base64 不能当卡片图
  assert.equal(page.onShareAppMessage().imageUrl, undefined)

  // 朋友圈分享同样带星座
  assert.equal(page.onShareTimeline().query, 'sign=leo')

  // 没有当前星座时退回不带参数的首页
  page.data.currentSign = null
  page.data.posterImage = ''
  assert.equal(page.onShareAppMessage().path, '/pages/fortune/fortune')
  assert.equal(page.onShareTimeline().query, '')
})

test('星运分享：?sign= 按 nameEn 大小写不敏感匹配，匹配不到返回 null 走默认', () => {
  const page = loadPage('pages/fortune/fortune.js')
  const signs = [{ id: 1, nameEn: 'aries' }, { id: 5, nameEn: 'leo' }]
  assert.equal(page.findSignByNameEn(signs, 'LEO').id, 5)
  assert.equal(page.findSignByNameEn(signs, ' leo ').id, 5)
  assert.equal(page.findSignByNameEn(signs, 'not-a-sign'), null)
  assert.equal(page.findSignByNameEn(signs, ''), null)
  assert.equal(page.findSignByNameEn(signs, undefined), null)
})

test('配对分享：读 scores.overall（旧代码读 result.score 永远为空），缺失时兜底', () => {
  const page = loadPage('pages/match/match.js')
  page.data.result = { scores: { overall: 88 } }
  assert.match(page.onShareAppMessage().title, /88 分/)

  page.data.result = { scores: null } // 后端没给 scores：不能出现 undefined / NaN
  const fallback = page.onShareAppMessage().title
  assert.equal(fallback, '星座配对 · 测测你们的缘分指数')

  page.data.result = null
  assert.equal(page.onShareAppMessage().title, '星座配对 · 测测你们的缘分指数')
})
