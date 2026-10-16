const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const path = require('node:path')

function makePage(api = {}, storage = {}) {
  let page
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../pages/tarot/tarot.js'), 'utf8'), {
    Page: (value) => { page = value },
    require: (name) => name.endsWith('/config') ? {} : api,
    wx: { getStorageSync: key => key.includes('daily-moods') ? storage.moods : key.includes('tarot-session') ? storage.session : storage.value, removeStorageSync: () => { delete storage.session }, setStorageSync: (key, value) => {
      if (storage.fail) throw new Error('storage full')
      if (key.includes('daily-moods')) storage.moods = JSON.parse(JSON.stringify(value)); else if (key.includes('tarot-session')) storage.session = JSON.parse(JSON.stringify(value)); else storage.value = value
    } }
  })
  page.setData = (patch) => Object.assign(page.data, patch)
  return page
}

test('AI 阻止未揭晓和重复请求，切换牌阵后忽略旧响应', async () => {
  let resolveReading, calls = 0
  const page = makePage({
    drawTarot: async () => ({ drawId: 'a', cards: [{ card: { id: 1 } }, { card: { id: 2 } }] }),
    fetchTarotReading: () => { calls++; return new Promise(resolve => { resolveReading = resolve }) }
  })
  await page.doDraw(); await page.readWithAi()
  assert.equal(calls, 0)
  page.revealAll(); page.selectDetailIndex(1)
  assert.equal(page.data.detailCards.length, 1)
  assert.equal(page.data.detailCards[0].card.id, 2)
  page.selectDetailIndex(99)
  assert.equal(page.data.detailIndex, 1)
  const pending = page.readWithAi()
  await page.readWithAi()
  assert.equal(calls, 1)
  page.setMode({ currentTarget: { dataset: { mode: 'three' } } })
  resolveReading({ summary: '旧总览', detail: '旧详情' })
  await pending
  assert.equal(page.data.aiResult, null)
  assert.equal(page.data.aiLoading, false)
})

test('AI 失败保留牌面并可重试，成功后不重复请求', async () => {
  let calls = 0
  const page = makePage({
    drawTarot: async () => ({ drawId: 'a', cards: [{ card: { id: 1 } }] }),
    fetchTarotReading: async () => { if (++calls === 1) throw new Error('暂不可用'); return { summary: '总览', detail: '详情' } }
  })
  await page.doDraw(); page.revealAll(); await page.readWithAi()
  assert.equal(page.data.drawn.length, 1)
  assert.equal(page.data.aiError, '暂不可用')
  await page.readWithAi(); await page.readWithAi()
  assert.equal(calls, 2)
  assert.equal(page.data.aiResult.summary, '总览')
})

for (const [spread, count] of Object.entries({ single: 1, three: 3, choice: 3, love: 5, celtic: 10, hexagram: 7 })) {
  test(`${spread}：按序揭晓、全部揭晓和重新抽牌`, async () => {
    const cards = Array.from({ length: count }, (_, i) => ({ card: { id: i + 1 }, position: `位置${i + 1}`, keywords: '思考' }))
    const page = makePage({ drawTarot: async () => ({ spread, cards }) })
    await page.doDraw()
    assert.equal(page.data.revealedCards.length, 0)
    page.onRevealCard({ currentTarget: { dataset: { index: 1 } } })
    assert.equal(page.data.revealedCount, 0)
    page.onRevealCard({ currentTarget: { dataset: { index: 0 } } })
    assert.equal(page.data.revealedCards.length, 1)
    assert.equal(page.data.revealedCards[0].position, '位置1')
    page.revealAll()
    page.revealNext()
    assert.equal(page.data.revealedCount, count)
    assert.equal(page.data.nextCard, null)
    page.resetDraw()
    assert.equal(page.data.revealedCount, 0)
    assert.equal(page.data.revealedCards.length, 0)
  })
}

test('学习记录去重、保存失败可重试，未展开不能标记', () => {
  const storage = { value: [1, 1, 99, '2'] }
  const page = makePage({}, storage)
  page.data.daily = { card: { no: 23 } }
  page.markLearned()
  assert.equal(page.data.todayLearned, false)
  page.toggleLesson()
  storage.fail = true
  page.markLearned()
  assert.equal(page.data.todayLearned, false)
  assert.match(page.data.studyError, /未能保存/)
  storage.fail = false
  page.markLearned()
  page.markLearned()
  assert.deepEqual(Array.from(storage.value), [1, 23])
  assert.equal(page.data.studyError, '')
})

test('空抽牌结果保留选牌并提示错误', async () => {
  const page = makePage({ drawTarot: async () => ({ cards: [] }) })
  page.data.picking = true
  await page.doDraw([1])
  assert.equal(page.data.picking, true)
  assert.match(page.data.drawError, /完整牌面/)
})

test('抽牌使用查询参数传递牌阵和有序选牌', async () => {
  let sent
  const context = {
    module: { exports: {} },
    require: () => ({ BASE_URL: 'https://example.test' }),
    wx: {
      getStorageSync: () => '',
      request: (opts) => { sent = opts; opts.success({ statusCode: 200, data: { code: 200, data: {} } }) }
    }
  }
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../utils/request.js'), 'utf8'), context)
  await context.module.exports.drawTarot('three', [22, 1, 37])
  const url = new URL(sent.url)
  assert.equal(sent.method, 'POST')
  assert.equal(url.searchParams.get('spread'), 'three')
  assert.equal(url.searchParams.get('cardNos'), '22,1,37')
})

test('自选失败不会追加随机请求，保留选择且阻止重复提交', async () => {
  let page
  let rejectDraw
  let calls = 0
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../pages/tarot/tarot.js'), 'utf8'), {
    Page: (definition) => { page = definition },
    require: (name) => name.endsWith('/config') ? {} : {
      drawTarot: () => { calls++; return new Promise((resolve, reject) => { rejectDraw = reject }) }
    },
    clearTimeout, setTimeout
  })
  page.setData = (patch) => Object.assign(page.data, patch)
  page.data.picking = true
  page.data.deck = [{ no: 22, selected: true, order: 1 }]
  page.data.pickedCount = 1
  page.data.pickFull = true
  const pending = page.doDraw([22])
  await page.doDraw([22])
  rejectDraw(new Error('请求超时，请稍后重试'))
  await pending
  assert.equal(calls, 1)
  assert.equal(page.data.picking, true)
  assert.equal(page.data.pickedCount, 1)
  assert.equal(page.data.deck[0].no, 22)
  assert.equal(page.data.drawing, false)
  assert.match(page.data.drawError, /超时/)
})

for (const [spread,count] of Object.entries({single:1,three:3,choice:3,love:5,celtic:10,hexagram:7})) {
  test(`${spread} 恢复本地牌阵并点击已翻牌切换详情`, async () => {
    const storage = {}
    const cards = Array.from({length:count}, (_,i)=>({card:{id:i+1,name:'牌'+i},orientation:'upright',position:'位置'+i}))
    const first = makePage({drawTarot:async()=>({spread,cards,drawId:'draw'})},storage)
    await first.doDraw(); first.revealAll()
    first.data.aiQuestion='规划'; first.saveSnapshot()
    const restored=makePage({},storage); restored.restoreSnapshot()
    assert.equal(restored.data.drawn.length,count)
    assert.equal(restored.data.revealedCount,count)
    assert.equal(restored.data.aiQuestion,'规划')
    restored.onRevealCard({currentTarget:{dataset:{index:count-1}}})
    assert.equal(restored.data.detailIndex,count-1)
    assert.equal(restored.data.revealedCount,count)
    restored.resetDraw(); assert.equal(storage.session,undefined)
  })
}
test('过期本地牌阵保留 AI 解读，损坏缓存不会阻止使用',()=>{
  const storage={session:{version:1,spread:'single',createdAt:Date.now()-3*3600000,cards:[{card:{name:'愚人'},orientation:'upright'}],revealedCount:1,drawId:'expired',reading:{summary:'总览',detail:'详情'}}}
  const page=makePage({},storage); page.restoreSnapshot()
  assert.equal(page.data.drawId,''); assert.equal(page.data.aiResult.detail,'详情')
  storage.session={version:1,cards:[]}
  const broken=makePage({},storage); broken.restoreSnapshot()
  assert.equal(broken.data.drawn.length,0); assert.equal(storage.session,undefined)
})

test('每日心情：当天修改不重复，重新进入恢复，独立于牌阵和学习记录', () => {
  const storage = { value: [1, 2] }
  const page = makePage({}, storage)
  page.refreshMood()
  const select = mood => page.selectMood({ currentTarget: { dataset: { mood } } })
  select('平静'); select('期待')
  assert.equal(storage.moods.length, 1)
  assert.equal(page.data.todayMood, '期待')
  assert.deepEqual(storage.value, [1, 2])
  const reopened = makePage({}, storage)
  reopened.refreshMood()
  assert.equal(reopened.data.todayMood, '期待')
  select('无效心情')
  assert.equal(storage.moods.length, 1)
})

test('每日心情：写入失败不显示保存成功，重试可更新', () => {
  const storage = {}
  const page = makePage({}, storage)
  page.refreshMood()
  page.selectMood({ currentTarget: { dataset: { mood: '平静' } } })
  storage.fail = true
  page.selectMood({ currentTarget: { dataset: { mood: '疲惫' } } })
  assert.equal(page.data.todayMood, '平静')
  assert.match(page.data.moodError, /未保存/)
  storage.fail = false
  page.selectMood({ currentTarget: { dataset: { mood: '疲惫' } } })
  assert.equal(page.data.todayMood, '疲惫')
  assert.equal(page.data.moodError, '')
})

test('每日心情：跨天返回清除昨日选中态并刷新每日牌，保留历史', () => {
  const storage = { moods: [{ date: '2020-01-01', mood: '开心' }, { date: 'bad', mood: '开心' }] }
  const page = makePage({}, storage)
  let loads = 0
  page.loadDaily = () => { loads++ }
  page.data.todayStr = '2020-01-01'
  page.data.todayMood = '开心'
  page.onShow()
  assert.equal(page.data.todayMood, '')
  assert.equal(page.data.moodRecords.length, 1)
  assert.equal(loads, 1)
  page.onShow()
  assert.equal(loads, 1)
})

test('心情分数映射：6 档分值与未知心情', () => {
  const page = makePage({})
  assert.equal(page.moodScore('开心'), 5)
  assert.equal(page.moodScore('期待'), 4)
  assert.equal(page.moodScore('平静'), 3)
  assert.equal(page.moodScore('纠结'), 2)
  assert.equal(page.moodScore('疲惫'), 1.5) // 精力状态而非情绪谷底，不与低落并列
  assert.equal(page.moodScore('低落'), 1)
  assert.equal(page.moodScore('兴奋'), null)
  assert.equal(page.moodScore(''), null)
  assert.equal(page.moodScore(undefined), null)
})

test('心情曲线：非法项跳过、按日期升序、空/单条不产出曲线', () => {
  const page = makePage({})
  // 曲线/分布数组产自 vm 沙箱（Array 原型不同），统一 JSON 化后再比较
  const j = (v) => JSON.parse(JSON.stringify(v))
  assert.deepEqual(j(page.buildMoodCurve([])), [])
  assert.deepEqual(j(page.buildMoodCurve(null)), [])
  assert.deepEqual(j(page.buildMoodCurve([{ date: '2026-01-01', mood: '开心' }])).length, 1)
  const curve = j(page.buildMoodCurve([
    { date: '2026-01-03', mood: '低落' },
    { date: '2026-01-01', mood: '开心' },
    { date: 'bad', mood: '开心' },
    { date: '2026-01-02', mood: '无效心情' }
  ]))
  assert.deepEqual(curve.map((p) => p.day), ['01-01', '01-03'])
  assert.deepEqual(curve.map((p) => p.score), [5, 1])
  assert.deepEqual(curve.map((p) => p.mood), ['开心', '低落'])
})

test('心情分布：按分数降序、计数正确、pct 相对最多项、未出现的心情不列出', () => {
  const page = makePage({})
  const j = (v) => JSON.parse(JSON.stringify(v))
  assert.deepEqual(j(page.buildMoodDist(null)), [])
  assert.deepEqual(j(page.buildMoodDist([])), [])
  const dist = j(page.buildMoodDist([
    { date: '2026-01-01', mood: '开心' },
    { date: '2026-01-02', mood: '开心' },
    { date: '2026-01-03', mood: '低落' },
    { date: '2026-01-04', mood: '无效心情' }
  ]))
  assert.deepEqual(dist, [
    { mood: '开心', score: 5, count: 2, pct: 100 },
    { mood: '低落', score: 1, count: 1, pct: 50 }
  ])
})

test('心情记录驱动曲线/分布数据，图表 option 用 richText tooltip 且数据真实', () => {
  const storage = { moods: [
    { date: '2026-01-02', mood: '期待' },
    { date: '2026-01-01', mood: '平静' }
  ] }
  const page = makePage({}, storage)
  page.refreshMood()
  assert.equal(page.data.moodCurve.length, 2)
  assert.deepEqual(page.data.moodCurve.map((p) => p.date), ['2026-01-01', '2026-01-02'])
  assert.equal(page.data.moodDist.length, 2)
  // 单条记录时曲线长度 < 2（模板据此显示空态而不是画假图）
  const single = makePage({}, { moods: [{ date: '2026-01-01', mood: '开心' }] })
  single.refreshMood()
  assert.equal(single.data.moodCurve.length, 1)
  // option：tooltip 必须画布内渲染（小程序无 DOM，否则触摸会崩）；系列数据=真实分数
  const option = page.buildMoodOption()
  assert.equal(option.tooltip.renderMode, 'richText')
  assert.deepEqual(option.series[0].data, [3, 4])
  assert.deepEqual(option.xAxis.data, ['01-01', '01-02'])
  // tooltip formatter 展示日期 + 心情 + 分数
  assert.equal(option.tooltip.formatter([{ dataIndex: 1 }]), '2026-01-02 · 期待（4 分）')
})
