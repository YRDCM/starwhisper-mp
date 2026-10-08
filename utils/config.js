// 全局配置：后端 API 基地址
//
// 当前：后端已部署到阿里云 60.205.228.96（HTTP）。
//   开发/预览阶段仍需在【微信开发者工具 → 详情 → 本地设置】勾选
//   「不校验合法域名、web-view（业务域名）、TLS 版本以及 HTTPS 证书」。
// 正式上线：微信小程序要求 request 域名必须是备案过的 https 域名，
//   域名备案完成后把 BASE_URL 换成 https://api.<域名> 并在小程序后台配置 request 合法域名。
const BASE_URL = 'http://60.205.228.96'

module.exports = { BASE_URL }
