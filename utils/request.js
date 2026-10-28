// wx.request Promise 封装：对齐 Web 版 api.js 的行为——
// 统一加 /api 前缀；自动带 token 头（读 storage）；拆 {code, message, data} 包装；
// code 401 → 清登录态并提示登录；其余非 200 视为业务错误。
const { BASE_URL } = require('./config')

const API_PREFIX = '/api'
const TIMEOUT = 8000

// 401 单飞节流：同一时刻多个请求一起失效时（「我的」页 onShow 就是并发 6 个），
// 只弹一次 toast、只 switchTab 一次，否则真机上会连闪多个提示与跳转。
const AUTH_FAIL_THROTTLE = 3000
let lastAuthFailAt = 0

/**
 * 登录态失效：清 storage + globalData 两处（页面读 storage，请求层/其它页读 globalData，
 * 少清一处就退不干净），并按节流只提示 + 跳转一次。
 */
function handleAuthFail() {
  wx.removeStorageSync('token')
  wx.removeStorageSync('userInfo')
  try {
    // getApp 在单测/App 启动阶段可能不可用，取不到就只清 storage
    const app = typeof getApp === 'function' ? getApp() : null
    if (app && app.globalData) {
      app.globalData.token = ''
      app.globalData.userInfo = null
    }
  } catch (e) {
    // 忽略：storage 已清干净，globalData 会在下次 onLaunch/登录时重建
  }
  const now = Date.now()
  if (now - lastAuthFailAt < AUTH_FAIL_THROTTLE) return
  lastAuthFailAt = now
  wx.showToast({ title: '请先登录', icon: 'none' })
  wx.switchTab({ url: '/pages/profile/profile' })
}

/**
 * 统一请求：成功 resolve(body.data)，失败 reject(Error(友好中文提示))
 * @param {object} opts { url, method, data, auth }
 */
function request({ url, method = 'GET', data, auth = true, timeout = TIMEOUT }) {
  return new Promise((resolve, reject) => {
    const header = {}
    if (auth) {
      // 自动携带 token（后端约定：Authorization: Bearer <token>）
      const token = wx.getStorageSync('token')
      if (token) header['Authorization'] = 'Bearer ' + token
    }
    wx.request({
      url: BASE_URL + API_PREFIX + url,
      method,
      data,
      header,
      timeout,
      success: (res) => {
        const body = res.data
        // 未登录 / token 失效：清本地登录态并提示
        if (res.statusCode === 401 || (body && body.code === 401)) {
          handleAuthFail()
          reject(new Error('登录已失效，请重新登录'))
          return
        }
        if (res.statusCode < 200 || res.statusCode >= 300) {
          reject(new Error(`星语服务器响应异常（HTTP ${res.statusCode}）`))
          return
        }
        if (body && (body.code === 200 || body.code === 0)) {
          resolve(body.data)
        } else {
          reject(new Error((body && body.message) || '星语服务器返回异常'))
        }
      },
      fail: (err) => {
        reject(new Error(/timeout/i.test(err.errMsg || '') ? '请求超时，请稍后重试' : '无法连接星语服务器，请检查网络后重试'))
      }
    })
  })
}

module.exports = {
  request,

  /* ===== 星座运势 ===== */
  fetchSigns: () => request({ url: '/signs/list' }),
  fetchTodayFortune: (sign) => request({ url: '/fortune/today', data: { sign } }),
  fetchWeekFortune: (sign) => request({ url: '/fortune/week', data: { sign } }),
  // 本周运势（ShowAPI week 节点；无本地兜底，失败会 reject，前端显示错误态）
  fetchWeeklyFortune: (sign) => request({ url: '/fortune/weekly', data: { sign } }),

  /* ===== 塔罗 ===== */
  fetchTarotDaily: () => request({ url: '/tarot/daily' }),
  // 抽牌仪式：spread = single（单牌指引）/ three（时间之流）/ choice（二选一）/ love（爱情十字）
  // 新契约返回 { spread, spreadName, cards:[{card, orientation, position, keywords, meaning}] }
  drawTarot: (spread, cardNos) => request({
    url: `/tarot/draw?spread=${encodeURIComponent(spread)}${cardNos ? '&cardNos=' + encodeURIComponent(cardNos.join(',')) : ''}`,
    method: 'POST'
  }),
  fetchTarotCards: () => request({ url: '/tarot/cards' }),
  fetchTarotReading: (drawId, question) => request({ url: '/tarot/ai-reading', method: 'POST', data: { drawId, question }, timeout: 60000 }),

  /* ===== 用户系统 ===== */
  // 微信登录：wx.login 拿 code 换 token（后端未配 AppID 时会返回错误文案）
  wechatLogin: (code) => request({ url: '/auth/wechat', method: 'POST', data: { code }, auth: false }),
  fetchMe: () => request({ url: '/user/me' }),
  // 历史记录：type = TAROT / MATCH / 空（全部），最新在前
  fetchHistory: (type) => request({ url: '/user/history', data: type ? { type } : {} }),

  /* ===== 星座配对 ===== */
  // star 为英文 nameEn（不区分大小写）或中文名；gender 1=男 0=女
  fetchMatch: (star1, star2, gender1, gender2) =>
    request({ url: '/match', data: { star1, star2, gender1, gender2 } }),

  /* ===== 打卡（需登录，401 由 request 统一处理） ===== */
  checkin: () => request({ url: '/checkin', method: 'POST' }),
  fetchCheckinStatus: () => request({ url: '/checkin/status' }),
  // 打卡汇总：连续/最长/总天数 + 勋章墙（openid 可选，后端也可从 token 取）
  fetchCheckinSummary: (openid) =>
    request({ url: '/checkin/summary', data: openid ? { openid } : {} }),

  /* ===== 订阅消息（需登录，401 由 request 统一处理） ===== */
  // scene = DAILY_FORTUNE；sign 可选（用户星座英文名，订阅时顺手登记，推送按它取运势）
  subscribeNotify: (scene, sign) =>
    request({ url: '/notify/subscribe', method: 'POST', data: sign ? { scene, sign } : { scene } }),
  unsubscribeNotify: (scene) => request({ url: '/notify/unsubscribe', method: 'POST', data: { scene } }),
  // 返回 { scenes: ['DAILY_FORTUNE', ...] }（仅 ACTIVE 状态）
  fetchNotifyStatus: () => request({ url: '/notify/status' }),

  /* ===== 资料更新（需登录）：昵称全站唯一，撞名后端会报错 ===== */
  updateProfile: (nickname) =>
    request({ url: '/user/profile', method: 'POST', data: { nickname } }),

  // 保存「我的星座」到账号（换手机、清缓存都不丢）；游客只能存在本地
  syncMySign: (signNameEn) =>
    request({ url: '/user/profile', method: 'POST', data: { signNameEn } }),

  /* ===== 反馈（游客也能提交，不需要登录） ===== */
  // body: { content, contact?, page? }
  submitFeedback: (content, contact, page) =>
    request({ url: '/feedback', method: 'POST', auth: false, data: { content, contact, page } }),

  /* ===== 小程序码（海报用）：返回 {image: base64 PNG}，游客可用 ===== */
  fetchMpCode: (scene) => request({ url: '/wechat/mpcode', data: { scene }, auth: false })
}
