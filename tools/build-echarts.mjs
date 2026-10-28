#!/usr/bin/env node
/**
 * 把 1.0 MB 的 ECharts 全量构建换成只含「雷达图 + 折线图」的自定义构建。
 *
 * 为什么要做：小程序主包 1.31 MB，其中 components/ec-canvas/echarts.js 占 1.01 MB（75%）。
 * 全量构建里有几十种图表，这个项目只用到两种。
 *
 * ⚠️ 为什么没有默认替换掉：现有 echarts.js 是 echarts-for-weixin 自编译的 5.6.1 版本
 *    （npm 上并没有 5.6.1，最新 5.x 是 5.6.0），而 ec-canvas 组件里调用了
 *    `echarts.setCanvasCreator(...)` 这条老兼容 API。替换后必须用**微信开发者工具真机预览**
 *    确认三个图表（星运雷达图、运势趋势图、塔罗心情图）都能正常渲染，否则不要提交。
 *
 * 用法：
 *   cd D:\project_back\starwhisper-mp
 *   node tools/build-echarts.mjs
 *   # 然后在微信开发者工具里逐个页面看图表；确认无误再提交
 *   # 出问题就回滚：git checkout -- components/ec-canvas/echarts.js
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, copyFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(here, '..');
const target = join(projectRoot, 'components', 'ec-canvas', 'echarts.js');
const backup = join(projectRoot, 'components', 'ec-canvas', 'echarts.full.js.bak');
const workDir = join(here, '.echarts-build');

/** 只登记项目真正用到的图表与组件；新增图表类型时记得回来加 */
const ENTRY = `
import * as echarts from 'echarts/core';
import { RadarChart, LineChart } from 'echarts/charts';
import {
  RadarComponent,   // 雷达坐标系
  GridComponent,    // 直角坐标系（折线图）
  TooltipComponent,
  LegendComponent,
} from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';

echarts.use([
  RadarChart, LineChart,
  RadarComponent, GridComponent, TooltipComponent, LegendComponent,
  CanvasRenderer,
]);

module.exports = echarts;
`;

function run(cmd, args, opts = {}) {
  return execFileSync(cmd, args, { stdio: 'inherit', shell: process.platform === 'win32', ...opts });
}

function kb(p) {
  return (statSync(p).size / 1024).toFixed(0);
}

if (!existsSync(target)) {
  console.error(`找不到目标文件：${target}`);
  process.exit(1);
}

mkdirSync(workDir, { recursive: true });
writeFileSync(join(workDir, 'package.json'),
  JSON.stringify({ name: 'sw-echarts-build', private: true, type: 'module' }, null, 2));
writeFileSync(join(workDir, 'entry.js'), ENTRY);

console.log('→ 安装 echarts 5.6.0 / esbuild（仅构建期依赖，不会进小程序包）');
run('npm', ['install', '--no-audit', '--no-fund', 'echarts@5.6.0', 'esbuild@0.25.0'], { cwd: workDir });

console.log('→ 打包');
run('npx', [
  'esbuild', 'entry.js',
  '--bundle',
  '--format=cjs',
  '--platform=browser',
  '--target=es2015',
  '--minify',
  '--legal-comments=none',
  `--outfile=${join(workDir, 'echarts.custom.js')}`,
], { cwd: workDir });

const built = join(workDir, 'echarts.custom.js');

// 体积对比
console.log(`\n原文件：${kb(target)} KB`);
console.log(`新构建：${kb(built)} KB`);
console.log(`节省：${(kb(target) - kb(built))} KB`);

// 备份原文件（文件名 .bak，需同时加入 project.config.json 的 packOptions.ignore）
if (!existsSync(backup)) {
  copyFileSync(target, backup);
  console.log(`已备份原文件到 ${backup}`);
}

copyFileSync(built, target);
console.log(`\n✅ 已替换 ${target}`);

console.log(`
下一步（必须做）：
1. 打开微信开发者工具，逐页确认图表能正常渲染：
   · pages/fortune 今日（雷达图）
   · pages/fortune 近7天（折线图）
   · pages/tarot 心情曲线（折线图）
2. 确认无误后提交；有问题就执行：
   git checkout -- components/ec-canvas/echarts.js
3. 如果 project.config.json 的 packOptions.ignore 里还没有 echarts.full.js.bak，请补上，
   否则这个备份会被打进小程序包，等于白做。
`);
