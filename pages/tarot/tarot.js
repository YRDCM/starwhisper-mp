// 塔罗页：每日塔罗 + 抽牌仪式（3D 翻牌）+ 牌库（懒加载）
const { fetchTarotDaily, fetchTarotCards, drawTarot, fetchTarotReading } = require('../../utils/request')
const { BASE_URL } = require('../../utils/config')
// echarts 官方 UMD 构建（小程序兼容），由 ec-canvas 组件通过属性注入使用（同 fortune.js）
const echarts = require('../../components/ec-canvas/echarts.js')

// 图表等宽字体（小程序里用系统 monospace）
const MONO = 'monospace'

// 牌组元信息（牌库分组展示顺序）
const GROUP_META = [
  { key: 'MAJOR', zh: '大阿尔卡纳' },
  { key: 'WANDS', zh: '权杖' },
  { key: 'CUPS', zh: '圣杯' },
  { key: 'SWORDS', zh: '宝剑' },
  { key: 'PENTACLES', zh: '星币' }
]
const SNAPSHOT_KEY = 'starwhisper:tarot-session:v1'
const STUDY_KEY = 'starwhisper:learned-tarot'
const MOOD_KEY = 'starwhisper:daily-moods:v1'
const MOODS = ['平静', '开心', '期待', '纠结', '疲惫', '低落']
// 心情分数映射（0-5 分制，与运势页评分同刻度，供心情曲线图使用）：
// 开心 5 / 期待 4 / 平静 3 / 纠结 2 / 疲惫 1.5 / 低落 1。
// 疲惫定为 1.5 而非 1：它是精力状态而非情绪谷底，避免与「低落」并列最低档。
// 键序即分布统计的展示顺序（高分 → 低分）。
const MOOD_SCORES = { 开心: 5, 期待: 4, 平静: 3, 纠结: 2, 疲惫: 1.5, 低落: 1 }
// 心情 → 分数；未知心情返回 null（图表与统计自动跳过）
function moodScore(mood) {
  return MOOD_SCORES[mood] != null ? MOOD_SCORES[mood] : null
}
// 心情曲线数据：任意顺序的记录 → 日期升序 [{date, day:'MM-DD', mood, score}]，非法项跳过
function buildMoodCurve(records) {
  if (!Array.isArray(records)) return []
  return records
    .filter((r) => r && /^\d{4}-\d{2}-\d{2}$/.test(r.date) && moodScore(r.mood) != null)
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((r) => ({ date: r.date, day: r.date.slice(5), mood: r.mood, score: moodScore(r.mood) }))
}
// 近 30 天心情分布：按分数从高到低 [{mood, score, count, pct}]，只列出现过的记录；
// pct 为相对最多项的百分比（条形宽度用），全为 0 时返回 []
function buildMoodDist(records) {
  const counts = {}
  ;(Array.isArray(records) ? records : []).forEach((r) => {
    if (r && moodScore(r.mood) != null) counts[r.mood] = (counts[r.mood] || 0) + 1
  })
  const list = Object.keys(MOOD_SCORES)
    .map((mood) => ({ mood, score: MOOD_SCORES[mood], count: counts[mood] || 0 }))
    .filter((d) => d.count > 0)
  const max = list.reduce((m, d) => Math.max(m, d.count), 0) || 1
  list.forEach((d) => { d.pct = Math.round((d.count / max) * 100) })
  return list
}
function localDay() {
  const date = new Date()
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-')
}
function readMoods() {
  const saved = wx.getStorageSync(MOOD_KEY)
  if (!Array.isArray(saved)) return []
  const seen = new Set()
  return saved.filter(item => {
    if (!item || !/^\d{4}-\d{2}-\d{2}$/.test(item.date) || !MOODS.includes(item.mood) || seen.has(item.date)) return false
    seen.add(item.date)
    return true
  }).map(({ date, mood }) => ({ date, mood })).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 30)
}

// 关键词字符串 → 数组（顿号/逗号/斜杠分隔均兼容）
function splitKw(s) {
  if (!s) return []
  return String(s).split(/[、,，\/|]/).map((x) => x.trim()).filter(Boolean)
}

// 牌阵 key → 牌数（与 data.spreadGroups 同步的唯一口径）
function countOf(spreadGroups, mode) {
  let count = 1
  spreadGroups.forEach((g) => g.items.forEach((s) => { if (s.key === mode) count = s.count }))
  return count
}

// Fisher-Yates 洗牌：78 张牌序号 1-78 随机打乱，用户点的是网格位置，对应洗好的牌序号
function shuffled78() {
  const a = Array.from({ length: 78 }, (_, i) => i + 1)
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    const t = a[i]; a[i] = a[j]; a[j] = t
  }
  return a
}

// 牌图：服务器托管全部 78 张（{BASE_URL}/tarot/tarot-{no}.webp，no=1-78），仅用于详情弹层；
// 本地不再打包 webp（减主包体积）。
// no 由后端 TarotCardVO 直接输出（牌库列表与抽牌结果均有）；缺失时按 arcanaGroup+cardNumber
// 换算兜底：1-22 大牌（愚人=1…世界=22）、23-36 权杖、37-50 圣杯、51-64 宝剑、65-78 星币。
// 正式发布：需把该域名加入小程序后台 downloadFile 合法域名白名单，并随备案切 HTTPS。
const GROUP_OFFSET = { MAJOR: 1, WANDS: 22, CUPS: 36, SWORDS: 50, PENTACLES: 64 }
function cardImgUrl(card) {
  if (!card) return ''
  const no = card.no != null ? card.no : (card.cardNumber + (GROUP_OFFSET[card.arcanaGroup] || 0))
  if (!no || no < 1 || no > 78) return ''
  return `${BASE_URL}/tarot/tarot-${no}.webp`
}

Page({
  data: {
    drawCreatedAt: 0, restoreNotice: '', snapshotError: '',
    compact: true, detailIndex: 0, detailCards: [], meaningOpen: false,
    drawId: '', aiQuestion: '', aiLoading: false, aiResult: null, aiError: '', aiExpanded: false,
    todayStr: '',
    moodOptions: MOODS, todayMood: '', moodRecords: [], moodHistoryOpen: false, moodError: '',
    moodCurve: [], moodDist: [],  // 心情曲线点（升序）与近 30 天分布（条形图）
    echarts,                      // 注入给 ec-canvas 的 echarts 模块
    moodEc: null,                 // 心情曲线图懒初始化容器（onLoad 里注入 onInit）
    // 每日塔罗
    daily: null,
    dailyKeywords: [],
    dailyLoading: false,
    dailyError: '',
    // 抽牌仪式
    mode: 'single',     // 当前牌阵 key（见 spreadGroups）
    spreadHints: {
      single: '单牌指引 · 整理当下思绪，获得一个思考方向。',
      three: '时间之流 · 从过去、现在与未来三个角度梳理问题。',
      choice: '二选一 · 比较两个方向，探索各自的可能性。',
      love: '爱情十字 · 从双方状态、关系与阻碍理解相处。',
      celtic: '凯尔特十字 · 从十个角度深入梳理复杂问题。',
      hexagram: '六芒星 · 综合回顾经历、阻碍与可借助的力量。'
    },
    spreadGroups: [     // 牌阵选择器：日常 / 进阶两组，count 用于按钮标注与牌背数量
      {
        label: '日常牌阵',
        items: [
          { key: 'single', name: '单牌指引', count: 1 },
          { key: 'three', name: '时间之流', count: 3 },
          { key: 'choice', name: '二选一', count: 3 },
          { key: 'love', name: '爱情十字', count: 5 }
        ]
      },
      {
        label: '进阶牌阵',
        items: [
          { key: 'celtic', name: '凯尔特十字', count: 10 },
          { key: 'hexagram', name: '六芒星', count: 7 }
        ]
      }
    ],
    drawn: [],          // [{card, orientation, position, keywordsArr[], meaning, delay}]
    spread: '',         // 实际返回的牌阵 key
    spreadName: '',     // 实际返回的牌阵名
    choiceTop: null,    // 二选一：现状（顶）
    choiceWings: [],    // 二选一：选择 A/B（两翼）
    loveCells: null,    // 爱情十字：{top,left,center,right,bottom}
    revealedCount: 0,
    nextCard: null,
    revealedCards: [],
    lessonOpen: false,
    learnedCards: [],
    todayLearned: false,
    studyError: '',
    drawing: false,
    drawError: '',
    backCount: [0],     // 牌背展示数量（跟随所选牌阵的牌数，初始 single=1）
    // 自行选牌：开始抽牌 → 78 张洗牌牌背网格，逐张点选，选满确认开牌
    picking: false,     // 选牌界面显隐
    deck: [],           // 洗牌后的 78 格 [{no(1-78), selected, order(点选顺序, 0=未选)}]
    needCount: 1,       // 当前牌阵需要选的张数
    pickedCount: 0,     // 已选张数
    pickFull: false,    // 已选满（确认开牌按钮亮起）
    // 牌库
    archiveOpen: false,
    groups: [],
    cardsLoading: false,
    cardsError: '',
    activeCard: null    // 详情弹层的牌
  },

  onLoad() {
    try {
      const saved = wx.getStorageSync(STUDY_KEY)
      this.setData({ learnedCards: Array.isArray(saved) ? [...new Set(saved.filter((n) => Number.isInteger(n) && n >= 1 && n <= 78))] : [] })
    } catch { this.setData({ studyError: '暂时无法读取学习进度' }) }
    // 心情曲线图懒初始化：canvas 在展开心情记录且有 ≥2 天记录时才渲染
    this.setData({ moodEc: { onInit: (canvas, w, h, dpr) => this.initMoodChart(canvas, w, h, dpr) } })
    this.refreshMood()
    this.restoreSnapshot()
    this.loadDaily() // 进入页面即自动加载每日塔罗
  },

  onShow() {
    const changedDay = this.data.todayStr && this.data.todayStr !== localDay()
    this.refreshMood()
    if (changedDay) this.loadDaily()
  },

  refreshMood() {
    const todayStr = localDay()
    try {
      const moodRecords = readMoods()
      const today = moodRecords.find(item => item.date === todayStr)
      this.setData({ todayStr, moodRecords, todayMood: today ? today.mood : '', moodError: '',
        moodCurve: buildMoodCurve(moodRecords), moodDist: buildMoodDist(moodRecords) })
      this.updateMoodChart()
    } catch {
      this.setData({ todayStr, todayMood: '', moodRecords: [], moodCurve: [], moodDist: [], moodError: '暂时无法读取心情记录，请重新进入页面重试' })
    }
  },

  selectMood(e) {
    const mood = e.currentTarget.dataset.mood
    if (!MOODS.includes(mood)) return
    const todayStr = localDay()
    const changedDay = todayStr !== this.data.todayStr
    try {
      const records = readMoods().filter(item => item.date !== todayStr)
      const moodRecords = [{ date: todayStr, mood }, ...records].slice(0, 30)
      wx.setStorageSync(MOOD_KEY, moodRecords)
      this.setData({ todayStr, todayMood: mood, moodRecords, moodError: '',
        moodCurve: buildMoodCurve(moodRecords), moodDist: buildMoodDist(moodRecords) })
      this.updateMoodChart()
      if (changedDay) this.loadDaily()
    } catch {
      this.setData({ moodError: '心情未保存，请稍后再试' })
    }
  },

  toggleMoodHistory() {
    this.refreshMood()
    const open = !this.data.moodHistoryOpen
    this.setData({ moodHistoryOpen: open })
    // 收起时销毁图表实例（canvas 随 wx:if 卸载），重新展开由 ec-canvas onInit 重建
    if (!open && this._moodChart) {
      try { this._moodChart.dispose() } catch (e) { /* canvas 已卸载时忽略 */ }
      this._moodChart = null
    }
  },

  /* ===== 心情曲线图（ec-canvas 懒初始化，风格对齐运势页趋势图） ===== */
  initMoodChart(canvas, w, h, dpr) {
    if (this._moodChart) {
      try { this._moodChart.dispose() } catch (e) { /* 忽略旧实例 */ }
    }
    const chart = echarts.init(canvas, null, { width: w, height: h, devicePixelRatio: dpr })
    if (this.data.moodCurve.length >= 2) chart.setOption(this.buildMoodOption(), true)
    this._moodChart = chart
    return chart
  },
  updateMoodChart() {
    // 仅在图表存活且面板展开时更新；canvas 未渲染时等 onInit 用最新数据画
    if (this._moodChart && this.data.moodHistoryOpen && this.data.moodCurve.length >= 2) {
      this._moodChart.setOption(this.buildMoodOption(), true)
    }
  },
  // 心情曲线：香槟金主线 + 渐变底色；y 轴刻度直接显示心情名（疲惫 1.5 无整刻度，tooltip 展示精确分数）
  buildMoodOption() {
    const curve = this.data.moodCurve
    const MOOD_AT = { 5: '开心', 4: '期待', 3: '平静', 2: '纠结', 1: '低落' }
    return {
      textStyle: { fontFamily: MONO },
      tooltip: {
        trigger: 'axis',
        // 小程序无 DOM，tooltip 必须用画布内渲染，否则触摸时 document 调用会崩
        renderMode: 'richText',
        backgroundColor: 'rgba(35, 32, 72, 0.95)',
        borderColor: 'rgba(232, 196, 124, 0.25)',
        textStyle: { color: '#E8E6F0', fontFamily: MONO, fontSize: 12.5 },
        formatter: (params) => {
          const p = params && params[0]
          const item = p && curve[p.dataIndex]
          return item ? `${item.date} · ${item.mood}（${item.score} 分）` : ''
        }
      },
      grid: { left: 52, right: 18, top: 24, bottom: 30 },
      xAxis: {
        type: 'category', data: curve.map((p) => p.day),
        axisLine: { lineStyle: { color: 'rgba(139, 135, 176, 0.15)' } },
        axisTick: { show: false },
        axisLabel: { color: '#A9A4CC', fontFamily: MONO, fontSize: 12 }
      },
      yAxis: {
        type: 'value', min: 0, max: 5, interval: 1,
        splitLine: { lineStyle: { color: 'rgba(139, 135, 176, 0.15)' } },
        axisLabel: { color: '#A9A4CC', fontFamily: MONO, fontSize: 12,
          formatter: (v) => MOOD_AT[v] || '' }
      },
      series: [{
        name: '心情', type: 'line', smooth: true, symbol: 'circle', symbolSize: 6,
        data: curve.map((p) => p.score),
        lineStyle: { color: '#E8C47C', width: 1.5 },
        itemStyle: { color: '#E8C47C' },
        areaStyle: {
          color: {
            type: 'linear', x: 0, y: 0, x2: 0, y2: 1,
            colorStops: [
              { offset: 0, color: 'rgba(232, 196, 124, 0.22)' },
              { offset: 1, color: 'rgba(232, 196, 124, 0)' }
            ]
          }
        }
      }]
    }
  },

  // 纯函数挂到 page 配置，便于 node 单测直接调用（与 web 端同名同逻辑）
  moodScore, buildMoodCurve, buildMoodDist,

  onHide() { this.saveSnapshot() },

  onUnload() {
    this.saveSnapshot()
    if (this._moodChart) {
      try { this._moodChart.dispose() } catch (e) { /* 忽略 */ }
      this._moodChart = null
    }
    this._disposed = true
  },

  /* ===== 每日塔罗 ===== */
  async loadDaily() {
    this.setData({ dailyLoading: true, dailyError: '' })
    try {
      const daily = await fetchTarotDaily()
      if (this._disposed) return
      this.setData({ daily, dailyKeywords: splitKw(daily.keywords), dailyLoading: false,
        todayLearned: this.data.learnedCards.includes(this.studyCardNo(daily.card)) })
    } catch (e) {
      if (!this._disposed) this.setData({ dailyError: e.message || '无法连接星语服务器', dailyLoading: false })
    }
  },

  /* ===== 抽牌仪式 ===== */
  setMode(e) {
    if (this.data.drawing) return
    this.removeSnapshot()
    this.clearReading()
    const mode = e.currentTarget.dataset.mode
    // 牌背数量跟随牌阵牌数
    const count = countOf(this.data.spreadGroups, mode)
    const patch = { mode, needCount: count, backCount: Array.from({ length: count }, (_, i) => i) }
    if (this.data.drawn.length) Object.assign(patch, { drawn: [], revealedCount: 0, revealedCards: [], nextCard: null, drawError: '' })
    // 切换牌阵时退出选牌（牌数变了，已选作废）
    if (this.data.picking) Object.assign(patch, { picking: false, deck: [], pickedCount: 0, pickFull: false })
    this.setData(patch)
  },

  /* ===== 自行选牌：78 张洗牌牌背网格 ===== */
  // 「开始抽牌」→ 进入选牌界面
  startPick() {
    if (this.data.drawing) return
    const deck = shuffled78().map((no) => ({ no, selected: false, order: 0 }))
    this.setData({ picking: true, deck, pickedCount: 0, pickFull: false, drawError: '' })
  },

  cancelPick() {
    if (this.data.drawing) return
    this.setData({ picking: false, deck: [], pickedCount: 0, pickFull: false })
  },

  // 点选/取消：选满后需先取消才能换牌；order 记录点选顺序（牌位按此映射）
  onPickCard(e) {
    if (this.data.drawing) return
    const i = e.currentTarget.dataset.index
    const deck = this.data.deck
    const item = deck[i]
    if (!item) return
    const patch = {}
    if (item.selected) {
      const removed = item.order
      patch[`deck[${i}].selected`] = false
      patch[`deck[${i}].order`] = 0
      deck.forEach((d, j) => {
        if (d.selected && d.order > removed) patch[`deck[${j}].order`] = d.order - 1
      })
      patch.pickedCount = this.data.pickedCount - 1
      patch.pickFull = false
    } else {
      if (this.data.pickedCount >= this.data.needCount) {
        wx.showToast({ title: `已选满 ${this.data.needCount} 张，点已选中的牌可取消重选`, icon: 'none' })
        return
      }
      const count = this.data.pickedCount + 1
      patch[`deck[${i}].selected`] = true
      patch[`deck[${i}].order`] = count
      patch.pickedCount = count
      patch.pickFull = count === this.data.needCount
    }
    this.setData(patch)
  },

  // 选满确认：按点选顺序取牌序号，走 cardNos 契约抽牌
  confirmPick() {
    if (!this.data.pickFull || this.data.drawing) return
    const nos = this.data.deck
      .filter((d) => d.selected)
      .sort((a, b) => a.order - b.order)
      .map((d) => d.no)
    this.doDraw(nos)
  },

  // 「随机为我抽」：不想自己选，退出选牌走原有随机流程
  randomPick() {
    if (this.data.drawing) return
    this.cancelPick()
    this.doDraw()
  },

  // cardNos：自选牌序号数组（契约：数量=牌阵张数、序号 1-78、正逆位后端定）；
  // 直接点按钮/事件回调进来时首参是 event，统一归一化为 null
  async doDraw(cardNos) {
    if (this.data.drawing) return
    this.clearReading()
    const nos = Array.isArray(cardNos) && cardNos.length ? cardNos : null
    this.setData({ drawing: true, drawError: '' })
    try {
      // 自选失败保留已选牌，避免静默改成随机抽牌。
      const result = await drawTarot(this.data.mode, nos)
      if (this._disposed) return
      if (!result || !Array.isArray(result.cards) || !result.cards.length) throw new Error('未收到完整牌面，请重新尝试')
      const drawn = (result.cards || []).map((d, i) => ({
        ...d,
        keywordsArr: splitKw(d.keywords),
        orderIndex: i
      }))
      const patch = {
        drawId: result.drawId || '', drawCreatedAt: Date.now(), restoreNotice: '',
        drawn,
        spread: result.spread || this.data.mode,
        spreadName: result.spreadName || '',
        revealedCount: 0, revealedCards: [], nextCard: drawn[0],
        // 抽牌成功即退出选牌态
        picking: false, deck: [], pickedCount: 0, pickFull: false
      }
      // 二选一布局：现状居中略小（顶）+ 选择 A/B 两翼
      if (patch.spread === 'choice') {
        patch.choiceTop = drawn[0] || null
        patch.choiceWings = drawn.slice(1)
      }
      // 爱情十字布局：按牌位名映射五宫格
      if (patch.spread === 'love') {
        const byPos = {}
        drawn.forEach((d) => { byPos[d.position] = d })
        patch.loveCells = {
          top: byPos['现实阻碍'] || null,
          left: byPos['你的状态'] || null,
          center: byPos['关系现状'] || null,
          right: byPos['对方的状态'] || null,
          bottom: byPos['结果与建议'] || null
        }
      }
      this.setData(patch)
      this.saveSnapshot()
    } catch (e) {
      if (!this._disposed) this.setData({ drawError: e.message || '无法连接星语服务器', drawn: [] })
    } finally {
      if (!this._disposed) this.setData({ drawing: false })
    }
  },

  resetDraw() {
    this.removeSnapshot()
    this.clearReading()
    this.setData({ drawn: [], revealedCount: 0, revealedCards: [], nextCard: null, drawError: '', picking: false, deck: [], pickedCount: 0, pickFull: false })
  },

  revealNext() {
    if (this.data.revealedCount >= this.data.drawn.length) return
    this.updateRevealed(this.data.revealedCount + 1)
  },
  revealAll() { this.updateRevealed(this.data.drawn.length); this.selectDetailIndex(0) },
  onRevealCard(e) {
    const index = Number(e.currentTarget.dataset.index)
    if (index < this.data.revealedCount) this.selectDetailIndex(index)
    else if (index === this.data.revealedCount) this.revealNext()
  },
  updateRevealed(count) {
    this.setData({ revealedCount: count, revealedCards: this.data.drawn.slice(0, count), nextCard: this.data.drawn[count] || null })
    this.selectDetailIndex(count - 1)
  },
  selectDetailIndex(index) {
    if (!Number.isInteger(index) || index < 0 || index >= this.data.revealedCount) return
    this.setData({ detailIndex: index, detailCards: [this.data.drawn[index]], meaningOpen: this.data.drawn.length === 1 })
    this.saveSnapshot()
  },
  selectDetail(e) { this.selectDetailIndex(Number(e.currentTarget.dataset.index)) },
  toggleMeaning() { this.setData({ meaningOpen: !this.data.meaningOpen }) },
  toggleCompact() { this.setData({ compact: !this.data.compact }) },
  toggleAiDetail() { this.setData({ aiExpanded: !this.data.aiExpanded }) },
  onAiQuestion(e) { if (!this.data.aiLoading && !this.data.aiResult) { this.setData({ aiQuestion: e.detail.value.slice(0, 300) }); this.saveSnapshot() } },
  clearReading() {
    this.setData({ restoreNotice: '', drawId: '', aiLoading: false, aiResult: null, aiError: '', aiExpanded: false, detailIndex: 0, detailCards: [], meaningOpen: false })
  },
  async readWithAi() {
    if (!this.data.drawId || this.data.nextCard || this.data.aiLoading || this.data.aiResult) return
    const id = this.data.drawId
    this.setData({ aiLoading: true, aiError: '' })
    try {
      const result = await fetchTarotReading(id, this.data.aiQuestion.trim())
      if (this._disposed || id !== this.data.drawId) return
      if (!result || !result.summary || !result.detail) throw new Error('未收到完整解读，请稍后重试')
      this.setData({ aiResult: result })
      this.saveSnapshot()
    } catch (e) {
      if (!this._disposed && id === this.data.drawId) this.setData({ aiError: e.message || '解读失败，请稍后重试' })
    } finally {
      if (!this._disposed && id === this.data.drawId) this.setData({ aiLoading: false })
    }
  },

  removeSnapshot() {
    try { wx.removeStorageSync(SNAPSHOT_KEY); this.setData({ snapshotError: '' }) }
    catch { this.setData({ snapshotError: '无法清除本地牌阵，请检查设备存储设置' }) }
  },
  saveSnapshot() {
    const d = this.data
    if (!d.drawn.length) return
    try {
      wx.setStorageSync(SNAPSHOT_KEY, { version: 1, createdAt: d.drawCreatedAt, spread: d.spread,
        spreadName: d.spreadName, cards: d.drawn, drawId: d.drawId, revealedCount: d.revealedCount,
        detailIndex: d.detailIndex, question: d.aiQuestion, reading: d.aiResult })
      this.setData({ snapshotError: '' })
    } catch { this.setData({ snapshotError: '本次牌阵未能保存，离开后可能丢失；仍可继续阅读' }) }
  },
  restoreSnapshot() {
    try {
      const s = wx.getStorageSync(SNAPSHOT_KEY)
      if (!s) return
      const count = { single: 1, three: 3, choice: 3, love: 5, celtic: 10, hexagram: 7 }[s.spread]
      if (s.version !== 1 || !count || !Array.isArray(s.cards) || s.cards.length !== count ||
          !s.cards.every(d => d && d.card && typeof d.card.name === 'string' && ['upright','reversed'].includes(d.orientation)) ||
          !Number.isFinite(s.createdAt) || s.createdAt > Date.now() || Date.now() - s.createdAt > 7 * 86400000 ||
          !Number.isInteger(s.revealedCount) || s.revealedCount < 0 || s.revealedCount > count) {
        this.removeSnapshot(); return
      }
      const drawn = s.cards.map((d,i) => ({ ...d, orderIndex: i, keywordsArr: splitKw(d.keywords) }))
      const expired = Date.now() - s.createdAt >= 2 * 3600000
      const byPos = {}; drawn.forEach(d => { byPos[d.position] = d })
      const detailIndex = Number.isInteger(s.detailIndex) && s.detailIndex >= 0 && s.detailIndex < s.revealedCount ? s.detailIndex : 0
      this.setData({ drawn, mode: s.spread, spread: s.spread, spreadName: typeof s.spreadName === 'string' ? s.spreadName : '',
        needCount: count, backCount: Array.from({length: count}, (_,i) => i), drawCreatedAt: s.createdAt,
        revealedCount: s.revealedCount, revealedCards: drawn.slice(0,s.revealedCount), nextCard: drawn[s.revealedCount] || null,
        detailIndex, detailCards: s.revealedCount ? [drawn[detailIndex]] : [], meaningOpen: count === 1,
        choiceTop: drawn[0], choiceWings: drawn.slice(1),
        loveCells: { top: byPos['现实阻碍'] || null, left: byPos['你的状态'] || null, center: byPos['关系现状'] || null, right: byPos['对方的状态'] || null, bottom: byPos['结果与建议'] || null },
        aiQuestion: typeof s.question === 'string' ? s.question.slice(0,300) : '',
        aiResult: s.reading && typeof s.reading.summary === 'string' && typeof s.reading.detail === 'string' ? s.reading : null,
        drawId: !expired && typeof s.drawId === 'string' ? s.drawId : '',
        restoreNotice: expired ? '已恢复本地牌阵，仅供回看；如需新的 AI 解读，请重新抽牌。' : '已恢复上次牌阵与翻牌进度 · 仅保存在当前设备' })
    } catch { this.removeSnapshot(); this.setData({ snapshotError: '本地牌阵无法恢复，请重新抽牌' }) }
  },

  toggleLesson() { this.setData({ lessonOpen: !this.data.lessonOpen }) },
  studyCardNo(card) {
    return card ? (card.no != null ? card.no : card.cardNumber + (GROUP_OFFSET[card.arcanaGroup] || 0)) : null
  },
  markLearned() {
    const no = this.studyCardNo(this.data.daily && this.data.daily.card)
    if (!this.data.lessonOpen || this.data.todayLearned || !Number.isInteger(no) || no < 1 || no > 78) return
    try {
      const saved = wx.getStorageSync(STUDY_KEY)
      const valid = Array.isArray(saved) ? saved.filter((n) => Number.isInteger(n) && n >= 1 && n <= 78) : []
      const learnedCards = [...new Set([...valid, ...this.data.learnedCards, no])]
      wx.setStorageSync(STUDY_KEY, learnedCards)
      this.setData({ learnedCards, todayLearned: true, studyError: '' })
    } catch { this.setData({ studyError: '学习进度未能保存，请稍后重试' }) }
  },

  /* ===== 牌库（首次展开懒加载） ===== */
  async toggleArchive() {
    const open = !this.data.archiveOpen
    this.setData({ archiveOpen: open })
    if (open && !this.data.groups.length && !this.data.cardsLoading) {
      this.setData({ cardsLoading: true, cardsError: '' })
      try {
        const cards = await fetchTarotCards()
        const groups = GROUP_META
          .map((g) => ({ ...g, cards: cards.filter((c) => c.arcanaGroup === g.key) }))
          .filter((g) => g.cards.length)
        this.setData({ groups, cardsLoading: false })
      } catch (e) {
        this.setData({ cardsError: e.message || '无法连接星语服务器', cardsLoading: false })
      }
    }
  },

  // 点开牌详情弹层（预拆正逆位关键词, 按 no 拼服务器牌图 URL——加载失败时清空回落纯样式牌面）
  onCardTap(e) {
    const card = e.currentTarget.dataset.card
    this.setData({
      activeCard: {
        ...card,
        uprightArr: splitKw(card.uprightKeywords),
        reversedArr: splitKw(card.reversedKeywords),
        imgSrc: cardImgUrl(card)
      }
    })
  },
  // 牌图加载失败（断网/图片缺失）：清空 imgSrc，弹层回落原纯样式牌面，不报错
  onCardImgError() {
    if (this.data.activeCard) this.setData({ 'activeCard.imgSrc': '' })
  },
  closeModal() {
    this.setData({ activeCard: null })
  },
  noop() {} // 弹层内容区拦截冒泡，防止误触关闭
})
