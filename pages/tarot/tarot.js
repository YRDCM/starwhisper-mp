// 塔罗页：每日塔罗 + 抽牌仪式（3D 翻牌）+ 牌库（懒加载）
const { fetchTarotDaily, fetchTarotCards, request } = require('../../utils/request')

// 牌组元信息（牌库分组展示顺序）
const GROUP_META = [
  { key: 'MAJOR', zh: '大阿尔卡纳' },
  { key: 'WANDS', zh: '权杖' },
  { key: 'CUPS', zh: '圣杯' },
  { key: 'SWORDS', zh: '宝剑' },
  { key: 'PENTACLES', zh: '星币' }
]

// 关键词字符串 → 数组（顿号/逗号/斜杠分隔均兼容）
function splitKw(s) {
  if (!s) return []
  return String(s).split(/[、,，\/|]/).map((x) => x.trim()).filter(Boolean)
}

Page({
  data: {
    todayStr: '',
    // 每日塔罗
    daily: null,
    dailyKeywords: [],
    dailyLoading: false,
    dailyError: '',
    // 抽牌仪式
    mode: 'single',     // 当前牌阵 key（见 spreadGroups）
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
    flipped: false,     // 是否已翻开（驱动 3D 翻转）
    drawing: false,
    drawError: '',
    backCount: [0],     // 牌背展示数量（跟随所选牌阵的牌数，初始 single=1）
    // 牌库
    archiveOpen: false,
    groups: [],
    cardsLoading: false,
    cardsError: '',
    activeCard: null    // 详情弹层的牌
  },

  onLoad() {
    this.setData({ todayStr: new Date().toISOString().slice(0, 10) })
    this.loadDaily() // 进入页面即自动加载每日塔罗
  },

  /* ===== 每日塔罗 ===== */
  async loadDaily() {
    this.setData({ dailyLoading: true, dailyError: '' })
    try {
      const daily = await fetchTarotDaily()
      this.setData({ daily, dailyKeywords: splitKw(daily.keywords), dailyLoading: false })
    } catch (e) {
      this.setData({ dailyError: e.message || '无法连接星语服务器', dailyLoading: false })
    }
  },

  /* ===== 抽牌仪式 ===== */
  setMode(e) {
    if (this.data.drawing) return
    const mode = e.currentTarget.dataset.mode
    // 牌背数量跟随牌阵牌数
    let count = 1
    this.data.spreadGroups.forEach((g) => g.items.forEach((s) => { if (s.key === mode) count = s.count }))
    const patch = { mode, backCount: Array.from({ length: count }, (_, i) => i) }
    if (this.data.drawn.length) Object.assign(patch, { drawn: [], flipped: false, drawError: '' })
    this.setData(patch)
  },

  async doDraw() {
    this.setData({ drawing: true, drawError: '' })
    try {
      // 后端 v3：spread 是 @RequestParam——wx.request 默认发 JSON body，服务端读不到，
      // 必须拼进 query，否则任何牌阵都会回退成 single（utils/request.js 的封装不支持 query，这里直调）
      const result = await request({ url: `/tarot/draw?spread=${this.data.mode}`, method: 'POST' })
      const drawn = (result.cards || []).map((d, i) => ({
        ...d,
        keywordsArr: splitKw(d.keywords),
        delay: i * 150 // 翻牌 stagger（各阵型共用同一序号）
      }))
      const patch = {
        drawn,
        spread: result.spread || this.data.mode,
        spreadName: result.spreadName || '',
        flipped: false
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
      // 等 DOM 渲染出背面后再触发翻转，形成逐张 stagger
      setTimeout(() => this.setData({ flipped: true }), 80)
    } catch (e) {
      this.setData({ drawError: e.message || '无法连接星语服务器', drawn: [] })
    } finally {
      this.setData({ drawing: false })
    }
  },

  resetDraw() {
    this.setData({ drawn: [], flipped: false, drawError: '' })
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

  // 点开牌详情弹层（预拆正逆位关键词）
  onCardTap(e) {
    const card = e.currentTarget.dataset.card
    this.setData({
      activeCard: {
        ...card,
        uprightArr: splitKw(card.uprightKeywords),
        reversedArr: splitKw(card.reversedKeywords)
      }
    })
  },
  closeModal() {
    this.setData({ activeCard: null })
  },
  noop() {} // 弹层内容区拦截冒泡，防止误触关闭
})
