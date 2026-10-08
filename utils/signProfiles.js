// 星座档案静态数据：守护星与幸运石（标准西方占星对应，按 nameEn 索引）
// （与 Web 版 src/signProfiles.js 一致，原生小程序改为 CommonJS 导出）
const SIGN_PROFILES = {
  aries: { planet: '火星', gem: '钻石' },
  taurus: { planet: '金星', gem: '祖母绿' },
  gemini: { planet: '水星', gem: '玛瑙' },
  cancer: { planet: '月亮', gem: '珍珠' },
  leo: { planet: '太阳', gem: '红宝石' },
  virgo: { planet: '水星', gem: '蓝宝石' },
  libra: { planet: '金星', gem: '蛋白石' },
  scorpio: { planet: '冥王星', gem: '黑曜石' },
  sagittarius: { planet: '木星', gem: '绿松石' },
  capricorn: { planet: '土星', gem: '石榴石' },
  aquarius: { planet: '天王星', gem: '紫水晶' },
  pisces: { planet: '海王星', gem: '海蓝宝' }
}

// 别名兼容（后端若用 scorpius / capricornus 也能命中）
SIGN_PROFILES.scorpius = SIGN_PROFILES.scorpio
SIGN_PROFILES.capricornus = SIGN_PROFILES.capricorn

/** 按 nameEn（不区分大小写）取档案；取不到返回 null */
function profileOf(nameEn) {
  if (!nameEn) return null
  return SIGN_PROFILES[String(nameEn).toLowerCase()] || null
}

module.exports = { SIGN_PROFILES, profileOf }
