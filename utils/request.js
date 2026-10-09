// wx.request Promise 封装：对齐 Web 版 api.js 的行为——
// 统一加 /api 前缀；自动带 token 头（读 storage）；拆 {code, message, data} 包装；
// code 401 → 清登录态并提示登录；其余非 200 视为业务错误。
const { BASE_URL } = require('./config')

const API_PREFIX = '/api'
const TIMEOUT = 8000

/**
 * 统一请求：成功 resolve(body.data)，失败 reject(Error(友好中文提示))
 * @param {object} opts { url, method, data, auth }
 */
function request({ url, method = 'GET', data, auth = true }) {
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
      timeout: TIMEOUT,
      success: (res) => {
        const body = res.data
        // 未登录 / token 失效：清本地登录态并提示
        if (res.statusCode === 401 || (body && body.code === 401)) {
          wx.removeStorageSync('token')
          wx.removeStorageSync('userInfo')
          wx.showToast({ title: '请先登录', icon: 'none' })
          wx.switchTab({ url: '/pages/profile/profile' })
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
      fail: () => {
        reject(new Error('无法连接星语服务器。开发者工具请勾选「不校验合法域名」；真机体验版请打开「开发调试」模式'))
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

  /* ===== 塔罗 ===== */
  fetchTarotDaily: () => request({ url: '/tarot/daily' }),
  // 抽牌仪式：spread = single（单牌指引）/ three（时间之流）/ choice（二选一）/ love（爱情十字）
  // 新契约返回 { spread, spreadName, cards:[{card, orientation, position, keywords, meaning}] }
  drawTarot: (spread) => request({ url: '/tarot/draw', method: 'POST', data: { spread } }),
  fetchTarotCards: () => request({ url: '/tarot/cards' }),

  /* ===== 八卦 ===== */
  fetchBaguaDaily: () => request({ url: '/bagua/daily' }),
  castBagua: () => request({ url: '/bagua/cast', method: 'POST' }),
  fetchHexagrams: () => request({ url: '/bagua/hexagrams' }),

  /* ===== 用户系统 ===== */
  // 开发期通道：直接发昵称换 token
  devLogin: (nickname) => request({ url: '/auth/dev', method: 'POST', data: { nickname }, auth: false }),
  // 微信登录：wx.login 拿 code 换 token（后端未配 AppID 时会返回错误文案）
  wechatLogin: (code) => request({ url: '/auth/wechat', method: 'POST', data: { code }, auth: false }),
  fetchMe: () => request({ url: '/user/me' }),
  // 历史记录：type = TAROT / BAGUA / 空（全部），最新在前
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

  /* ===== 每日一卦 ===== */
  fetchHexagramToday: (openid) =>
    request({ url: '/hexagram/today', data: openid ? { openid } : {} })
}
