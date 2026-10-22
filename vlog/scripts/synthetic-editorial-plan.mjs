// Synthetic teaching plans only. No media generation, playback or publication.
const TREATMENTS = {
  'no-gps': {
    hook: ['雨滴打在窗沿的合成原声', '固定近景；窗沿占下三分之一', '静止观察雨点'],
    tension: ['手机碰到衣袖的合成摩擦声', '手与手机的合成特写', '短促推近手机边缘'],
    recovery: ['书页与桌面接触的合成原声', '书本与双手居中', '跟随手部向画面内平移'],
    payoff: ['保留雨滴尾音；不增加未记录对白', '积水反光的合成近景', '固定画面停留，留出回收时间'],
  },
  'partial-gps': {
    hook: ['袋口摩擦与笔记本落下的合成原声', '袋口和蓝色封面居中', '向下跟随封面'],
    tension: ['市场环境的合成底声；不添加人物对白', '摊位细节的合成中景', '缓慢横移；不显示地图或地点标签'],
    recovery: ['回头脚步的合成原声', '摊位细节居中；位置保持未知', '反向平移表达回头动作'],
    payoff: ['纸张轻响的合成原声', '长椅下蓝色封面的合成特写', '固定特写停留；不推断所在地点'],
  },
  'gps-enhanced': {
    hook: ['风与风筝线绷紧的合成原声', '风筝线位于画面对角线', '沿风筝线短推近'],
    tension: ['风掠过栏杆的合成原声', '栏杆与风筝的合成中景', '向风筝方向短促摇移'],
    recovery: ['公园脚步与风声的合成原声', '树丛方向的合成中景', '向前跟随；不推断交通方式'],
    payoff: ['树叶摩擦的合成原声', '灌木中风筝的合成近景', '固定画面停留，明确事件收束'],
    map: ['无地图原声；仅延续已规划的合成 BGM', '两个获准的合成样本点；非实测轨迹', '固定地图视野，依次高亮两点；不绘制移动轨迹'],
    recap: ['复用 SYN-G2@5-7s 合成树叶尾音；不新增行程音效', '并列样本卡；不暗示连续空间', '静止并列卡收尾'],
  },
};

export function editorialPlanFor(mode, definition, revised) {
  const revision = revised ? 'r2' : 'r1';
  return definition.scenes[revision].map((scene, index, scenes) => {
    const [sound, composition, motion] = TREATMENTS[mode][scene.name];
    const sourceId = scene.source ?? 'SYNTHETIC_MAP_CONTEXT';
    return {
      ...scene, sourceId, revision,
      sourceRange: scene.map ? 'NOT_SOURCE_FOOTAGE' : scene.source === 'BOTH'
        ? 'SYN-G1@0-4s + SYN-G2@4-7s (editorial recap)' : `${scene.source}@${scene.start}-${scene.start + scene.duration}s`,
      caption: scene.text ?? scene.title,
      composition, motion,
      originalSound: `${scene.map ? '' : `${sourceId}: `}${sound}（SYNTHETIC intent；未生成或试听）`,
      bgm: `SYNTHETIC_BGM_PLACEHOLDER；${scene.map ? '-18' : '-24'} dB；原声前后 250ms duck/fade；许可 NOT_PROVEN`,
      transitionIn: index === 0 ? '首帧直接进入' : scene.map ? '事件收束后硬切进入地图' : '硬切进入；不改变时间线时长',
      transitionOut: index === scenes.length - 1 ? '末帧停止；不增加时长' : scene.map ? '硬切退出地图，进入并列样本回顾' : '动作切点硬切；不增加重叠时长',
    };
  });
}

export const storyFor = (definition, plan) => [
  `# ${definition.label}（SYNTHETIC_NOT_REAL；${plan[0].revision}）`, '',
  ...plan.map((scene) => `- ${scene.name} ${scene.start}-${scene.start + scene.duration}s：${scene.title}（${scene.sourceRange}）。`),
  '', '所有地点、媒体、授权与评价都是教学合成值；不得用于真实发布。', '',
].join('\n');

export const briefFor = (definition, plan) => [
  `# ${definition.label} visual brief（SYNTHETIC_NOT_REAL；${plan[0].revision}）`, '',
  ...plan.flatMap((scene) => [
    `## ${scene.name} ${scene.start}-${scene.start + scene.duration}s：${scene.title}`,
    `来源：${scene.sourceRange}`, `构图：${scene.composition}`, `运动：${scene.motion}`,
    `入点：${scene.transitionIn}`, `出点：${scene.transitionOut}`,
    `原声：${scene.originalSound}`, `BGM：${scene.bgm}`, `字幕：${scene.caption}`, '',
  ]),
  '图形与声音仅为教学编辑意图；没有生成、试听或渲染真实素材。', '',
].join('\n');

const vttTime = (seconds) => {
  const milliseconds = Math.round(seconds * 1000);
  return `${String(Math.floor(milliseconds / 3600000)).padStart(2, '0')}:${String(Math.floor(milliseconds / 60000) % 60).padStart(2, '0')}:${String(Math.floor(milliseconds / 1000) % 60).padStart(2, '0')}.${String(milliseconds % 1000).padStart(3, '0')}`;
};

export const captionsFor = (plan) => ['WEBVTT', '', ...plan.flatMap((scene) => [
  `${vttTime(scene.start)} --> ${vttTime(scene.start + scene.duration)}`, scene.caption, '',
])].join('\n');
