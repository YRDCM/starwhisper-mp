// 八卦页：每日一卦 + 铜钱起卦（六爻逐条显现）+ 六十四卦档案 + Kimi AI 解卦
const { fetchBaguaDaily, castBagua, fetchHexagrams, fetchBaguaReading } = require('../../utils/request')

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
    changingLines: [],  // 本次起卦的变爻位置（AI 解卦请求用）
    // Kimi AI 解卦（状态字段与塔罗页对齐）
    aiQuestion: '',
    aiLoading: false,
    aiResult: null,
    aiError: '',
    aiExpanded: false,
    // 六十四卦
    archiveOpen: false,
    hexagrams: [],
    listLoading: false,
    listError: '',
    activeHex: null
  },

  onLoad() {
    // 2026-10-20：板块临时下架（WXML 已是维护页），不再发任何数据请求
    return
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
        changingLines: result.changingLines || [],
        revealedCount: 0,
        showResult: false,
        aiQuestion: '', aiLoading: false, aiResult: null, aiError: '', aiExpanded: false
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
    this.setData({
      castResult: null, castLines: [], changingLines: [], revealedCount: 0, showResult: false, castError: '',
      aiQuestion: '', aiLoading: false, aiResult: null, aiError: '', aiExpanded: false
    })
  },

  /* ===== Kimi AI 解卦（交互与塔罗页 AI 解牌对齐） ===== */
  onAiQuestion(e) { if (!this.data.aiLoading && !this.data.aiResult) { this.setData({ aiQuestion: e.detail.value.slice(0, 300) }) } },
  toggleAiDetail() { this.setData({ aiExpanded: !this.data.aiExpanded }) },
  onUnload() { this._disposed = true },

  async readWithAi() {
    const cast = this.data.castResult
    if (!cast || !this.data.showResult || this.data.aiLoading || this.data.aiResult) return
    this.setData({ aiLoading: true, aiError: '' })
    try {
      const result = await fetchBaguaReading({
        primarySeq: cast.primary.seqNumber,
        changedSeq: cast.changed ? cast.changed.seqNumber : null,
        changingLines: this.data.changingLines,
        question: this.data.aiQuestion.trim()
      })
      if (this._disposed || cast !== this.data.castResult) return
      if (!result || !result.summary || !result.detail) throw new Error('未收到完整解读，请稍后重试')
      this.setData({ aiResult: result })
    } catch (e) {
      if (!this._disposed && cast === this.data.castResult) this.setData({ aiError: e.message || '解读失败，请稍后重试' })
    } finally {
      if (!this._disposed && cast === this.data.castResult) this.setData({ aiLoading: false })
    }
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
    noop() {}, // 弹层内容区拦截冒泡

  // 分享卡片：带起出的卦名
  onShareAppMessage() {
    const cast = this.data.castResult
    const name = cast && cast.primary ? cast.primary.name : ''
    return {
      title: name ? `我起了一卦「${name}」，来看看卦象 ✦` : '易经起卦 · 三枚铜钱问问当下',
      path: '/pages/bagua/bagua'
    }
  },
  onShareTimeline() {
    return { title: '星语易经 · 起一卦，看看当下的启示', query: '' }
  }
})
