// 星座星联组件：按星座名渲染金点 + 细连线
const { constellationOf } = require('../../utils/constellations')

// 取不到图案时用四星菱形兜底
const FALLBACK = {
  points: [[50, 20], [80, 50], [50, 80], [20, 50]],
  edges: [[0, 1], [1, 2], [2, 3], [3, 0]]
}

Component({
  properties: {
    sign: { type: String, value: '' }, // 英文名 nameEn（不区分大小写）或中文名
    tone: { type: String, value: 'gold' } // gold=主题金（默认） / dim=暗蓝灰（星轨仪非选中态）
  },
  data: {
    points: [],
    edges: []
  },
  observers: {
    sign(sign) {
      this.render(sign)
    }
  },
  lifetimes: {
    attached() {
      this.render(this.data.sign)
    }
  },
  methods: {
    render(sign) {
      const data = constellationOf(sign) || FALLBACK
      // 星点：百分比定位（居中修正交给 WXSS transform）
      const points = data.points.map((p) => `left:${p[0]}%;top:${p[1]}%;`)
      // 连线：由两端点算出位置 / 长度 / 角度 → 旋转细条
      const edges = data.edges.map(([a, b]) => {
        const [x1, y1] = data.points[a]
        const [x2, y2] = data.points[b]
        const dx = x2 - x1
        const dy = y2 - y1
        const len = Math.sqrt(dx * dx + dy * dy)
        const angle = (Math.atan2(dy, dx) * 180) / Math.PI
        return `left:${x1}%;top:${y1}%;width:${len.toFixed(2)}%;transform:rotate(${angle.toFixed(2)}deg)`
      })
      this.setData({ points, edges })
    }
  }
})
