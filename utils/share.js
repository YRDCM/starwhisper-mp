// 分享卡片辅助：onShareAppMessage 的 imageUrl 只认「本地文件/临时文件路径」。
// 海报由 wx.canvasToTempFilePath 产出（wxfile://… / http://tmp/…），可直接用；
// 若哪天改成 base64（data:image/png;base64,…），微信不会当卡片图，只会白占内存，这里直接丢弃。

/**
 * 过滤分享卡片图：base64 / 空值 → undefined，其余路径原样返回
 * @param {string} path 本地临时文件路径
 * @returns {string|undefined}
 */
function shareImageUrl(path) {
  const p = typeof path === 'string' ? path.trim() : ''
  if (!p) return undefined
  if (/^data:/i.test(p) || p.indexOf(';base64,') !== -1) return undefined
  return p
}

module.exports = { shareImageUrl }
