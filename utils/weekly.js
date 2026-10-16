// 本周运势纯函数：timeRange 格式化等，供星运页使用；与 Web 端 src/weekly.js 保持同款逻辑

/**
 * 周区间格式化：'20261011-20261018' → '10.11 – 10.18'
 * 后端原样透传上游 time 字段，这里只做展示层格式化；
 * 格式不符（null/空串/缺段）一律返回空串，模板按无数据处理
 */
function formatWeekRange(timeRange) {
  if (!timeRange) return ''
  const m = String(timeRange).trim().match(/^(\d{4})(\d{2})(\d{2})-(\d{4})(\d{2})(\d{2})$/)
  if (!m) return ''
  // 月日保留前导零（与星座 dateRange 的 03.21 风格一致）
  return `${m[2]}.${m[3]} – ${m[5]}.${m[6]}`
}

module.exports = { formatWeekRange }
