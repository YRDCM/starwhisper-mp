// 微信快捷登录：wx.login → /api/auth/wechat → 落 storage
// 供首页登录引导（欢迎弹窗/引导条）与「我的」页共用
const { wechatLogin } = require('./request')

// 登录态落库（token + userInfo），与 profile 页 applyLogin 同一约定
function applyLoginData(data) {
  wx.setStorageSync('token', data.token)
  wx.setStorageSync('userInfo', data.user)
  return data
}

// 一键微信登录，成功返回 {token, user}；失败抛错（调用方提示）
async function wxQuickLogin() {
  const { code } = await new Promise((resolve, reject) => {
    // 10s 超时兜底：wx.login 偶发无回调时不至于卡死
    wx.login({ timeout: 10000, success: resolve, fail: () => reject(new Error('wx.login 调用失败')) })
  })
  return applyLoginData(await wechatLogin(code))
}

// 是否显示首次登录引导弹窗（纯函数，便于测试）：
// 已有登录态不弹；已经看过引导（welcomed 标记）不弹
function shouldShowWelcome(welcomedFlag, hasToken) {
  return !welcomedFlag && !hasToken
}

module.exports = { wxQuickLogin, applyLoginData, shouldShowWelcome }
