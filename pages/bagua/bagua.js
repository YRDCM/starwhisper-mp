// 八卦页：每日一卦 + 铜钱起卦（六爻逐条显现）+ 六十四卦档案
const { fetchBaguaDaily, castBagua, fetchHexagrams } = require('../../utils/request')

// 八卦符号映射（后端返回中文卦名；☰☱☲☳☴☵☶☷ 为基本平面符号，字体覆盖好）
const TRIGRAM_SYMBOLS = {
  乾: '☰', 兑: '☱', 离: '☲', 震: '☳', 巽: '☴', 坎: '☵', 艮: '☶', 坤: '☷'
}

Page({
  data: {
    todayStr: '',
    // 每日一卦
    daily: null,
    dailyLoading: false,
    dailyError: '',
    // 铜钱起卦
    castResult: null,
    casting: false,
    castError: '',
    revealedCount: 0,   // 已显现爻数（position ≤ revealedCount 即显现）
    showResult: false,
    castLines: [],      // 预处理的六爻视图数据（自上而下 6..1）
    // 六十四卦
    archiveOpen: false,
    hexagrams: [],
    listLoading: false,
    listError: '',
    activeHex: null
  },

  onLoad() {
    this.setData({ todayStr: new Date().toISOString().slice(0, 10) })
    this.loadDaily() // 进入页面即自动加载每日一卦
  },

  /* ===== 卦运等级 → 印章配色类名 ===== */
  levelClass(level) {
    if (level === '上上' || level === '上吉') return 'jade'
    if (level === '中吉' || level === '中平') return 'gold'
    return 'cinnabar'
  },

  trigramSymbol(name) {
    return TRIGRAM_SYMBOLS[name] || ''
  },

  // 给卦对象附加展示字段（印章类名 / 上下卦符号 / 三才行）
  decorate(h) {
    if (!h) return h
    return {
      ...h,
      levelClass: this.levelClass(h.fortuneLevel),
      trigramLine: `上${h.upperTrigram} ${this.trigramSymbol(h.upperTrigram)} · 下${h.lowerTrigram} ${this.trigramSymbol(h.lowerTrigram)}`
    }
  },

  /* ===== 每日一卦 ===== */
  async loadDaily() {
    this.setData({ dailyLoading: true, dailyError: '' })
    try {
      const daily = await fetchBaguaDaily()
      this.setData({ daily: this.decorate(daily), dailyLoading: false })
    } catch (e) {
      this.setData({ dailyError: e.message || '无法连接星语服务器', dailyLoading: false })
    }
  },

  /* ===== 铜钱起卦：六爻自下而上逐爻显现（每 220ms 一爻） ===== */
  async doCast() {
    this.setData({ casting: true, castError: '' })
    try {
      const result = await castBagua()
      // 预处理六爻视图数据：视觉顶部 = 第六爻 → 自上而下遍历 position 6..1
      const castLines = [6, 5, 4, 3, 2, 1].map((pos) => {
        const line = result.linesDetail.find((l) => l.position === pos) || {}
        return {
          pos,
          yang: !!line.yang,
          changing: !!line.changing,
          // 老阳 ○（金）/ 老阴 ✕（朱砂）为传统变爻记号
          label: (line.label || '') + (line.changing ? (line.yang ? ' ○' : ' ✕') : ''),
          labelClass: line.changing ? (line.yang ? 'lao-yang' : 'lao-yin') : ''
        }
      })
      this.setData({
        castResult: {
          primary: this.decorate(result.primary),
          changed: result.changed ? this.decorate(result.changed) : null
        },
        castLines,
        revealedCount: 0,
        showResult: false
      })
      const timer = setInterval(() => {
        const n = this.data.revealedCount + 1
        this.setData({ revealedCount: n })
        if (n >= 6) {
          clearInterval(timer)
          setTimeout(() => this.setData({ showResult: true }), 350)
        }
      }, 220)
    } catch (e) {
      this.setData({ castError: e.message || '无法连接星语服务器', castResult: null })
    } finally {
      this.setData({ casting: false })
    }
  },

  resetCast() {
    this.setData({ castResult: null, castLines: [], revealedCount: 0, showResult: false, castError: '' })
  },

  /* ===== 六十四卦（首次展开懒加载） ===== */
  async toggleArchive() {
    const open = !this.data.archiveOpen
    this.setData({ archiveOpen: open })
    if (open && !this.data.hexagrams.length && !this.data.listLoading) {
      this.setData({ listLoading: true, listError: '' })
      try {
        const hexagrams = await fetchHexagrams()
        this.setData({ hexagrams: hexagrams.map((h) => this.decorate(h)), listLoading: false })
      } catch (e) {
        this.setData({ listError: e.message || '无法连接星语服务器', listLoading: false })
      }
    }
  },

  onHexTap(e) {
    this.setData({ activeHex: e.currentTarget.dataset.hex })
  },
  closeModal() {
    this.setData({ activeHex: null })
  },
  noop() {} // 弹层内容区拦截冒泡
})
