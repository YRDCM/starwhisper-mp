// 我的页：登录（微信）+ 打卡 + 历史记录（塔罗 / 配对各最近 5 条）+ 每日/每周运势订阅提醒
const { wechatLogin, fetchMe, fetchHistory, checkin, fetchCheckinStatus, fetchCheckinSummary,
  subscribeNotify, unsubscribeNotify, fetchNotifyStatus, updateProfile } = require('../../utils/request')
const { APP_VERSION, SUBSCRIBE_TEMPLATES } = require('../../utils/config')
const { SIGN_OPTIONS, notifyEntryState, isSubscribeAccepted, SUBSCRIBE_TIP,
  WEEKLY_SUBSCRIBED_TEXT, SUBSCRIBE_TIP_WEEKLY } = require('../../utils/notify')

// onShow 数据缓存 TTL：60s 内重复切回本页不重复打后端；登录态变化或写操作会主动清缓存
const CACHE_TTL = 60 * 1000

Page({
  data: {
    version: APP_VERSION, // 页脚版本号展示
    token: '',
    userInfo: null,
    logging: false,
    loginError: '',
    historyTarot: [],   // 塔罗最近 5 条
    historyMatch: [],   // 配对最近 5 条
    historyLoaded: false,
    historyError: '',   // 历史记录加载失败文案（空串=正常）；失败要显示错误态 + 重试，不能吞成「暂无记录」
    expandedId: null,   // 展开详情的记录 id
    // 打卡
    checkinStatus: null, // {todayDone, streak, totalDays, recentDates}
    checkinDots: [],     // 最近 14 天点阵 [{date, done}]
    checking: false,
    checkinError: '',    // 打卡状态加载失败文案（空串=正常/加载中）
    // 打卡汇总（连续/最长/总天数 + 勋章墙），接口失败时保持 null 静默隐藏
    checkinSummary: null, // {currentStreak, maxStreak, totalDays, todayChecked}
    badges: [],           // [{code, name, desc, threshold, unlocked, progressText}]
    // ===== 每日运势订阅提醒 =====
    notifyTemplateId: SUBSCRIBE_TEMPLATES.dailyFortune || '', // 空 = 未配置，条目显示「即将上线」
    notifySubscribed: false,   // 后端 ACTIVE 订阅状态
    notifyBusy: false,         // 订阅/退订进行中（防连点）
    notifyTip: SUBSCRIBE_TIP,  // 微信平台规则说明文案
    // 条目展示状态 {text, clickable}，由 refreshNotifyEntry 维护（WXML 不能调方法）
    notifyEntry: notifyEntryState({ templateId: SUBSCRIBE_TEMPLATES.dailyFortune || '', loggedIn: false, subscribed: false }),
    // ===== 每周运势订阅提醒（与每日并行；共用下方星座选择弹层） =====
    weeklyTemplateId: SUBSCRIBE_TEMPLATES.weeklyFortune || '', // 空 = 未配置，条目显示「即将上线」
    weeklySubscribed: false,   // 后端 ACTIVE 订阅状态
    weeklyBusy: false,         // 订阅/退订进行中（防连点）
    weeklyTip: SUBSCRIBE_TIP_WEEKLY, // 微信平台规则说明文案
    weeklyEntry: notifyEntryState({
      templateId: SUBSCRIBE_TEMPLATES.weeklyFortune || '', loggedIn: false,
      subscribed: false, subscribedText: WEEKLY_SUBSCRIBED_TEXT
    }),
    signPickerOpen: false,     // 星座选择弹层
    signOptions: SIGN_OPTIONS,  // 12 星座选项
    // ===== 改名（昵称全站唯一；input type="nickname" 可一键带出微信昵称） =====
    nameEditing: false,
    nameInput: '',
    nameSaving: false,
    nameError: ''
  },

  onShow() {
    // 每次进入同步全局登录态（其他页 401 后会清掉 storage）
    const token = wx.getStorageSync('token') || ''
    const userInfo = wx.getStorageSync('userInfo') || null
    // 换号 / 退出登录：整张缓存表作废（避免看到上一个人的记录）
    if (token !== this._tokenKey) {
      this._tokenKey = token
      this._cache = {}
    }
    // 登录态 + 两个订阅条目原本是 3 次 setData，合并成 1 次
    this.setData({
      token,
      userInfo,
      notifyEntry: notifyEntryState({
        templateId: this.data.notifyTemplateId,
        loggedIn: !!token,
        subscribed: this.data.notifySubscribed
      }),
      weeklyEntry: notifyEntryState({
        templateId: this.data.weeklyTemplateId,
        loggedIn: !!token,
        subscribed: this.data.weeklySubscribed,
        subscribedText: WEEKLY_SUBSCRIBED_TEXT
      })
    })
    // 6 个请求并行（命中缓存则不发），结果合并成 1 次 setData
    if (token) this.refreshAll()
  },

  /* ===== 数据加载：并行 + 60s 缓存 + 一次 setData ===== */

  cacheFresh(key) {
    const at = this._cache && this._cache[key]
    return !!at && Date.now() - at < CACHE_TTL
  },
  cacheMark(key) {
    this._cache = this._cache || {}
    this._cache[key] = Date.now()
  },
  clearCache() { this._cache = {} },

  // 各 build* 返回待合并的 patch（命中缓存返回 null），全部回来后一次性 setData
  async refreshAll(force) {
    const parts = await Promise.all([
      this.buildUserInfo(force),
      this.buildHistory(force),
      this.buildCheckinStatus(force),
      this.buildCheckinSummary(force),
      this.buildNotifyStatus(force)
    ])
    const patch = {}
    parts.forEach((part) => { if (part) Object.assign(patch, part) })
    if (Object.keys(patch).length) this.setData(patch)
  },

  // 用户信息：60s TTL 拉一次（换设备/改名后昵称能同步）；失败静默用本地缓存
  async buildUserInfo(force) {
    if (!force && this.cacheFresh('me')) return null
    try {
      const user = await fetchMe()
      // 契约：/user/me 直接返回用户对象（页面只用到 id/nickname/avatarUrl）。
      // 拿不到 id 视为异常响应，宁可保留本地缓存也不要把 storage 写脏
      if (!user || typeof user !== 'object' || user.id == null) return null
      this.cacheMark('me')
      wx.setStorageSync('userInfo', user)
      return { userInfo: user }
    } catch (e) {
      return null
    }
  },

  /* ===== 每日运势订阅提醒 ===== */

  // 条目展示状态（纯函数计算后落 data，WXML 直接渲染；模板 ID 未配置 → 即将上线且不可点）
  refreshNotifyEntry() {
    this.setData({
      notifyEntry: notifyEntryState({
        templateId: this.data.notifyTemplateId,
        loggedIn: !!this.data.token,
        subscribed: this.data.notifySubscribed
      })
    })
  },

  // 订阅状态：进页面拉一次（60s 内复用）。失败静默：保持上次状态，不打断页面
  async buildNotifyStatus(force) {
    if (!this.data.notifyTemplateId && !this.data.weeklyTemplateId) return null // 模板都未配置不打扰后端
    if (!force && this.cacheFresh('notify')) return null
    try {
      const res = await fetchNotifyStatus()
      const scenes = res.scenes || []
      const notifySubscribed = scenes.includes('DAILY_FORTUNE')
      const weeklySubscribed = scenes.includes('WEEKLY_FORTUNE')
      this.cacheMark('notify')
      // 两个条目的展示状态一起算进 patch，避免再单独 setData 两次
      return {
        notifySubscribed,
        weeklySubscribed,
        notifyEntry: notifyEntryState({
          templateId: this.data.notifyTemplateId,
          loggedIn: !!this.data.token,
          subscribed: notifySubscribed
        }),
        weeklyEntry: notifyEntryState({
          templateId: this.data.weeklyTemplateId,
          loggedIn: !!this.data.token,
          subscribed: weeklySubscribed,
          subscribedText: WEEKLY_SUBSCRIBED_TEXT
        })
      }
    } catch (e) {
      return null
    }
  },

  // 点击条目：未订阅 → 选星座 → 微信授权弹窗 → 登记后端；已订阅 → 确认取消
  async onNotifyTap() {
    const state = this.data.notifyEntry
    if (!state.clickable || this.data.notifyBusy) return
    if (!this.data.token) {
      wx.showToast({ title: '请先登录后再订阅', icon: 'none' })
      return
    }
    if (this.data.notifySubscribed) {
      this.confirmUnsubscribe()
      return
    }
    await this.subscribeFlow()
  },

  // 订阅流程：先选星座（推送内容按它取），再弹微信授权
  async subscribeFlow() {
    const sign = await this.pickSign()
    if (!sign) return // 用户取消选星座，不打扰

    let res
    try {
      res = await new Promise((resolve, reject) => {
        wx.requestSubscribeMessage({ tmplIds: [this.data.notifyTemplateId], success: resolve, fail: reject })
      })
    } catch (e) {
      wx.showToast({ title: '授权弹窗调用失败，请稍后重试', icon: 'none' })
      return
    }
    if (!isSubscribeAccepted(res, this.data.notifyTemplateId)) {
      wx.showToast({ title: '已取消授权，可随时再来开启', icon: 'none' })
      return
    }

    this.setData({ notifyBusy: true })
    try {
      await subscribeNotify('DAILY_FORTUNE', sign.nameEn)
      this.setData({ notifySubscribed: true })
      this.refreshNotifyEntry()
      // 如实告知微信规则：一次授权只推一天，想每天收需在推送后再次授权
      wx.showModal({
        title: '订阅成功',
        content: `明早 8:00 给你推${sign.name}运势。${SUBSCRIBE_TIP}。`,
        showCancel: false,
        confirmText: '知道了'
      })
    } catch (e) {
      wx.showToast({ title: e.message || '订阅失败，请稍后重试', icon: 'none' })
    } finally {
      this.setData({ notifyBusy: false })
    }
  },

  // 星座选择：自定义底部弹层（wx.showActionSheet 最多 6 项，12 星座放不下会静默失败）
  pickSign() {
    return new Promise((resolve) => {
      this._signResolve = resolve
      this.setData({ signPickerOpen: true })
    })
  },
  onSignPick(e) {
    const sign = SIGN_OPTIONS[e.currentTarget.dataset.index] || null
    this.setData({ signPickerOpen: false })
    const resolve = this._signResolve
    this._signResolve = null
    if (resolve) resolve(sign)
  },
  onSignPickerCancel() {
    this.setData({ signPickerOpen: false })
    const resolve = this._signResolve
    this._signResolve = null
    if (resolve) resolve(null)
  },

  /* ===== 改名 ===== */
  toggleNameEdit() {
    this.setData({
      nameEditing: !this.data.nameEditing,
      nameInput: this.data.userInfo && this.data.userInfo.nickname || '',
      nameError: ''
    })
  },
  onNameInput(e) {
    this.setData({ nameInput: e.detail.value.slice(0, 20), nameError: '' })
  },
  async saveNickname() {
    const nickname = (this.data.nameInput || '').trim()
    if (!nickname) { this.setData({ nameError: '昵称不能为空' }); return }
    if (this.data.nameSaving) return
    this.setData({ nameSaving: true, nameError: '' })
    try {
      const saved = await updateProfile(nickname)
      const userInfo = Object.assign({}, this.data.userInfo, { nickname: saved.nickname })
      wx.setStorageSync('userInfo', userInfo)
      this.setData({ userInfo, nameEditing: false })
      wx.showToast({ title: '昵称已更新', icon: 'none' })
    } catch (e) {
      this.setData({ nameError: e.message || '保存失败，请稍后重试' })
    } finally {
      this.setData({ nameSaving: false })
    }
  },
  noop() {}, // 弹层内容区阻止冒泡用

  confirmUnsubscribe() {
    wx.showModal({
      title: '取消订阅',
      content: '取消后将不再收到每日运势推送，确定吗？',
      confirmText: '取消订阅',
      success: async (res) => {
        if (!res.confirm) return
        this.setData({ notifyBusy: true })
        try {
          await unsubscribeNotify('DAILY_FORTUNE')
          this.setData({ notifySubscribed: false })
          this.refreshNotifyEntry()
          wx.showToast({ title: '已取消订阅', icon: 'none' })
        } catch (e) {
          wx.showToast({ title: e.message || '操作失败，请稍后重试', icon: 'none' })
        } finally {
          this.setData({ notifyBusy: false })
        }
      }
    })
  },

  /* ===== 每周运势订阅提醒（逻辑复用每日条目；星座选择弹层共用） ===== */

  // 条目展示状态（纯函数计算后落 data；模板 ID 未配置 → 即将上线且不可点）
  refreshWeeklyEntry() {
    this.setData({
      weeklyEntry: notifyEntryState({
        templateId: this.data.weeklyTemplateId,
        loggedIn: !!this.data.token,
        subscribed: this.data.weeklySubscribed,
        subscribedText: WEEKLY_SUBSCRIBED_TEXT
      })
    })
  },

  // 点击条目：未订阅 → 选星座 → 微信授权弹窗 → 登记后端；已订阅 → 确认取消
  async onWeeklyNotifyTap() {
    const state = this.data.weeklyEntry
    if (!state.clickable || this.data.weeklyBusy) return
    if (!this.data.token) {
      wx.showToast({ title: '请先登录后再订阅', icon: 'none' })
      return
    }
    if (this.data.weeklySubscribed) {
      this.confirmWeeklyUnsubscribe()
      return
    }
    await this.subscribeWeeklyFlow()
  },

  // 订阅流程：先选星座（与每日订阅共用底部弹层），再弹微信授权
  async subscribeWeeklyFlow() {
    const sign = await this.pickSign()
    if (!sign) return // 用户取消选星座，不打扰

    let res
    try {
      res = await new Promise((resolve, reject) => {
        wx.requestSubscribeMessage({ tmplIds: [this.data.weeklyTemplateId], success: resolve, fail: reject })
      })
    } catch (e) {
      wx.showToast({ title: '授权弹窗调用失败，请稍后重试', icon: 'none' })
      return
    }
    if (!isSubscribeAccepted(res, this.data.weeklyTemplateId)) {
      wx.showToast({ title: '已取消授权，可随时再来开启', icon: 'none' })
      return
    }

    this.setData({ weeklyBusy: true })
    try {
      await subscribeNotify('WEEKLY_FORTUNE', sign.nameEn)
      this.setData({ weeklySubscribed: true })
      this.refreshWeeklyEntry()
      // 如实告知微信规则：一次授权只推一次，想每周收需在推送后再次授权
      wx.showModal({
        title: '订阅成功',
        content: `下周一 8:05 给你推${sign.name}本周运势。${SUBSCRIBE_TIP_WEEKLY}。`,
        showCancel: false,
        confirmText: '知道了'
      })
    } catch (e) {
      wx.showToast({ title: e.message || '订阅失败，请稍后重试', icon: 'none' })
    } finally {
      this.setData({ weeklyBusy: false })
    }
  },

  confirmWeeklyUnsubscribe() {
    wx.showModal({
      title: '取消订阅',
      content: '取消后将不再收到每周运势推送，确定吗？',
      confirmText: '取消订阅',
      success: async (res) => {
        if (!res.confirm) return
        this.setData({ weeklyBusy: true })
        try {
          await unsubscribeNotify('WEEKLY_FORTUNE')
          this.setData({ weeklySubscribed: false })
          this.refreshWeeklyEntry()
          wx.showToast({ title: '已取消订阅', icon: 'none' })
        } catch (e) {
          wx.showToast({ title: e.message || '操作失败，请稍后重试', icon: 'none' })
        } finally {
          this.setData({ weeklyBusy: false })
        }
      }
    })
  },

  /* ===== 微信登录：wx.login → /api/auth/wechat ===== */
  async onWechatLogin() {
    if (this.data.logging) return
    this.setData({ logging: true, loginError: '' })
    try {
      const { code } = await new Promise((resolve, reject) => {
        // 10s 超时兜底：wx.login 偶发无回调时 logging 态不至于卡死
        wx.login({ timeout: 10000, success: resolve, fail: () => reject(new Error('wx.login 调用失败')) })
      })
      const data = await wechatLogin(code)
      this.applyLogin(data)
    } catch (e) {
      // 后端未配置 AppID 等情况：如实提示（个人主体已下线游客通道）
      this.setData({ loginError: e.message || '微信登录暂不可用' })
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
    // 登录后数据全变（历史/打卡/订阅都是这个人的）：清缓存并强制拉一次
    this._tokenKey = data.token
    this.clearCache()
    this.refreshAll(true)
  },

  onLogout() {
    wx.removeStorageSync('token')
    wx.removeStorageSync('userInfo')
    getApp().globalData.token = ''
    getApp().globalData.userInfo = null
    // 退出即作废缓存，避免下次登录前又看到上一个人的数据
    this._tokenKey = ''
    this.clearCache()
    this.setData({
      token: '', userInfo: null,
      historyTarot: [], historyMatch: [], historyLoaded: false, historyError: '', expandedId: null,
      checkinStatus: null, checkinDots: [], checkinSummary: null, badges: [], checkinError: '',
      notifySubscribed: false, weeklySubscribed: false
    })
    this.refreshNotifyEntry()
    this.refreshWeeklyEntry()
    wx.showToast({ title: '已退出登录', icon: 'none' })
  },

  /* ===== 打卡 ===== */

  // 打卡状态：首次/过期才拉；失败必须显式置错误态——否则打卡卡会一直停在 loading spinner
  async buildCheckinStatus(force) {
    if (!force && this.cacheFresh('checkin')) return null
    try {
      const st = await fetchCheckinStatus()
      this.cacheMark('checkin')
      return { checkinStatus: st, checkinDots: this.buildDots(st.recentDates), checkinError: '' }
    } catch (e) {
      return { checkinError: e.message || '打卡状态加载失败，请重试' }
    }
  },

  // wxml「重新加载」按钮的绑定（强制绕过缓存）
  async loadCheckinStatus() {
    const patch = await this.buildCheckinStatus(true)
    if (patch) this.setData(patch)
  },

  // 打卡汇总：连续/最长/总天数 + 勋章墙；失败静默兜底（置 null，不打扰用户）
  async buildCheckinSummary(force) {
    if (!force && this.cacheFresh('summary')) return null
    try {
      // 只传真实 openid；没有就不传，后端从 token 解析身份（id 当 openid 传会查不到用户）
      const openid = (this.data.userInfo && this.data.userInfo.openid) || ''
      const sum = await fetchCheckinSummary(openid)
      this.cacheMark('summary')
      const badges = (sum.badges || []).map((b) => ({
        ...b,
        // 未解锁显示进度：当前连续天数 / 解锁门槛
        progressText: b.unlocked ? '' : `${Math.min(sum.currentStreak || 0, b.threshold)}/${b.threshold}`
      }))
      return { checkinSummary: sum, badges }
    } catch (e) {
      return { checkinSummary: null, badges: [] }
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
      // 打卡后状态必然变了：强制重拉两项，合并成 1 次 setData
      const [statusPatch, summaryPatch] = await Promise.all([
        this.buildCheckinStatus(true),
        this.buildCheckinSummary(true)
      ])
      const patch = Object.assign({}, statusPatch, summaryPatch)
      if (Object.keys(patch).length) this.setData(patch)
    } catch (e) {
      wx.showToast({ title: e.message || '打卡失败', icon: 'none' })
    } finally {
      this.setData({ checking: false })
    }
  },

  /* ===== 历史记录：塔罗 / 配对 各取最近 5 条 ===== */

  // 首次进入（或 60s 过期、force）才拉；失败显示错误态 + 重试，绝不吞成「暂无记录」
  async buildHistory(force) {
    if (!force && this.cacheFresh('history')) return null
    try {
      const [tarot, match] = await Promise.all([
        fetchHistory('TAROT'),
        fetchHistory('MATCH')
      ])
      this.cacheMark('history')
      return {
        historyTarot: this.formatList(tarot).map((it) => this.decorateTarot(it)),
        historyMatch: this.formatList(match).map((it) => this.decorateMatch(it)),
        historyLoaded: true,
        historyError: ''
      }
    } catch (e) {
      // token 失效等场景 request 已统一提示；这里只负责页面错误态（历史加载成功前 historyLoaded 保持 false）
      return { historyError: e.message || '记录加载失败，请重试' }
    }
  },

  // 「重新加载」按钮：绕过缓存重试
  async retryHistory() {
    this.setData({ historyError: '' })
    const patch = await this.buildHistory(true)
    if (patch) this.setData(patch)
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
