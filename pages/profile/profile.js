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
        historyTarot: this.formatList(tarot).map((it) => this.decorateTarot(it)),
        historyBagua: this.formatList(bagua).map((it) => this.decorateBagua(it)),
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
      title: this.polishTitle(it.title),
      // createdAt 格式化：2026-09-24 18:30
      timeText: String(it.createdAt || '').replace('T', ' ').slice(0, 16)
    }))
  },

  // 标题展示层润色：配对原标题「星座配对 · 天秤座 × 狮子座 · 90分」太长会折行，
  // 重排为「天秤座 × 狮子座 · 契合度 90」；其他类型标题原样保留（由 CSS 保证单行省略）
  polishTitle(title) {
    const t = String(title || '')
    const m = t.match(/^星座配对 · (.+?) × (.+?)(?: · (\d+)\s*分)?$/)
    if (m) return m[3] ? `${m[1]} × ${m[2]} · 契合度 ${m[3]}` : `${m[1]} × ${m[2]}`
    return t
  },

  // detail JSON 安全解析：失败 / 非对象都返回 null
  safeParse(detail) {
    try {
      const d = typeof detail === 'string' ? JSON.parse(detail) : detail
      return d && typeof d === 'object' ? d : null
    } catch (e) {
      return null
    }
  },

  // 八卦记录：detail 是 CastVO JSON {primary, changed, changingLines, linesDetail}
  // → 结构化行 [{label, text}]，解析失败兜底「暂无详情」
  decorateBagua(item) {
    const c = this.safeParse(item.detail)
    if (!c || !c.primary) return { ...item, detailLines: [{ text: '暂无详情' }] }
    const p = c.primary
    const hexLine = (h) =>
      [h.symbol, h.name].filter(Boolean).join(' ') + (h.fortuneLevel ? ` · ${h.fortuneLevel}` : '')
    const lines = [{ label: '本卦', text: hexLine(p) }]
    if (p.judgment) lines.push({ label: '卦辞', text: p.judgment })
    if (p.meaning) lines.push({ label: '象曰', text: p.meaning })
    if (c.changed && c.changed.name && c.changed.name !== p.name) {
      lines.push({ label: '变卦', text: hexLine(c.changed) })
      if (c.changed.judgment) lines.push({ label: '变卦卦辞', text: c.changed.judgment })
    }
    const moving = (c.linesDetail || []).filter((l) => l.changing).map((l) => l.position)
    if (moving.length) lines.push({ label: '动爻', text: `第 ${moving.join('、')} 爻` })
    return { ...item, detailLines: lines }
  },

  // 塔罗记录：detail 是 DrawResultVO JSON {spread, spreadName, cards:[{card, orientation,
  // position, positionDesc, keywords, meaning}]} → 每张牌：牌位行 + 解读行
  decorateTarot(item) {
    const d = this.safeParse(item.detail)
    if (!d || !Array.isArray(d.cards) || !d.cards.length) {
      return { ...item, detailLines: [{ text: '暂无详情' }] }
    }
    const lines = []
    d.cards.forEach((dc, i) => {
      const name = (dc.card && dc.card.name) || '未知牌'
      const ori = dc.orientation === 'reversed' ? '逆位' : '正位'
      const label = dc.position || (d.cards.length > 1 ? `第 ${i + 1} 张` : '牌面')
      lines.push({ label, text: `${name} · ${ori}${dc.keywords ? ' · ' + dc.keywords : ''}` })
      if (dc.positionDesc) lines.push({ cont: true, text: dc.positionDesc })
      if (dc.meaning) lines.push({ cont: true, text: dc.meaning })
    })
    return { ...item, detailLines: lines }
  },

  // 配对记录：detail 是 MatchVO JSON → 指数 + 点评 + 建议；
  // 解析失败兜底「暂无详情」
  decorateMatch(item) {
    const m = this.safeParse(item.detail)
    if (!m) return { ...item, detailLines: [{ text: '暂无详情' }] }
    const lines = []
    const s = m.scores || {}
    const scoreParts = [
      ['综合', s.overall], ['爱情', s.love], ['友情', s.friendship], ['婚姻', s.marriage]
    ].filter(([, v]) => v != null).map(([k, v]) => `${k} ${v}`)
    if (scoreParts.length) lines.push({ label: '指数', text: scoreParts.join(' · ') })
    if (m.review) lines.push({ label: '点评', text: m.review })
    if (m.suggest) lines.push({ label: '建议', text: m.suggest })
    if (!lines.length) lines.push({ text: '暂无详情' })
    return { ...item, detailLines: lines }
  },

  // 点击记录：展开 / 收起 detail 摘要
  onRecordTap(e) {
    const id = e.currentTarget.dataset.id
    this.setData({ expandedId: this.data.expandedId === id ? null : id })
  }
})
