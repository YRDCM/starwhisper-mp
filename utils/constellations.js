// 12 星座图案数据：风格化星联（asterism），并非天文精确。
// points 为 0-100 视窗坐标，edges 为点下标连线；供星盘节点与卡片内小图使用。
// （与 Web 版 src/constellations.js 数据一致，原生小程序改为 CommonJS 导出）
const CONSTELLATIONS = {
  aries: { points: [[30, 25], [52, 20], [68, 32], [60, 55]], edges: [[0, 1], [1, 2], [2, 3]] },
  taurus: { points: [[18, 16], [32, 32], [50, 54], [68, 32], [84, 18], [50, 36]], edges: [[0, 1], [1, 2], [2, 3], [3, 4], [1, 5], [5, 3]] },
  gemini: { points: [[32, 20], [30, 45], [34, 70], [64, 20], [66, 45], [62, 70]], edges: [[0, 1], [1, 2], [3, 4], [4, 5]] },
  cancer: { points: [[50, 25], [50, 48], [28, 68], [72, 68]], edges: [[0, 1], [1, 2], [1, 3]] },
  leo: { points: [[62, 18], [45, 22], [35, 36], [42, 50], [58, 52], [78, 64], [50, 70]], edges: [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 6], [6, 4]] },
  virgo: { points: [[25, 30], [42, 38], [38, 58], [58, 50], [70, 66], [74, 36]], edges: [[0, 1], [1, 2], [2, 3], [3, 4], [3, 5]] },
  libra: { points: [[32, 32], [68, 32], [76, 64], [24, 64], [50, 20]], edges: [[0, 1], [1, 2], [2, 3], [3, 0], [4, 0], [4, 1]] },
  scorpio: { points: [[24, 26], [38, 30], [50, 42], [48, 58], [60, 68], [74, 66], [79, 52]], edges: [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 6]] },
  sagittarius: { points: [[38, 40], [62, 40], [58, 64], [42, 64], [78, 26], [24, 32], [50, 28]], edges: [[0, 1], [1, 2], [2, 3], [3, 0], [1, 4], [0, 5], [0, 6], [1, 6]] },
  capricorn: { points: [[20, 34], [48, 72], [80, 36], [34, 42]], edges: [[0, 3], [3, 1], [1, 2]] },
  aquarius: { points: [[24, 34], [38, 26], [52, 34], [66, 26], [30, 62], [44, 54], [58, 62], [72, 54]], edges: [[0, 1], [1, 2], [2, 3], [4, 5], [5, 6], [6, 7]] },
  pisces: { points: [[30, 28], [50, 50], [70, 28], [86, 62]], edges: [[0, 1], [1, 2], [1, 3]] }
}

// 别名兼容（后端若用 scorpius / capricornus 也能命中）
CONSTELLATIONS.scorpius = CONSTELLATIONS.scorpio
CONSTELLATIONS.capricornus = CONSTELLATIONS.capricorn

// 中文名 → 英文名映射（速配星座只有中文名时用）
const ZH_TO_EN = {
  白羊座: 'aries', 金牛座: 'taurus', 双子座: 'gemini', 巨蟹座: 'cancer',
  狮子座: 'leo', 处女座: 'virgo', 天秤座: 'libra', 天蝎座: 'scorpio',
  射手座: 'sagittarius', 摩羯座: 'capricorn', 水瓶座: 'aquarius', 双鱼座: 'pisces'
}

/** 按英文名（不区分大小写）或中文名取星联；取不到返回 null */
function constellationOf(name) {
  if (!name) return null
  const key = String(name).toLowerCase()
  return CONSTELLATIONS[key] || CONSTELLATIONS[ZH_TO_EN[name]] || null
}

module.exports = { CONSTELLATIONS, constellationOf }
