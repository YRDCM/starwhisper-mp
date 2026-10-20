// 登录引导：首次弹窗显示逻辑（shouldShowWelcome 纯函数）
const { test } = require('node:test')
const assert = require('node:assert/strict')

// login.js 顶部 require 了 request.js（函数级使用 wx，模块加载不触碰），补个最小桩
globalThis.wx = globalThis.wx || { getStorageSync: () => '', setStorageSync: () => {} }

const { shouldShowWelcome } = require('../utils/login.js')

test('未登录且没看过引导 → 弹', () => {
  assert.equal(shouldShowWelcome(false, false), true)
})

test('已登录不弹（即使没看过引导）', () => {
  assert.equal(shouldShowWelcome(false, true), false)
})

test('看过引导不弹（即使仍未登录）', () => {
  assert.equal(shouldShowWelcome(true, false), false)
})
