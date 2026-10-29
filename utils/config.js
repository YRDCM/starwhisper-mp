// 全局配置：后端 API 基地址
//
// 2026-10-19：域名 mystarwhisper.cn 已完成 ICP 备案（粤ICP备2026152859号-2）+ HTTPS，
// BASE_URL 已切到备案域名。小程序后台「request 合法域名」需配置 https://mystarwhisper.cn。
// 开发者工具里如勾选了「不校验合法域名」则两边都能跑；真机/体验版必须走合法域名。
const BASE_URL = 'https://mystarwhisper.cn'

// 小程序版本号：每次发版递增，「我的」页页脚展示，便于区分当前是否最新版
// 1.7.0：合规下线八卦/每日一卦板块、移除游客登录入口、修复分享链路与图表泄漏
const APP_VERSION = '1.7.0'

// ===== 订阅消息模板 ID =====
// 到微信公众平台 mp.weixin.qq.com → 功能 → 订阅消息 申请模板后回填。
// 留空 = 功能未上线：「我的」页条目显示「即将上线」且不可点（不会拿空 ID 调 wx.requestSubscribeMessage）
const SUBSCRIBE_TEMPLATES = {
  // 模板 71514「今日运势提醒」｜类目：信息查询｜2026-10-29 接回
  // 字段：日期 time3 / 运势简述 thing2 / 运势关键词 thing1（后端 DailyFortuneNotifyJob 按此组装）
  // 微信规则：一次授权只能推一条，所以推送成功后额度即消耗，页面会提示再次授权
  dailyFortune: '7MKQhnJvNlWoHAEdkQ7VnBrv51Z5c4U8PxPCNMWjW7c',
  weeklyFortune: '' // 每周运势提醒（占位；空 = 「即将上线」不可点，等运营申请第二个模板）
}

module.exports = { BASE_URL, APP_VERSION, SUBSCRIBE_TEMPLATES }
