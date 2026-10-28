// 星点层：组件外生成一次——位置 / 大小 / 闪烁周期全部随机
Component({
  properties: {
    // 外部手动暂停（页面也可直接传 true 冻住星空）；默认跟随页面显隐自动暂停，见 pageLifetimes
    paused: { type: Boolean, value: false }
  },
  data: {
    stars: [],
    pageHidden: false // 页面切走（onHide）→ 42 个 CSS 无限动画一起暂停，onShow 恢复
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
  },
  // 页面级生命周期：Tab 页切走时 42 个 twinkle 无限动画仍在跑，白耗 CPU/GPU；
  // 这里统一按页面显隐暂停/恢复，页面侧不用写任何一行样板代码。
  pageLifetimes: {
    hide() {
      if (!this.data.pageHidden) this.setData({ pageHidden: true })
    },
    show() {
      if (this.data.pageHidden) this.setData({ pageHidden: false })
    }
  }
})
