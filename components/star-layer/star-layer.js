// 星点层：组件外生成一次——位置 / 大小 / 闪烁周期全部随机
Component({
  data: {
    stars: []
  },
  lifetimes: {
    attached() {
      const stars = Array.from({ length: 42 }, () => {
        const size = (Math.random() * 2.6 + 1.2).toFixed(1) // 1.2 ~ 3.8 px
        const duration = (Math.random() * 2.4 + 1.8).toFixed(2) // 1.8s ~ 4.2s
        const delay = (Math.random() * 4).toFixed(2)
        return (
          `left:${(Math.random() * 100).toFixed(2)}%;` +
          `top:${(Math.random() * 100).toFixed(2)}%;` +
          `width:${size}px;height:${size}px;` +
          `animation-duration:${duration}s;animation-delay:-${delay}s;`
        )
      })
      this.setData({ stars })
    }
  }
})
