const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const path = require('node:path')

test('请求期间更换选择，返回结果标记过期；切回原选择恢复匹配', async () => {
  let page
  let finish
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../pages/match/match.js'), 'utf8'), {
    Page: (value) => { page = value },
    require: () => ({ fetchMatch: () => new Promise((resolve) => { finish = resolve }) })
  })
  page.setData = (patch) => {
    for (const [key, value] of Object.entries(patch)) {
      const [parent, child] = key.split('.')
      if (child) page.data[parent][child] = value
      else page.data[key] = value
    }
  }
  page.data.signs = [{ id: 1, nameEn: 'aries' }, { id: 2, nameEn: 'leo' }]
  page.data.sel1.signId = 1
  page.data.sel2.signId = 2
  const pending = page.doMatch()
  page.onPickGender({ currentTarget: { dataset: { side: 1, gender: 0 } } })
  finish({ scores: { overall: 80 } })
  await pending
  assert.equal(page.data.resultStale, true)
  page.onPickGender({ currentTarget: { dataset: { side: 1, gender: 1 } } })
  assert.equal(page.data.resultStale, false)
})
