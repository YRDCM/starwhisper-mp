// 全局配置：后端 API 基地址
//
// 当前：后端已部署到阿里云 60.205.228.96（HTTP）。
//   开发/预览阶段仍需在【微信开发者工具 → 详情 → 本地设置】勾选
//   「不校验合法域名、web-view（业务域名）、TLS 版本以及 HTTPS 证书」。
// 正式上线：微信小程序要求 request 域名必须是备案过的 https 域名，
//   域名备案完成后把 BASE_URL 换成 https://api.<域名> 并在小程序后台配置 request 合法域名。
const BASE_URL = 'http://60.205.228.96'

// 小程序版本号：每次发版递增，「我的」页页脚展示，便于区分当前是否最新版
const APP_VERSION = '1.5.0'

// ===== 订阅消息模板 ID =====
// 到微信公众平台 mp.weixin.qq.com → 功能 → 订阅消息 申请模板后回填。
// 留空 = 功能未上线：「我的」页条目显示「即将上线」且不可点（不会拿空 ID 调 wx.requestSubscribeMessage）
const SUBSCRIBE_TEMPLATES = {
  dailyFortune: '7MKQhnJvNlWoHAEdkQ7VnBrv51Z5c4U8PxPCNMWjW7c' // 每日运势提醒（一次性订阅模板）
}

module.exports = { BASE_URL, APP_VERSION, SUBSCRIBE_TEMPLATES }
