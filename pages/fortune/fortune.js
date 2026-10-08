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

// 星盘几何（rpx）：轮盘直径 726，节点圆 150，节点轨道半径 288
const WHEEL_RADIUS = 288

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
    ticks: [],            // 60 格刻度样式
    centerStyle: '',      // 中心文字反向旋转
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
      // 刻度 bezel：60 格，每 5 格（30°）为长刻度
      ticks: Array.from({ length: 60 }, (_, k) => {
        const long = k % 5 === 0
        return `transform:rotate(${k * 6}deg) translateY(-350rpx);height:${long ? 22 : 12}rpx;` +
          `background:${long ? 'rgba(232,196,124,0.55)' : 'rgba(139,135,176,0.35)'};`
      }),
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
          wx.hideLoading()
          this.setData({ posterDrawing: false })
          wx.showToast({ title: '海报画布初始化失败', icon: 'none' })
          return
        }
        const canvas = res[0].node
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
          fail: () => {
            wx.hideLoading()
            this.setData({ posterDrawing: false })
            wx.showToast({ title: '海报生成失败', icon: 'none' })
          }
        })
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

    // ===== 垂直配重（750×1200 逻辑像素） =====
    // 参考区间：头部词标 60-180；主体均分；点评后留 ~120；落款钉底 1080-1160
    const Y = {
      EYEBROW: 100,          // 眉题
      WORDMARK: 172,         // 词标
      DIVIDER: 232,          // ✦ 饰线
      NAME: 335,             // 星座名
      META: 385,             // nameEn · dateRange · 日期
      DIMS_START: 472,       // 评分区首行
      DIMS_STEP: 52,         // 评分行距
      FOOTER_LINE: 1080,     // 落款分隔线（钉底）
      FOOTER_NAME: 1132,     // 落款名
      FOOTER_SUB: 1162       // 落款副题
    }

    // 词标
    ctx.textAlign = 'center'
    ctx.fillStyle = DIM
    ctx.font = '22px monospace'
    ctx.fillText('EPHEMERIS · 星历', W / 2, Y.EYEBROW)
    ctx.fillStyle = GOLD
    ctx.font = '64px serif'
    ctx.fillText('星语', W / 2 - 30, Y.WORDMARK)
    ctx.font = 'italic 34px serif'
    ctx.fillStyle = DIM
    ctx.fillText('StarWhisper', W / 2 + 110, Y.WORDMARK)

    // ✦ 饰线
    ctx.strokeStyle = 'rgba(139,135,176,0.25)'
    ctx.lineWidth = 1
    ctx.beginPath(); ctx.moveTo(80, Y.DIVIDER); ctx.lineTo(330, Y.DIVIDER); ctx.stroke()
    ctx.beginPath(); ctx.moveTo(420, Y.DIVIDER); ctx.lineTo(670, Y.DIVIDER); ctx.stroke()
    ctx.fillStyle = GOLD
    ctx.font = '20px sans-serif'
    ctx.fillText('✦', W / 2, Y.DIVIDER + 8)

    // 星座名 + dateRange
    ctx.fillStyle = GOLD
    ctx.font = '72px serif'
    ctx.fillText(f.signName, W / 2, Y.NAME)
    ctx.fillStyle = DIM
    ctx.font = '24px monospace'
    const range = this.data.currentSign ? (this.data.currentSign.dateRange || '') : ''
    ctx.fillText(`${String(f.signNameEn).toUpperCase()} · ${range} · ${f.fortuneDate}`, W / 2, Y.META)

    // 评分 ✦（综合/爱情/事业/财富/健康，null 自动跳过）
    const dims = (v.dimensions || [])
    ctx.textAlign = 'left'
    dims.forEach((d, i) => {
      const y = Y.DIMS_START + i * Y.DIMS_STEP
      ctx.fillStyle = INK
      ctx.font = '26px sans-serif'
      ctx.fillText(d.zh, 90, y)
      ctx.fillStyle = DIM
      ctx.font = '20px monospace'
      ctx.fillText(d.en, 250, y)
      // ✦ 实/空
      let gx = 480
      for (let n = 1; n <= 5; n++) {
        ctx.fillStyle = n <= d.score ? GOLD : 'rgba(139,135,176,0.35)'
        ctx.font = '24px sans-serif'
        ctx.fillText('✦', gx, y)
        gx += 36
      }
    })

    // 幸运条目（单行合并，标签与值同排，节省纵向空间）
    const ly = Y.DIMS_START + dims.length * Y.DIMS_STEP + 46
    ctx.fillStyle = DIM
    ctx.font = '20px monospace'
    ctx.fillText('LUCKY', 90, ly)
    ctx.fillStyle = INK
    ctx.font = '26px sans-serif'
    const luckyParts = [`幸运色 ${f.luckyColor}`, `数字 ${f.luckyNumber}`, `吉时 ${f.luckyTime}`]
    if (f.luckyDirection) luckyParts.push(`方位 ${f.luckyDirection}`)
    ctx.fillText(luckyParts.join('  ·  '), 210, ly)

    // 宜 / 忌
    ctx.fillStyle = JADE
    ctx.font = '28px sans-serif'
    ctx.fillText(`宜  ${f.doText}`, 90, ly + 64)
    ctx.fillStyle = CINNABAR
    ctx.fillText(`忌  ${f.dontText}`, 90, ly + 108)

    // summary 自动换行（避头尾 + 最多 3 行截断），结束点距落款线 ~120
    ctx.fillStyle = INK
    ctx.font = '28px sans-serif'
    this.wrapText(ctx, f.summary || '', 90, ly + 178, W - 180, 44, 3)

    // 底部 branding（钉底 1080-1160）
    ctx.textAlign = 'center'
    ctx.strokeStyle = 'rgba(139,135,176,0.2)'
    ctx.beginPath(); ctx.moveTo(90, Y.FOOTER_LINE); ctx.lineTo(660, Y.FOOTER_LINE); ctx.stroke()
    ctx.fillStyle = GOLD
    ctx.font = '26px serif'
    ctx.fillText('星语 StarWhisper', W / 2, Y.FOOTER_NAME)
    ctx.fillStyle = DIM
    ctx.font = '20px monospace'
    ctx.fillText('星辰低语 · 今日运势', W / 2, Y.FOOTER_SUB)
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
    // 中心文字反向旋转保持直立
    this.setData({ centerStyle: `transform:rotate(${-angle}deg)` })
  },

  // 节点内容直立：WXML 内联 transform:rotate({{-ringAngle}}deg) 直接实现

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
