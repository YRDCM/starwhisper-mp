// 每日一卦：今日卦象 + 卦辞 + 现代解读 + 今日建议 + Kimi AI 解卦
const { fetchHexagramToday, fetchBaguaReading } = require('../../utils/request')

Page({
  data: {
    hex: null,   // {date, id, symbol, name, luckLevel, guaCi, interpretation, advice}
    stars: [],   // luckLevel(1-5) → ✦ 实/空布尔数组
    loading: false,
    error: '',
    // ===== Kimi AI 解卦（与起卦页同一接口：每日一卦无变爻，只传本卦卦序） =====
    aiQuestion: '',
    aiLoading: false,
    aiResult: null,
    aiError: '',
    aiExpanded: false
  },

  onLoad() {
    this.load()
  },

  async load() {
    if (this.data.loading) return
    this.setData({ loading: true, error: '' })
    try {
      const userInfo = wx.getStorageSync('userInfo') || {}
      // 只传真实 openid；没有就不传，后端从 token 解析身份（id 当 openid 传会拿不到个人卦）
      const openid = userInfo.openid || ''
      const hex = await fetchHexagramToday(openid)
      const level = Math.max(0, Math.min(5, Number(hex.luckLevel) || 0))
      this.setData({
        hex,
        stars: [1, 2, 3, 4, 5].map((n) => n <= level),
        loading: false,
        // 重新加载（跨天）时清掉上一卦的 AI 解读
        aiQuestion: '', aiLoading: false, aiResult: null, aiError: '', aiExpanded: false
      })
    } catch (e) {
      this.setData({
        error: e.message || '无法连接星语服务器，请稍后再试',
        hex: null,
        loading: false
      })
    }
  },

  retry() {
    this.load()
  },

  /* ===== Kimi AI 解卦 ===== */
  onAiQuestion(e) { if (!this.data.aiLoading && !this.data.aiResult) { this.setData({ aiQuestion: e.detail.value.slice(0, 300) }) } },
  toggleAiDetail() { this.setData({ aiExpanded: !this.data.aiExpanded }) },
  onUnload() { this._disposed = true },

  async readWithAi() {
    const hex = this.data.hex
    if (!hex || !hex.id || this.data.aiLoading || this.data.aiResult) return
    this.setData({ aiLoading: true, aiError: '' })
    try {
      const result = await fetchBaguaReading({
        primarySeq: hex.id,
        changedSeq: null,
        changingLines: [],
        question: this.data.aiQuestion.trim()
      })
      if (this._disposed || hex !== this.data.hex) return
      if (!result || !result.summary || !result.detail) throw new Error('未收到完整解读，请稍后重试')
      this.setData({ aiResult: result })
    } catch (e) {
      if (!this._disposed && hex === this.data.hex) this.setData({ aiError: e.message || '解读失败，请稍后重试' })
    } finally {
      if (!this._disposed && hex === this.data.hex) this.setData({ aiLoading: false })
    }
  },

  // 分享卡片：带今日卦名
  onShareAppMessage() {
    const hex = this.data.hex
    return {
      title: hex ? `今日卦象「${hex.name}」，看看你的 ✦` : '每日一卦 · 看看今天的启示',
      path: '/pages/hexagram/hexagram'
    }
  },
  onShareTimeline() {
    const hex = this.data.hex
    return { title: hex ? `今日卦象「${hex.name}」` : '每日一卦', query: '' }
  }
})
