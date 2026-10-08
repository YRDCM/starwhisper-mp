// 配对页：双星座选择器（带性别）+ 配对结果（金环综合指数 + 六维细分 + 文案分块）
const { fetchSigns, fetchMatch } = require('../../utils/request')

// 细分指数维度：字段 → 中文名（顺序固定）
const SCORE_DIMS = [
  { key: 'love', zh: '爱情' },
  { key: 'friendship', zh: '友情' },
  { key: 'marriage', zh: '婚姻' },
  { key: 'forever', zh: '天长地久' },
  { key: 'lqxy', zh: '两情相悦' },
  { key: 'affection', zh: '亲情' }
]

Page({
  data: {
    signs: [],
    // 两个选择器：当前选中星座 id + 性别（1 男 / 0 女）
    sel1: { signId: null, gender: 1 },
    sel2: { signId: null, gender: 0 },
    // 结果区
    loading: false,
    error: '',
    result: null,      // 原始 data
    ringStyle: '',     // 金环 conic-gradient 内联样式
    subScores: [],     // 六维细分 [{zh, score, width}]
    sections: []       // 文案分块 [{zh, text}]
  },

  onLoad() {
    this.init()
  },

  async init() {
    try {
      const signs = await fetchSigns()
      const today = this.findTodaySign(signs)
      const leo = signs.find((s) => s.nameEn === 'leo') || signs[4]
      // 首屏默认：今日星座 × 狮子座 自动配对一次
      this.setData({
        signs,
        'sel1.signId': today.id,
        'sel2.signId': leo.id
      })
      this.doMatch()
    } catch (e) {
      this.setData({ error: e.message || '无法连接星语服务器' })
    }
  },

  /* ===== 星座区间判断（摩羯跨年边界，与星运页一致） ===== */
  inRange(sign, month, day) {
    const { startMonth: sm, startDay: sd, endMonth: em, endDay: ed } = sign
    if (sm > em) return (month === sm && day >= sd) || (month === em && day <= ed)
    return (month === sm && day >= sd) || (month === em && day <= ed)
  },
  findTodaySign(list) {
    const now = new Date()
    return list.find((s) => this.inRange(s, now.getMonth() + 1, now.getDate())) || list[0]
  },

  /* ===== 选择器交互 ===== */
  onPickSign(e) {
    const { side, id } = e.currentTarget.dataset
    this.setData({ [`sel${side}.signId`]: id })
  },
  onPickGender(e) {
    const { side, gender } = e.currentTarget.dataset
    this.setData({ [`sel${side}.gender`]: Number(gender) })
  },

  /* ===== 配对请求与结果派生 ===== */
  async doMatch() {
    const { signs, sel1, sel2 } = this.data
    const s1 = signs.find((s) => s.id === sel1.signId)
    const s2 = signs.find((s) => s.id === sel2.signId)
    if (!s1 || !s2) return
    this.setData({ loading: true, error: '' })
    try {
      const data = await fetchMatch(s1.nameEn, s2.nameEn, sel1.gender, sel2.gender)
      const overall = data.scores ? data.scores.overall : 0
      this.setData({
        result: data,
        loading: false,
        // 综合指数金环：conic-gradient 按百分比填充（WXSS 支持）
        ringStyle: `background:conic-gradient(#E8C47C ${overall}%, rgba(139,135,176,0.15) ${overall}%);`,
        subScores: SCORE_DIMS.map((d) => ({
          zh: d.zh,
          score: data.scores[d.key],
          width: data.scores[d.key] + '%'
        })),
        sections: [
          { zh: '缘分解析', en: 'PREDESTINATION', text: data.predestination },
          { zh: '配对点评', en: 'REVIEW', text: data.review },
          { zh: '恋爱建议', en: 'ADVICE', text: data.suggest },
          { zh: '注意事项', en: 'ATTENTION', text: data.attention }
        ].filter((s) => s.text),
        // 配对比重（如 52:48）与经典案例
        proportion: data.proportion || '',
        matchCase: data.matchCase || '',
        sourceTag: data.source === 'SHOWAPI' ? 'DATA · 万维易源 SHOWAPI' : 'DATA · 本地星算 LOCAL',
        isShowapi: data.source === 'SHOWAPI'
      })
    } catch (e) {
      this.setData({ error: e.message || '配对失败，请稍后重试', loading: false })
    }
  }
})
