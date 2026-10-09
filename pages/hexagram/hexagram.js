// 每日一卦：今日卦象 + 卦辞 + 现代解读 + 今日建议
const { fetchHexagramToday } = require('../../utils/request')

Page({
  data: {
    hex: null,   // {date, symbol, name, luckLevel, guaCi, reading, advice}
    stars: [],   // luckLevel(1-5) → ✦ 实/空布尔数组
    loading: false,
    error: ''
  },

  onLoad() {
    this.load()
  },

  async load() {
    if (this.data.loading) return
    this.setData({ loading: true, error: '' })
    try {
      const userInfo = wx.getStorageSync('userInfo') || {}
      const openid = userInfo.openid || userInfo.id || ''
      const hex = await fetchHexagramToday(openid)
      const level = Math.max(0, Math.min(5, Number(hex.luckLevel) || 0))
      this.setData({
        hex,
        stars: [1, 2, 3, 4, 5].map((n) => n <= level),
        loading: false
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
  }
})
