// 塔罗牌面组件
// 已有 RWS 牌图（公有领域, 1909 原版扫描, WebP 500x850）登记表：
// key = `${arcanaGroup}-${cardNumber}`（宫廷牌 Page=11 Knight=12 Queen=13 King=14）
// 未登记的 75 张保持纯样式牌面；全量 78 张时规划分包加载
const CARD_IMAGES = {
  'MAJOR-0': '/images/tarot/fool-0.webp',            // 愚者 The Fool
  'WANDS-10': '/images/tarot/ten-of-wands.webp',     // 权杖十 Ten of Wands
  'PENTACLES-13': '/images/tarot/queen-of-pentacles.webp' // 星币皇后 Queen of Pentacles
}

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
    imgSrc: '',
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
        sealText: isMajor ? this.toRoman(card.cardNumber) : (SUIT_CHAR[card.arcanaGroup] || '✦'),
        imgSrc: CARD_IMAGES[`${card.arcanaGroup}-${card.cardNumber}`] || ''
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
