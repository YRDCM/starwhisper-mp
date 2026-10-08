// 六爻卦形组件
Component({
  properties: {
    lines: { type: String, value: '' }, // 6 位字符串，自下而上：'1'=阳 '0'=阴
    size: { type: String, value: 'md' } // sm / md / lg
  },
  data: {
    displayLines: []
  },
  observers: {
    lines(lines) {
      this.render(lines)
    }
  },
  lifetimes: {
    attached() {
      this.render(this.data.lines)
    }
  },
  methods: {
    render(lines) {
      // 显示顺序：最上一爻在视觉顶部 → 把自下而上的输入倒序
      this.setData({ displayLines: String(lines || '').split('').reverse() })
    }
  }
})
