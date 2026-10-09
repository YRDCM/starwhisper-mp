// 我的页：登录（微信 / 游客体验）+ 打卡 + 历史记录（塔罗 / 八卦各最近 5 条）
const { wechatLogin, devLogin, fetchMe, fetchHistory, checkin, fetchCheckinStatus, fetchCheckinSummary } = require('../../utils/request')

Page({
  data: {
    token: '',
    userInfo: null,
    logging: false,
    loginError: '',
    historyTarot: [],   // 塔罗最近 5 条
    historyBagua: [],   // 八卦最近 5 条
    historyMatch: [],   // 配对最近 5 条
    historyLoaded: false,
    expandedId: null,   // 展开详情的记录 id
    // 打卡
    checkinStatus: null, // {todayDone, streak, totalDays, recentDates}
    checkinDots: [],     // 最近 14 天点阵 [{date, done}]
    checking: false,
    // 打卡汇总（连续/最长/总天数 + 勋章墙），接口失败时保持 null 静默隐藏
    checkinSummary: null, // {currentStreak, maxStreak, totalDays, todayChecked}
    badges: []           // [{code, name, desc, threshold, unlocked, progressText}]
  },

  onShow() {
    // 每次进入同步全局登录态（其他页 401 后会清掉 storage）
    const token = wx.getStorageSync('token') || ''
    const userInfo = wx.getStorageSync('userInfo') || null
    this.setData({ token, userInfo })
    if (token) {
      this.loadHistory()
      this.loadCheckinStatus() // onShow 刷新打卡状态
      this.loadCheckinSummary() // 连续打卡 + 勋章墙（失败静默）
    }
  },

  /* ===== 微信登录：wx.login → /api/auth/wechat；失败给游客通道 ===== */
  async onWechatLogin() {
    if (this.data.logging) return
    this.setData({ logging: true, loginError: '' })
    try {
      const { code } = await new Promise((resolve, reject) => {
        wx.login({ success: resolve, fail: () => reject(new Error('wx.login 调用失败')) })
      })
      const data = await wechatLogin(code)
      this.applyLogin(data)
    } catch (e) {
      // 后端未配置 AppID 等情况：提示并展示游客体验入口
      this.setData({ loginError: (e.message || '微信登录暂不可用') + '，可试试下方游客体验登录' })
    } finally {
      this.setData({ logging: false })
    }
  },

  /* ===== 游客体验登录：/api/auth/dev ===== */
  async onDevLogin() {
    if (this.data.logging) return
    this.setData({ logging: true, loginError: '' })
    try {
      const data = await devLogin('星友' + String(Date.now()).slice(-4))
      this.applyLogin(data)
    } catch (e) {
      this.setData({ loginError: e.message || '登录失败，请稍后重试' })
    } finally {
      this.setData({ logging: false })
    }
  },

  applyLogin(data) {
    wx.setStorageSync('token', data.token)
    wx.setStorageSync('userInfo', data.user)
    getApp().globalData.token = data.token
    getApp().globalData.userInfo = data.user
    this.setData({ token: data.token, userInfo: data.user })
    wx.showToast({ title: '登录成功', icon: 'none' })
    this.loadHistory()
  },

  onLogout() {
    wx.removeStorageSync('token')
    wx.removeStorageSync('userInfo')
    getApp().globalData.token = ''
    getApp().globalData.userInfo = null
    this.setData({
      token: '', userInfo: null,
      historyTarot: [], historyBagua: [], historyMatch: [], historyLoaded: false, expandedId: null,
      checkinStatus: null, checkinDots: [], checkinSummary: null, badges: []
    })
    wx.showToast({ title: '已退出登录', icon: 'none' })
  },

  /* ===== 打卡 ===== */
  async loadCheckinStatus() {
    try {
      const st = await fetchCheckinStatus()
      this.setData({ checkinStatus: st, checkinDots: this.buildDots(st.recentDates) })
    } catch (e) {
      // 401 等场景 request 已统一处理
    }
  },

  // 打卡汇总：连续/最长/总天数 + 勋章墙；失败静默兜底（置 null，不打扰用户）
  async loadCheckinSummary() {
    try {
      const openid = (this.data.userInfo && (this.data.userInfo.openid || this.data.userInfo.id)) || ''
      const sum = await fetchCheckinSummary(openid)
      const badges = (sum.badges || []).map((b) => ({
        ...b,
        // 未解锁显示进度：当前连续天数 / 解锁门槛
        progressText: b.unlocked ? '' : `${Math.min(sum.currentStreak || 0, b.threshold)}/${b.threshold}`
      }))
      this.setData({ checkinSummary: sum, badges })
    } catch (e) {
      this.setData({ checkinSummary: null, badges: [] })
    }
  },

  // 最近 14 天点阵：后端给打过的日期列表，前端补齐 14 格（旧 → 新）
  buildDots(recentDates) {
    const done = new Set(recentDates || [])
    const dots = []
    for (let i = 13; i >= 0; i--) {
      const d = new Date(Date.now() - i * 86400000)
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
      dots.push({ date: key, done: done.has(key) })
    }
    return dots
  },

  // 今日打卡（POST 幂等，重复点无副作用）
  async doCheckin() {
    if (this.data.checking || (this.data.checkinStatus && this.data.checkinStatus.todayDone)) return
    this.setData({ checking: true })
    try {
      await checkin()
      wx.showToast({ title: '打卡成功', icon: 'none' })
      this.loadCheckinStatus()
      this.loadCheckinSummary()
    } catch (e) {
      wx.showToast({ title: e.message || '打卡失败', icon: 'none' })
    } finally {
      this.setData({ checking: false })
    }
  },

  /* ===== 历史记录：塔罗 / 八卦 / 配对 各取最近 5 条 ===== */
  async loadHistory() {
    try {
      const [tarot, bagua, match] = await Promise.all([
        fetchHistory('TAROT'),
        fetchHistory('BAGUA'),
        fetchHistory('MATCH')
      ])
      this.setData({
        historyTarot: this.formatList(tarot),
        historyBagua: this.formatList(bagua),
        historyMatch: this.formatList(match).map((it) => this.decorateMatch(it)),
        historyLoaded: true
      })
    } catch (e) {
      // token 失效等场景 request 已统一提示
      this.setData({ historyLoaded: true })
    }
  },

  formatList(list) {
    return (list || []).slice(0, 5).map((it) => ({
      ...it,
      // createdAt 格式化：2026-09-24 18:30
      timeText: String(it.createdAt || '').replace('T', ' ').slice(0, 16)
    }))
  },

  // 配对记录：detail 是 MatchVO JSON 字符串 → 解析出双方星座 + 综合分 + review 首句；
  // 解析失败降级显示 title
  decorateMatch(item) {
    try {
      const m = JSON.parse(item.detail)
      const pair = `${m.star1 ? m.star1.name : '?'} × ${m.star2 ? m.star2.name : '?'}`
      const score = m.scores && m.scores.overall != null ? `综合 ${m.scores.overall} 分` : ''
      // review 取一句话（首个句号前）
      const review = m.review ? String(m.review).split('。')[0] + '。' : ''
      return { ...item, detailText: [pair + (score ? ' · ' + score : ''), review].filter(Boolean).join('\n') }
    } catch (e) {
      return { ...item, detailText: item.title }
    }
  },

  // 点击记录：展开 / 收起 detail 摘要
  onRecordTap(e) {
    const id = e.currentTarget.dataset.id
    this.setData({ expandedId: this.data.expandedId === id ? null : id })
  }
})
