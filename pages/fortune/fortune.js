// 星运页：星盘选择器 + 运势卡（FortuneVO v2 全字段）+ 雷达图 + 趋势图
const {
  fetchSigns, fetchTodayFortune, fetchWeekFortune
} = require('../../utils/request')
const { profileOf } = require('../../utils/signProfiles')
// echarts 官方 UMD 构建（小程序兼容），由 ec-canvas 组件通过属性注入使用
const echarts = require('../../components/ec-canvas/echarts.js')

// 图表等宽字体（小程序里用系统 monospace）
const MONO = 'monospace'

// 中文颜色名 → 色块值
const COLOR_MAP = {
  红色: '#C25E5E', 橙色: '#D08C4A', 黄色: '#E8C47C', 金色: '#E8C47C',
  绿色: '#7FBF9E', 青色: '#5FA8A8', 蓝色: '#6E8FC8', 紫色: '#9C8FD0',
  葡萄紫: '#7B5CA8', 粉色: '#D094B0', 淡粉色: '#E3B8C8', 白色: '#EDEDF2',
  奶白色: '#F0EBDD', 黑色: '#2A2C40', 银色: '#B9BDCF', 棕色: '#9A7256',
  灰色: '#8B87B0', 珊瑚橙: '#E08A63', 玫瑰红: '#C25E7A', 天蓝色: '#6EA8D8', 米色: '#D8CBA8'
}

// 星盘几何（rpx）：轮盘直径 750（满屏出血），节点圆 Ø138 排在半径 305 的轨道上，
// 相邻圆心弦距 2·305·sin15° ≈ 158，圆间净隙 ≈ 20rpx；节点外缘 374 ≤ 375 不出屏
const WHEEL_RADIUS = 305

Page({
  data: {
    echarts,              // 注入给 ec-canvas 的 echarts 模块（属性通道保留函数引用）
    signs: [],
    currentSignId: null,
    currentSign: null,
    fortune: null,
    week: [],
    loading: false,
    error: '',
    todayText: '',
    view: {},             // 由 fortune + 当前星座派生的展示数据（模板友好）
    // 星盘
    ringAngle: 0,
    animated: false,
    nodeStyles: [],       // 每个星座节点的定位 transform
    // 图表懒初始化容器（onInit 在 canvas 就绪后回调）
    radarEc: null,
    trendEc: null,
    // 分享海报
    posterImage: '',
    posterDrawing: false
  },

  onLoad() {
    // 今日日期：2026-09-24 · 星期四
    const d = new Date()
    const weekNames = ['日', '一', '二', '三', '四', '五', '六']
    const p = (n) => String(n).padStart(2, '0')
    this.setData({
      todayText: `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} · 星期${weekNames[d.getDay()]}`,
      radarEc: { onInit: (canvas, w, h, dpr) => this.initRadar(canvas, w, h, dpr) },
      trendEc: { onInit: (canvas, w, h, dpr) => this.initTrend(canvas, w, h, dpr) }
    })
    this.init()
  },

  // 下拉刷新：重新拉全部数据
  onPullDownRefresh() {
    this.init(true)
  },

  /* ===== 数据流 ===== */
  async init(fromPullDown) {
    this.setData({ error: '', loading: true })
    try {
      const signs = await fetchSigns()
      const todaySign = this.findTodaySign(signs)
      // 星盘节点定位样式：rotate(i*30-90) → 外推 → 反向转正
      const nodeStyles = signs.map((s, i) => {
        const a = i * 30 - 90
        return `transform:rotate(${a}deg) translate(${WHEEL_RADIUS}rpx) rotate(${-a}deg)`
      })
      this.setData({ signs, currentSignId: todaySign.id, currentSign: todaySign, nodeStyles })
      this.rotateRingTo(todaySign.id, true)
      await this.loadFortune(todaySign)
    } catch (e) {
      this.setData({ error: e.message || '无法连接星语服务器', loading: false })
    } finally {
      if (fromPullDown) wx.stopPullDownRefresh()
    }
  },

  retry() {
    this.init(false)
  },
  noop() {}, // 弹层内容区拦截冒泡
  closePoster() {
    this.setData({ posterImage: '' })
  },

  /* ===== 分享海报：离屏 canvas 绘制 750×1200 → 预览 → 保存相册 =====
     字体说明：小程序 canvas 不支持加载 Web 字体，统一用系统默认字体（sans），
     靠字重/字号/字色维持星历气质。 */
  onShareTap() {
    if (!this.data.fortune || this.data.posterDrawing) return
    this.setData({ posterDrawing: true })
    wx.showLoading({ title: '绘制海报中…', mask: true })
    const query = this.createSelectorQuery()
    query.select('#poster-canvas')
      .fields({ node: true, size: true })
      .exec((res) => {
        if (!res || !res[0] || !res[0].node) {
          // vConsole 排查线索：节点查询失败通常是 canvas 被 display:none / 未渲染
          console.error('[poster] canvas node query failed:', JSON.stringify(res))
          wx.hideLoading()
          this.setData({ posterDrawing: false })
          wx.showToast({ title: '海报画布初始化失败', icon: 'none' })
          return
        }
        const canvas = res[0].node
        try {
          const ctx = canvas.getContext('2d')
          // 逻辑尺寸 750×1200，按设备像素比放大保证清晰
          const dpr = wx.getWindowInfo ? wx.getWindowInfo().pixelRatio : 2
          canvas.width = 750 * dpr
          canvas.height = 1200 * dpr
          ctx.scale(dpr, dpr)
          this.paintPoster(ctx)
          // 绘制完成 → 导出临时图片 → 弹层预览
          wx.canvasToTempFilePath({
            canvas,
            success: (r) => {
              wx.hideLoading()
              this.setData({ posterImage: r.tempFilePath, posterDrawing: false })
            },
            fail: (err) => {
              // vConsole 排查线索：errMsg 会注明尺寸/内存/权限原因
              console.error('[poster] canvasToTempFilePath failed:', err && err.errMsg)
              wx.hideLoading()
              this.setData({ posterDrawing: false })
              wx.showToast({ title: '海报生成失败', icon: 'none' })
            }
          })
        } catch (e) {
          // 绘制过程同步异常（canvas 上下文/字段缺失等）：必须复位 loading 与按钮态
          console.error('[poster] paint threw:', e && (e.stack || e.message || e))
          wx.hideLoading()
          this.setData({ posterDrawing: false })
          wx.showToast({ title: '海报生成失败', icon: 'none' })
        }
      })
  },

  // 海报绘制（750×1200 逻辑像素）
  paintPoster(ctx) {
    const f = this.data.fortune
    const v = this.data.view
    const W = 750
    const GOLD = '#E8C47C'
    const INK = '#E8E6F0'
    const DIM = '#A9A4CC'
    const JADE = '#7FBF9E'
    const CINNABAR = '#C25E5E'

    // 深空渐变底
    const bg = ctx.createLinearGradient(0, 0, 0, 1200)
    bg.addColorStop(0, '#070B1E')
    bg.addColorStop(0.5, '#10163A')
    bg.addColorStop(1, '#232048')
    ctx.fillStyle = bg
    ctx.fillRect(0, 0, W, 1200)

    // 随机星点
    for (let i = 0; i < 90; i++) {
      ctx.fillStyle = `rgba(255,244,214,${(0.15 + Math.random() * 0.4).toFixed(2)})`
      ctx.beginPath()
      ctx.arc(Math.random() * W, Math.random() * 1200, Math.random() * 2 + 0.6, 0, Math.PI * 2)
      ctx.fill()
    }

    // ===== 流式布局：y 游标自顶向下推进，任何长文案都不会越界/重叠 =====
    const MARGIN = 90
    const RIGHT = W - MARGIN
    let y = 100

    // 眉题
    ctx.textAlign = 'center'
    ctx.fillStyle = DIM
    ctx.font = '22px monospace'
    ctx.fillText('EPHEMERIS · 星历', W / 2, y)

    // 词标：中英分两行（单行并排会在 750 宽内重叠）
    y += 72
    ctx.fillStyle = GOLD
    ctx.font = '64px serif'
    ctx.fillText('星语', W / 2, y)
    y += 46
    ctx.fillStyle = DIM
    ctx.font = 'italic 30px serif'
    ctx.fillText('StarWhisper', W / 2, y)

    // ✦ 饰线
    y += 46
    ctx.strokeStyle = 'rgba(139,135,176,0.25)'
    ctx.lineWidth = 1
    ctx.beginPath(); ctx.moveTo(80, y); ctx.lineTo(330, y); ctx.stroke()
    ctx.beginPath(); ctx.moveTo(420, y); ctx.lineTo(670, y); ctx.stroke()
    ctx.fillStyle = GOLD
    ctx.font = '20px sans-serif'
    ctx.fillText('✦', W / 2, y + 8)

    // 星座名 + dateRange
    y += 88
    ctx.fillStyle = GOLD
    ctx.font = '72px serif'
    ctx.fillText(f.signName, W / 2, y)
    y += 50
    ctx.fillStyle = DIM
    ctx.font = '24px monospace'
    const range = this.data.currentSign ? (this.data.currentSign.dateRange || '') : ''
    ctx.fillText(`${String(f.signNameEn).toUpperCase()} · ${range} · ${f.fortuneDate}`, W / 2, y)

    // 评分 ✦（综合/爱情/事业/财富/健康，null 自动跳过）
    const dims = (v.dimensions || [])
    y += 82
    ctx.textAlign = 'left'
    dims.forEach((d, i) => {
      const dy = y + i * 52
      ctx.fillStyle = INK
      ctx.font = '26px sans-serif'
      ctx.fillText(d.zh, MARGIN, dy)
      ctx.fillStyle = DIM
      ctx.font = '20px monospace'
      ctx.fillText(d.en, 250, dy)
      // ✦ 实/空
      let gx = 480
      for (let n = 1; n <= 5; n++) {
        ctx.fillStyle = n <= d.score ? GOLD : 'rgba(139,135,176,0.35)'
        ctx.font = '24px sans-serif'
        ctx.fillText('✦', gx, dy)
        gx += 36
      }
    })
    y += dims.length * 52

    // 幸运条目：流式布局，超宽自动换行（最多 2 行），避免吉时/方位被裁出画布
    const luckyItems = [
      { label: '幸运色', value: String(f.luckyColor || '') },
      { label: '数字', value: String(f.luckyNumber != null ? f.luckyNumber : '') },
      { label: '吉时', value: String(f.luckyTime || '') }
    ]
    if (f.luckyDirection) luckyItems.push({ label: '方位', value: String(f.luckyDirection) })
    y += 46
    ctx.textAlign = 'left'
    y = this.flowLucky(ctx, luckyItems.filter((it) => it.value), MARGIN, y, RIGHT)

    // 宜 / 忌
    y += 52
    ctx.fillStyle = JADE
    ctx.font = '28px sans-serif'
    ctx.fillText(`宜  ${f.doText}`, MARGIN, y)
    y += 44
    ctx.fillStyle = CINNABAR
    ctx.fillText(`忌  ${f.dontText}`, MARGIN, y)

    // summary 自动换行（避头尾），按剩余空间动态给 1-3 行，不压到底部落款
    y += 52
    const maxLines = Math.max(1, Math.min(3, Math.floor((1028 - y) / 44)))
    ctx.fillStyle = INK
    ctx.font = '28px sans-serif'
    this.wrapText(ctx, f.summary || '', MARGIN, y, W - MARGIN * 2, 44, maxLines)

    // ===== 底部 branding（钉底）：饰线 + 左侧落款 + 右侧小程序码占位（分享裂变预留） =====
    const fy = 1056
    ctx.strokeStyle = 'rgba(139,135,176,0.2)'
    ctx.beginPath(); ctx.moveTo(MARGIN, fy); ctx.lineTo(RIGHT, fy); ctx.stroke()
    ctx.textAlign = 'left'
    ctx.fillStyle = GOLD
    ctx.font = '26px serif'
    ctx.fillText('星语 StarWhisper', MARGIN, fy + 56)
    ctx.fillStyle = DIM
    ctx.font = '20px monospace'
    ctx.fillText('星辰低语 · 今日运势', MARGIN, fy + 88)
    // 小程序码占位框（84×84，码图位预留）
    const QS = 84
    const qx = RIGHT - QS
    const qy = fy + 16
    ctx.strokeStyle = 'rgba(232,196,124,0.55)'
    ctx.lineWidth = 1
    ctx.strokeRect(qx, qy, QS, QS)
    ctx.textAlign = 'center'
    ctx.fillStyle = GOLD
    ctx.font = '24px sans-serif'
    ctx.fillText('✦', qx + QS / 2, qy + 36)
    ctx.fillStyle = DIM
    ctx.font = '14px sans-serif'
    ctx.fillText('小程序码', qx + QS / 2, qy + 62)
    ctx.font = '15px sans-serif'
    ctx.fillText('长按识别小程序', qx + QS / 2, qy + QS + 26)
  },

  // 幸运条目流式排版：「标签 值 · 标签 值 …」，超出右界自动换行（最多 2 行），
  // 返回末行基线 y。换行后行首不画分隔点。
  flowLucky(ctx, items, x, y, right) {
    const INK = '#E8E6F0' // 与 paintPoster 同值（本方法独立作用域，须自带色值）
    const DIM = '#A9A4CC'
    const LINE_STEP = 44
    const MAX_LINES = 2
    let cx = x
    let cy = y
    let lines = 1
    for (const it of items) {
      ctx.font = '22px sans-serif'
      const lw = ctx.measureText(it.label).width
      ctx.font = '26px sans-serif'
      const vw = ctx.measureText(it.value).width
      const sepW = ctx.measureText('·').width + 24 // 圆点 + 两侧空隙
      const itemW = lw + 8 + vw
      if (cx > x && cx + sepW + itemW > right) {
        if (lines >= MAX_LINES) break // 放不下就舍弃，绝不出界
        cx = x
        cy += LINE_STEP
        lines++
      }
      if (cx > x) {
        ctx.fillStyle = DIM
        ctx.font = '26px sans-serif'
        ctx.fillText('·', cx + 12, cy)
        cx += sepW
      }
      ctx.fillStyle = DIM
      ctx.font = '22px sans-serif'
      ctx.fillText(it.label, cx, cy)
      cx += lw + 8
      ctx.fillStyle = INK
      ctx.font = '26px sans-serif'
      ctx.fillText(it.value, cx, cy)
      cx += vw
    }
    return cy
  },

  // 自动换行（避头尾版）：
  // - 行首不得是标点（，。、；：！？）》」』”’"%…）——换行点落在标点前就把标点收回上一行，允许轻微溢出）
  // - 行尾不得是开括号（「『（《“‘）——开括号挪到下一行
  // - 超出 maxLines 时末行加 … 截断
  wrapText(ctx, text, x, y, maxWidth, lineHeight, maxLines = 3) {
    const NO_LINE_START = '，。、；：！？）》」』”’"%…）'
    const NO_LINE_END = '「『（《“‘'
    let line = ''
    let yy = y
    let lines = 0
    const emit = (t) => {
      ctx.fillText(t, x, yy)
      yy += lineHeight
      lines++
    }
    for (const ch of String(text)) {
      if (ch === '\n') {
        if (lines >= maxLines) return
        emit(line)
        line = ''
        continue
      }
      if (line && ctx.measureText(line + ch).width > maxWidth) {
        if (lines >= maxLines - 1) {
          emit(line + '…') // 末行截断
          return
        }
        if (NO_LINE_START.includes(ch)) {
          emit(line + ch)
          line = ''
        } else if (NO_LINE_END.includes(line.slice(-1))) {
          const last = line.slice(-1)
          emit(line.slice(0, -1))
          line = last + ch
        } else {
          emit(line)
          line = ch
        }
      } else {
        line += ch
      }
    }
    if (line && lines < maxLines) emit(line)
  },

  // 保存到相册（处理授权拒绝）
  savePoster() {
    wx.saveImageToPhotosAlbum({
      filePath: this.data.posterImage,
      success: () => wx.showToast({ title: '已保存到相册', icon: 'none' }),
      fail: (err) => {
        // 用户拒绝过相册授权 → 引导去设置页开启
        if (err && err.errMsg && err.errMsg.includes('auth')) {
          wx.showModal({
            title: '需要相册权限',
            content: '请在设置中允许保存图片到相册',
            confirmText: '去设置',
            success: (r) => { if (r.confirm) wx.openSetting() }
          })
        } else {
          wx.showToast({ title: '保存已取消', icon: 'none' })
        }
      }
    })
  },

  // 转发给好友/群：标题带星座与星级，附海报图（若已生成）
  onShareAppMessage() {
    const f = this.data.fortune || {}
    const score = Math.max(0, Math.min(5, Number(f.overallScore) || 0))
    const stars = '★'.repeat(score) + '☆'.repeat(5 - score)
    return {
      title: `${f.signName || '星语'}今日运势${stars} 速看`,
      path: '/pages/fortune/fortune',
      imageUrl: this.data.posterImage || undefined
    }
  },

  // 分享到朋友圈
  onShareTimeline() {
    const f = this.data.fortune || {}
    const score = Math.max(0, Math.min(5, Number(f.overallScore) || 0))
    const stars = '★'.repeat(score) + '☆'.repeat(5 - score)
    return {
      title: `${f.signName || '星语'}今日运势${stars}`,
      query: ''
    }
  },

  // 并行拉今日运势 + 近 7 天（切换星座时保留旧数据，仅置 refreshing 态）
  async loadFortune(sign) {
    this.setData({ loading: true, error: '' })
    try {
      const [today, week] = await Promise.all([
        fetchTodayFortune(sign.nameEn),
        fetchWeekFortune(sign.nameEn)
      ])
      this.setData({ fortune: today, week, loading: false })
      this.buildView()
      this.updateCharts()
    } catch (e) {
      this.setData({
        error: e.message || '无法连接星语服务器，请稍后再试',
        fortune: null,
        week: [],
        loading: false
      })
    }
  },

  onSignTap(e) {
    const id = e.currentTarget.dataset.id
    if (id === this.data.currentSignId) return
    const sign = this.data.signs.find((s) => s.id === id)
    this.setData({ currentSignId: id, currentSign: sign || null })
    this.rotateRingTo(id, false)
    if (sign) this.loadFortune(sign)
  },

  /* ===== 星盘旋转：把选中星座转到正上方（最短路径） ===== */
  rotateRingTo(id, instant) {
    const idx = this.data.signs.findIndex((s) => s.id === id)
    if (idx < 0) return
    const target = -30 * idx
    let angle
    if (instant || !this.data.animated) {
      angle = target
      this.setData({ animated: true, ringAngle: angle })
    } else {
      const cur = this.data.ringAngle
      const delta = ((((target - cur) % 360) + 540) % 360) - 180
      angle = cur + delta
      this.setData({ ringAngle: angle })
    }
    // 节点内符号的直立由 WXML 内联 counter-rotate 实现，中心信息在环外不随转
  },

  /* ===== 星座区间判断（摩羯跨年边界） ===== */
  inRange(sign, month, day) {
    const { startMonth: sm, startDay: sd, endMonth: em, endDay: ed } = sign
    if (sm > em) return (month === sm && day >= sd) || (month === em && day <= ed)
    return (month === sm && day >= sd) || (month === em && day <= ed)
  },
  findTodaySign(list) {
    const now = new Date()
    return list.find((s) => this.inRange(s, now.getMonth() + 1, now.getDate())) || list[0]
  },

  /* ===== 展示数据派生（FortuneVO v2） ===== */
  buildView() {
    const f = this.data.fortune
    const sign = this.data.signs.find((s) => s.id === this.data.currentSignId)
    if (!f) return
    const isShowapi = f.source === 'SHOWAPI'
    const dims = [
      { zh: '综合运势', en: 'OVERALL', score: f.overallScore },
      { zh: '爱情运势', en: 'LOVE', score: f.loveScore },
      { zh: '事业学业', en: 'CAREER', score: f.careerScore },
      { zh: '财富运势', en: 'WEALTH', score: f.wealthScore },
      { zh: '健康运势', en: 'HEALTH', score: f.healthScore }
    ].filter((d) => d.score != null) // SHOWAPI 无健康分 → 隐藏该行
    const range = sign ? (sign.dateRange || '').replace('-', '–') : ''
    this.setData({
      view: {
        isShowapi,
        dimensions: dims,
        metaParts: [String(f.signNameEn || '').toUpperCase(), range, f.fortuneDate].filter(Boolean),
        luckyColorBg: COLOR_MAP[f.luckyColor] || '#8B87B0',
        pairLabel: isShowapi ? '贵人' : '速配', // SHOWAPI 语义为贵人
        insights: [
          { zh: '爱情', en: 'LOVE', txt: f.loveTxt },
          { zh: '事业', en: 'CAREER', txt: f.workTxt },
          { zh: '财运', en: 'WEALTH', txt: f.moneyTxt }
        ].filter((i) => i.txt),
        sourceTag: isShowapi ? 'DATA · 万维易源 SHOWAPI' : 'DATA · 本地星算 LOCAL',
        // 星座档案
        profile: profileOf(sign ? sign.nameEn : ''),
        element: sign ? sign.element : ''
      }
    })
  },

  /* ===== echarts（ec-canvas 懒初始化） ===== */
  initRadar(canvas, w, h, dpr) {
    if (this._radarChart) return this._radarChart
    const chart = echarts.init(canvas, null, { width: w, height: h, devicePixelRatio: dpr })
    if (this.data.fortune) chart.setOption(this.buildRadarOption(), true)
    this._radarChart = chart
    return chart
  },
  initTrend(canvas, w, h, dpr) {
    if (this._trendChart) return this._trendChart
    const chart = echarts.init(canvas, null, { width: w, height: h, devicePixelRatio: dpr })
    if (this.data.week.length) chart.setOption(this.buildTrendOption(), true)
    this._trendChart = chart
    return chart
  },
  updateCharts() {
    if (this._radarChart && this.data.fortune) {
      this._radarChart.setOption(this.buildRadarOption(), true) // notMerge：四象/五维切换时整体替换
    }
    if (this._trendChart && this.data.week.length) {
      this._trendChart.setOption(this.buildTrendOption(), true)
    }
  },

  // 雷达图：香槟金主线；healthScore 为 null → 四象
  buildRadarOption() {
    const dims = this.data.view.dimensions || []
    return {
      textStyle: { fontFamily: MONO },
      radar: {
        indicator: dims.map((d) => ({ name: d.zh.slice(0, 2), max: 5 })),
        radius: '66%',
        axisName: { color: '#A9A4CC', fontSize: 13, fontFamily: MONO },
        splitLine: { lineStyle: { color: 'rgba(139, 135, 176, 0.15)' } },
        splitArea: { areaStyle: { color: ['rgba(35, 32, 72, 0.15)', 'rgba(139, 135, 176, 0.04)'] } },
        axisLine: { lineStyle: { color: 'rgba(139, 135, 176, 0.15)' } }
      },
      series: [{
        type: 'radar',
        data: [{
          value: dims.map((d) => d.score),
          name: '今日评分',
          areaStyle: { color: 'rgba(232, 196, 124, 0.16)' },
          lineStyle: { color: '#E8C47C', width: 1.5 },
          itemStyle: { color: '#E8C47C' },
          symbolSize: 4
        }]
      }]
    }
  },

  // 趋势图：近 7 天，默认综合线，图例可切换
  buildTrendOption() {
    const DIMS = [
      { key: 'overallScore', name: '综合', color: '#E8C47C' },
      { key: 'loveScore', name: '爱情', color: '#C25E5E' },
      { key: 'careerScore', name: '事业', color: '#7FBF9E' },
      { key: 'wealthScore', name: '财运', color: '#9C8FD0' },
      { key: 'healthScore', name: '健康', color: '#7FA8BF' }
    ]
    const dates = this.data.week.map((d) => (d.fortuneDate || '').slice(5))
    return {
      textStyle: { fontFamily: MONO },
      tooltip: {
        trigger: 'axis',
        // 小程序无 DOM，tooltip 必须用画布内渲染，否则触摸时 document 调用会崩
        renderMode: 'richText',
        backgroundColor: 'rgba(35, 32, 72, 0.95)',
        borderColor: 'rgba(232, 196, 124, 0.25)',
        textStyle: { color: '#E8E6F0', fontFamily: MONO, fontSize: 12.5 }
      },
      legend: {
        data: DIMS.map((d) => d.name),
        selected: { 综合: true, 爱情: false, 事业: false, 财运: false, 健康: false },
        textStyle: { color: '#A9A4CC', fontFamily: MONO, fontSize: 13 },
        inactiveColor: 'rgba(139, 135, 176, 0.3)',
        itemWidth: 16, itemHeight: 1, icon: 'rect', top: 0
      },
      grid: { left: 36, right: 18, top: 44, bottom: 30 },
      xAxis: {
        type: 'category', data: dates,
        axisLine: { lineStyle: { color: 'rgba(139, 135, 176, 0.15)' } },
        axisTick: { show: false },
        axisLabel: { color: '#A9A4CC', fontFamily: MONO, fontSize: 12 }
      },
      yAxis: {
        type: 'value', min: 0, max: 5, interval: 1,
        splitLine: { lineStyle: { color: 'rgba(139, 135, 176, 0.15)' } },
        axisLabel: { color: '#A9A4CC', fontFamily: MONO, fontSize: 12 }
      },
      series: DIMS.map((d) => ({
        name: d.name, type: 'line', smooth: true, symbol: 'circle', symbolSize: 5,
        // 健康分在 SHOWAPI 日可能为 null → 用 '-' 断点
        data: this.data.week.map((w) => (w[d.key] == null ? '-' : w[d.key])),
        lineStyle: { color: d.color, width: 1.5 },
        itemStyle: { color: d.color },
        areaStyle: d.key === 'overallScore' ? {
          color: {
            type: 'linear', x: 0, y: 0, x2: 0, y2: 1,
            colorStops: [
              { offset: 0, color: 'rgba(232, 196, 124, 0.22)' },
              { offset: 1, color: 'rgba(232, 196, 124, 0)' }
            ]
          }
        } : undefined
      }))
    }
  }
})
