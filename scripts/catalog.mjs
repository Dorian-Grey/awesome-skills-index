import {readFile, writeFile, access, rename} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';

const root = new URL('../', import.meta.url);
const catalogFile = new URL('catalog.json', root);
const catalog = JSON.parse(await readFile(catalogFile, 'utf8'));
const {projects} = catalog;
const ids = new Set();

for (const project of projects) {
  if (!/^[a-z0-9-]+$/.test(project.id) || ids.has(project.id)) {
    throw new Error('条目 ID 无效或重复：' + project.id);
  }
  ids.add(project.id);
  if (project.images.length < 1 || project.images.length > 3) {
    throw new Error(project.name + ' 需要 1–3 张效果图');
  }
  for (const image of project.images) {
    await access(new URL(image.path, root));
  }
}

const refresh = process.argv.includes('--refresh-stars');
if (refresh) {
  const repos = [...new Set(projects.map(p => p.repo).filter(Boolean))];
  const headers = {Accept: 'application/vnd.github+json'};
  if (process.env.GITHUB_TOKEN) headers.Authorization = 'Bearer ' + process.env.GITHUB_TOKEN;
  const counts = new Map();
  for (const repo of repos) {
    if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) throw new Error('仓库名无效：' + repo);
    const response = await fetch('https://api.github.com/repos/' + repo, {
      headers, signal: AbortSignal.timeout(30000),
    });
    if (!response.ok) throw new Error(repo + ' · GitHub API ' + response.status);
    const {stargazers_count: count} = await response.json();
    if (!Number.isInteger(count) || count < 0) throw new Error(repo + ' 缺少 Stars');
    counts.set(repo, count);
  }
  for (const p of projects) p.stars = p.repo ? counts.get(p.repo) : null;
  catalog.starsAsOf = new Intl.DateTimeFormat('sv-SE', {timeZone: 'Asia/Shanghai'}).format(new Date());
}

function stars(p) {
  if (!p.repo) return '—';
  if (!Number.isInteger(p.stars) || p.stars < 0) throw new Error(p.name + ' 需要有效的 Stars，请使用 --refresh-stars');
  return '[' + p.stars.toLocaleString('en-US') + '](https://github.com/' + p.repo + '/stargazers)';
}

function escapeHtml(value) {
  return value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

const groups = new Map();
for (const p of projects) {
  if (!groups.has(p.category)) groups.set(p.category, []);
  groups.get(p.category).push(p);
}
for (const items of groups.values()) {
  items.sort((a, b) => (b.stars ?? -1) - (a.stars ?? -1));
}

const lines = [
  '# 热门 Skill 精选',
  '',
  '按用途收录可复用的 AI 技能、创作工具与成品案例。各领域按 Stars 从高到低排列，暂无计数的项目排在末尾。点击项目名查看项目链接和效果图，点击图片可查看上游原图或生成它的模板。',
  '',
  '**' + projects.length + ' 个项目 · ' + groups.size + ' 个领域**　｜　GitHub Stars 采集于 ' + catalog.starsAsOf + '（北京时间）',
  '',
  '| 领域 | 项目 | 简介 | GitHub Stars |',
  '| --- | --- | --- | ---: |',
];
for (const [group, items] of groups) {
  for (const [i, p] of items.entries()) {
    const summary = p.description.replace(/\s*\r?\n\s*/g, ' ').replaceAll('|', '\\|');
    lines.push('| ' + (i === 0 ? group : '') + ' | [' + p.name + '](#project-' + p.id + ') | ' + summary + ' | ' + stars(p) + (p.starNote ? '（所属仓库）' : '') + ' |');
  }
}

for (const [group, items] of groups) {
  lines.push('', '## ' + group);
  for (const p of items) {
    const links = ['[项目主页](' + p.url + ')'];
    if (p.resource) links.push('[' + p.resource.label + '](' + p.resource.url + ')');
    lines.push('', '<a id="project-' + p.id + '"></a>', '', '### ' + p.name, '', p.description, '', links.join(' · '));
    if (p.starNote) lines.push('', p.starNote);
    if (!p.repo) lines.push('', 'Stars 暂缺。项目官网未提供对应的公开 GitHub 仓库链接。');
    const captions = p.images.map(img => img.caption.replaceAll('|', '\\|'));
    const width = p.images.length === 1 ? 600 : 410;
    const images = p.images.map(img => '<a href="' + escapeHtml(img.source) + '"><img src="' + escapeHtml(img.path) + '" width="' + width + '" alt="' + escapeHtml(img.caption) + '"></a>');
    lines.push('', '| ' + captions.join(' | ') + ' |', '| ' + captions.map(() => '---').join(' | ') + ' |', '| ' + images.join(' | ') + ' |');
  }
}
lines.push('', '## 扩充索引', '',
  '1. 在 [catalog.json](catalog.json) 的 `projects` 中复制一条相近的记录，填写唯一的 `id`、领域、简介和项目链接。简介用一两句写明能做出什么、可以用在什么场景。`repo` 填 GitHub 的 `owner/repo`，官网项目可填 `null`。收录子目录时，用 `starNote` 注明 Stars 归属。',
  '2. 将 1–3 张效果图放进 [previews/](previews/)，在 `images` 中填写相对路径、中文图注和上游来源。相同的 `category` 会自动归为一组。',
  '3. 使用 Node.js 20 或更高版本，在仓库根目录运行 `node scripts/catalog.mjs --refresh-stars`，统一更新 Stars 和首页。只修改文字或图片时，运行 `node scripts/catalog.mjs` 即可离线重建。将数据、图片和 README 一起提交。',
  '',
);

if (refresh) {
  const pending = fileURLToPath(catalogFile) + '.' + process.pid + '.tmp';
  await writeFile(pending, JSON.stringify(catalog, null, 2) + '\n');
  await rename(pending, catalogFile);
}
await writeFile(new URL('README.md', root), lines.join('\n'));
console.log('已生成索引，共 ' + projects.length + ' 个项目。');