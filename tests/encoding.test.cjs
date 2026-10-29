// 编码守卫：源码文件不能带 UTF-8 BOM
//
// 为什么需要这条：PowerShell 的 `Set-Content -Encoding UTF8`（5.1）会写入 BOM，
// 而微信小程序编译器遇到 BOM 会直接报
//   [ WXSS 文件编译错误] unexpected '﻿' at pos 1
// 并且**不会指出是 BOM**，容易误判成语法问题。
// 2026-10-29 就因为 profile.wxss 被 PowerShell 写坏，提交后才发现编译不过。
//
// 这条测试的成本几乎为零，但能挡住一整类「提交了才发现编译失败」的事故。
const test = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.join(__dirname, '..')
// 不参与打包、也不需要检查的目录
const SKIP_DIRS = new Set(['node_modules', '.git', 'tools', 'tests'])
const EXTS = new Set(['.js', '.json', '.cjs', '.mjs', '.wxml', '.wxss'])

function walk(dir, out) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      walk(full, out)
    } else if (EXTS.has(path.extname(entry.name))) {
      out.push(full)
    }
  }
  return out
}

test('源码文件不能带 UTF-8 BOM（小程序编译器会报「文件编译错误」）', () => {
  const files = walk(ROOT, [])
  assert.ok(files.length > 20, '扫描到的文件太少，路径可能算错了：' + files.length)

  const bad = []
  for (const file of files) {
    const buf = fs.readFileSync(file)
    if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) {
      bad.push(path.relative(ROOT, file))
    }
  }

  assert.deepEqual(
    bad,
    [],
    '以下文件带 UTF-8 BOM，请另存为「UTF-8 无 BOM」：\n  ' + bad.join('\n  ')
  )
})
