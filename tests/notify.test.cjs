const { test } = require('node:test')
const assert = require('node:assert/strict')
const { SIGN_OPTIONS, notifyEntryState, isSubscribeAccepted, SUBSCRIBE_TIP,
  WEEKLY_SUBSCRIBED_TEXT, SUBSCRIBE_TIP_WEEKLY } = require('../utils/notify')
const { constellationOf } = require('../utils/constellations')

test('模板 ID 未配置：显示「即将上线」且不可点（不能拿空 tmplId 调微信接口）', () => {
  const s = notifyEntryState({ templateId: '', loggedIn: true, subscribed: false })
  assert.equal(s.text, '即将上线')
  assert.equal(s.clickable, false)
  // 空白串同样视为未配置
  const blank = notifyEntryState({ templateId: '  ', loggedIn: true, subscribed: false })
  assert.equal(blank.clickable, false)
})

test('已配置模板：按登录态与订阅态给文案', () => {
  assert.deepEqual(
    notifyEntryState({ templateId: 'tmpl_1', loggedIn: false, subscribed: false }),
    { text: '登录后可订阅', clickable: true })
  assert.deepEqual(
    notifyEntryState({ templateId: 'tmpl_1', loggedIn: true, subscribed: false }),
    { text: '未订阅 · 点击开启', clickable: true })
  assert.deepEqual(
    notifyEntryState({ templateId: 'tmpl_1', loggedIn: true, subscribed: true }),
    { text: '已订阅 · 明日 8:00 推送', clickable: true })
})

test('授权结果判断：只有 accept 才算订阅成功', () => {
  assert.equal(isSubscribeAccepted({ tmpl_1: 'accept' }, 'tmpl_1'), true)
  assert.equal(isSubscribeAccepted({ tmpl_1: 'reject' }, 'tmpl_1'), false)
  assert.equal(isSubscribeAccepted({ tmpl_1: 'ban' }, 'tmpl_1'), false)
  assert.equal(isSubscribeAccepted({}, 'tmpl_1'), false)
  assert.equal(isSubscribeAccepted(null, 'tmpl_1'), false)
})

test('12 星座选项齐全且 nameEn 都能被星联数据识别', () => {
  assert.equal(SIGN_OPTIONS.length, 12)
  for (const s of SIGN_OPTIONS) {
    assert.ok(s.name && s.nameEn, '每个星座要有中英文标识')
    assert.ok(constellationOf(s.nameEn), `nameEn ${s.nameEn} 应命中星联数据`)
    assert.ok(constellationOf(s.name), `中文名 ${s.name} 应命中星联数据`)
  }
})

test('平台规则提示文案如实告知「一次授权只推一天」', () => {
  assert.match(SUBSCRIBE_TIP, /一次授权/)
  assert.match(SUBSCRIBE_TIP, /一天/)
})

test('每周条目：subscribedText 参数化已订阅文案，默认仍是每日文案', () => {
  // 每周条目传入专属文案
  assert.deepEqual(
    notifyEntryState({ templateId: 'tmpl_w', loggedIn: true, subscribed: true, subscribedText: WEEKLY_SUBSCRIBED_TEXT }),
    { text: '已订阅 · 每周一 8:05 推送', clickable: true })
  // 不传时保持每日默认文案（向后兼容）
  assert.deepEqual(
    notifyEntryState({ templateId: 'tmpl_1', loggedIn: true, subscribed: true }),
    { text: '已订阅 · 明日 8:00 推送', clickable: true })
  // 模板未配置时参数不生效，仍是「即将上线」不可点
  assert.deepEqual(
    notifyEntryState({ templateId: '', loggedIn: true, subscribed: true, subscribedText: WEEKLY_SUBSCRIBED_TEXT }),
    { text: '即将上线', clickable: false })
})

test('每周平台规则提示如实告知「一次授权只推一次」', () => {
  assert.match(SUBSCRIBE_TIP_WEEKLY, /一次授权/)
  assert.match(SUBSCRIBE_TIP_WEEKLY, /一次/)
  assert.match(WEEKLY_SUBSCRIBED_TEXT, /每周一 8:05/)
})
