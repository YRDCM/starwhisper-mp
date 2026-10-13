// 塔罗牌面组件
// 牌图已全部改为服务器托管（{BASE_URL}/tarot/tarot-{no}.webp，no=1-78），
// 由塔罗页详情弹层按 no 拼 URL（pages/tarot/tarot.js cardImgUrl）；
// 本组件只渲染纯样式牌面/牌背，不再持有任何本地牌图表

Component({
  properties: {
    card: { type: Object, value: null },        // TarotCardVO
    orientation: { type: String, value: '' },   // 'upright' | 'reversed' | ''
    faceDown: { type: Boolean, value: false },  // 牌背
    size: { type: String, value: 'md' }         // lg / md / sm
  },
  data: {
    isMajor: false,
    sealText: '✦',
    // 牌背散点星（固定坐标，避免每次渲染闪烁）
    backDots: [
      'left:14%;top:13%', 'left:82%;top:10%', 'left:22%;top:37%', 'left:77%;top:35%',
      'left:16%;top:65%', 'left:85%;top:68%', 'left:34%;top:83%', 'left:68%;top:86%',
      'left:50%;top:18%', 'left:11%;top:50%', 'left:88%;top:52%', 'left:50%;top:82%'
    ]
  },
  observers: {
    card(card) {
      if (!card) return
      const isMajor = card.arcanaGroup === 'MAJOR'
      const SUIT_CHAR = { WANDS: '权', CUPS: '杯', SWORDS: '剑', PENTACLES: '币' }
      this.setData({
        isMajor,
        sealText: isMajor ? this.toRoman(card.cardNumber) : (SUIT_CHAR[card.arcanaGroup] || '✦')
      })
    }
  },
  methods: {
    // 0-21 → 罗马数字（0 愚人保留 "0"）
    toRoman(n) {
      if (n === 0) return '0'
      const table = [[10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']]
      let out = ''
      let rest = n
      for (const [v, s] of table) {
        while (rest >= v) { out += s; rest -= v }
      }
      return out
    }
  }
})
