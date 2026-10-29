// 订阅消息（每日/每周运势提醒）纯逻辑：条目状态文案、授权结果判断、星座选项
// 抽成纯函数便于 node 测试；页面层只负责 wx API 与 setData

// 12 星座选项（订阅时让用户选自己的星座，后端按它取运势推送）
const SIGN_OPTIONS = [
  { name: '白羊座', nameEn: 'aries' },
  { name: '金牛座', nameEn: 'taurus' },
  { name: '双子座', nameEn: 'gemini' },
  { name: '巨蟹座', nameEn: 'cancer' },
  { name: '狮子座', nameEn: 'leo' },
  { name: '处女座', nameEn: 'virgo' },
  { name: '天秤座', nameEn: 'libra' },
  { name: '天蝎座', nameEn: 'scorpio' },
  { name: '射手座', nameEn: 'sagittarius' },
  { name: '摩羯座', nameEn: 'capricorn' },
  { name: '水瓶座', nameEn: 'aquarius' },
  { name: '双鱼座', nameEn: 'pisces' }
]

/**
 * 「运势提醒」条目的展示状态（每日/每周通用）
 * @param {object} input { templateId, loggedIn, subscribed, consumed, subscribedText?, consumedText? }
 *   subscribed：后端 ACTIVE（还有待推送额度）
 *   consumed：已推送过、额度用完——必须和「从没订阅」区分开，
 *             否则用户刚收到推送，回到页面却看到「未订阅」，会以为没订上
 * @returns {{text: string, clickable: boolean}}
 *   模板 ID 未配置（运营还没去公众平台申请）→ 「即将上线」且不可点
 *   —— 绝不能拿空 tmplId 去调 wx.requestSubscribeMessage，会直接报错
 */
function notifyEntryState({ templateId, loggedIn, subscribed, consumed, subscribedText, consumedText }) {
  if (!templateId || !String(templateId).trim()) return { text: '即将上线', clickable: false }
  if (!loggedIn) return { text: '登录后可订阅', clickable: true }
  if (subscribed) return { text: subscribedText || '已订阅 · 明日 8:00 推送', clickable: true }
  if (consumed) return { text: consumedText || '本次已推送 · 点击再次开启', clickable: true }
  return { text: '未订阅 · 点击开启', clickable: true }
}

/**
 * wx.requestSubscribeMessage 的授权结果判断：用户是否点了「允许」
 * res 形如 { [tmplId]: 'accept' | 'reject' | 'ban', errMsg: '...' }
 */
function isSubscribeAccepted(res, tmplId) {
  return !!(res && res[tmplId] === 'accept')
}

// 微信平台规则提示文案（如实告知：一次授权只推一天，次日想继续收需再次授权）
const SUBSCRIBE_TIP = '微信规则：一次授权仅推送一天，推送后想继续每天收，请再次开启授权'

// 每周条目的已订阅文案与平台规则提示（每周一 08:05 推送，与每日任务错开）
const WEEKLY_SUBSCRIBED_TEXT = '已订阅 · 每周一 8:05 推送'
const SUBSCRIBE_TIP_WEEKLY = '微信规则：一次授权仅推送一次，推送后想继续每周收，请再次开启授权'

module.exports = { SIGN_OPTIONS, notifyEntryState, isSubscribeAccepted, SUBSCRIBE_TIP, WEEKLY_SUBSCRIBED_TEXT, SUBSCRIBE_TIP_WEEKLY }
