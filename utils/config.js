// 全局配置：后端 API 基地址
//
// 2026-10-19：域名 mystarwhisper.cn 已完成 ICP 备案（粤ICP备2026152859号-2）+ HTTPS，
// BASE_URL 已切到备案域名。小程序后台「request 合法域名」需配置 https://mystarwhisper.cn。
// 开发者工具里如勾选了「不校验合法域名」则两边都能跑；真机/体验版必须走合法域名。
const BASE_URL = 'https://mystarwhisper.cn'

// 小程序版本号：每次发版递增，「我的」页页脚展示，便于区分当前是否最新版
const APP_VERSION = '1.6.1'

// ===== 订阅消息模板 ID =====
// 到微信公众平台 mp.weixin.qq.com → 功能 → 订阅消息 申请模板后回填。
// 留空 = 功能未上线：「我的」页条目显示「即将上线」且不可点（不会拿空 ID 调 wx.requestSubscribeMessage）
const SUBSCRIBE_TEMPLATES = {
  // 2026-10-19 起推送功能整体暂停（微信一次性订阅"授权一次只能推一条"，体验不闭环）
  // 模板 ID 留档：每日运势提醒 = 7MKQhnJvNlWoHAEdkQ7VnBrv51Z5c4U8PxPCNMWjW7c；恢复时回填即可
  dailyFortune: '',
  weeklyFortune: '' // 每周运势提醒（占位；空 = 「即将上线」不可点）
}

module.exports = { BASE_URL, APP_VERSION, SUBSCRIBE_TEMPLATES }
