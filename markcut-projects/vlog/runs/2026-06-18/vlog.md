---
hook: "50岁了，你自由了吗"
conflict: "漂泊半生，家在两个大陆之间——四川的老人等着我回去，加拿大的孩子在等着长大。站在五十岁的门槛上，不知道该往哪儿走。"
emotion: "宁静而释然。中年的孤独不是凄凉，是一场与自己和解的对话。风吹过来的时候，发呆也是享受。"
resolution: "人生不必总是赶路。在森林里住了三天，发现答案不在远处，就在火堆旁、溪水边、一朵不起眼的野花里。"
ending: "五十岁不是终点，是另一段旅程的开始。人生就像一场露营——重要的不是去了多远，而是每次停下来的时候，心里是安静的。"
media_selection_reasoning: |
  快放:
  - IMG_7079.MOV: playbackRate:8 — 林间小路快速闪过，引入营地环境
  - IMG_7081.MOV: playbackRate:4 startFrom:30 — 营地读书最后片段，ASR幻觉部分跳过
  - IMG_7082.MOV: playbackRate:5 — 帐篷环境快放，与IMG_7083衔接
  裁剪:
  - IMG_7060.MOV: startFrom:5 endAt:20 — 鹿最清晰且移动的中段
  - IMG_7080.MOV: startFrom:13 endAt:52 — 冰啤酒→品尝完整moment
  - IMG_7118.MOV: startFrom:0 endAt:20 — 雨夜篝火主体，跳过结尾自语
  - IMG_7124.MOV: startFrom:6 endAt:17 — 湖边风景，跳过对话和致谢
  分组: 片头→出发→湖→鹿遇→安营→闪回(快放)→溪边→营火→雨夜→清晨→片尾
---

# video
seed:710343005
width:1080 height:1920 fps:30 layout:transitionSeries transition:fade transitionTime:1.2
subtitle:{"fontSize":52,"style":"position:absolute;top:50%;left:0;right:0;transform:translateY(-50%);text-align:center;z-index:10"}

~~~css stylesheet
@import url('https://fonts.googleapis.com/css2?family=Noto+Serif+SC:wght@400;700;900&family=Noto+Sans+SC:wght@300;400;700&display=swap');

.title-glow { text-shadow: 0 0 40px rgba(255,215,0,0.3); }
.title-gold { font-family: 'Noto Serif SC', serif; font-weight: 900; }
.caption-serif { font-family: 'Noto Serif SC', serif; }
.caption-light { font-family: 'Noto Sans SC', sans-serif; font-weight: 300; }
.fade-in { animation: fadeIn 1.5s ease-out; }
.fade-in-slow { animation: fadeIn 2.5s ease-out; }
@keyframes fadeIn { from { opacity: 0; transform: translateY(20px); } to { opacity: 1; transform: translateY(0); } }
@keyframes gentlePulse {
  0%, 100% { opacity: 0.7; }
  50% { opacity: 1; }
}
~~~

- audio src:assets/goin-home-instrumental.mp3 volume:0.325 isBackground:true

## 片头
layout:parallel
- audio src:assets/sfx/sfx-forest-birds.mp3 volume:0.15 isBackground:true
- image src:inputs/IMG_7068.JPG fit:cover duration:4
  style:"filter:brightness(0.4)"
- component duration:4
  effects:[fadeIn(1.5, ease-out)]
  ~~~jsx
  <div style={{display:'flex',flexDirection:'column',justifyContent:'center',alignItems:'center',height:'100%',padding:'0 60px',textAlign:'center'}}>
    <div style={{fontSize:72,fontWeight:900,color:'#FFD700',textShadow:'0 4px 20px rgba(0,0,0,0.6)',marginBottom:20,letterSpacing:4}}>🎂 五十岁</div>
    <div style={{fontSize:32,fontWeight:400,color:'#fff',textShadow:'0 2px 12px rgba(0,0,0,0.5)',opacity:0.9,lineHeight:1.5}}>一个人的森林生日旅行</div>
  </div>
  ~~~

## 出发
layout:parallel
- map start:1.2 isBackground:true travelMode:DRIVING routeColor:"#4A90D9" routeWeight:4 zoom:9 routeMarker:"🚗" waypoints:[45.296,-75.917,"Kanata";45.612,-76.009,"Lac Philippe";45.632,-76.013,"湖滨入口";45.600,-75.998,"营地"]
- script "从渥太华往北开四十分钟，就到魁北克的森林了。一个人，一辆车，一个装满了书和啤酒的背包。五十岁的生日旅行，就这样出发了。"
  start:1.2

## 湖
layout:parallel
- audio src:assets/sfx/sfx-forest-birds.mp3 volume:0.15 isBackground:true
- image src:inputs/IMG_7068.JPG isBackground:true fit:cover
- script "阴天，湖面很静。没有生日蛋糕，没有派对，只有一汪湖水，和一整片等着我的安静。五十岁好像就该是这样的——不需要热闹，只需要一个能让自己好好待着的地方。"
  start:1.2

## 鹿遇
layout:parallel
- audio src:assets/sfx/sfx-forest-birds.mp3 volume:0.12 isBackground:true
- video src:inputs/IMG_7060.MOV startFrom:5 endAt:20 isBackground:true volume:0.2
- script "刚到营地就遇见了一只鹿。她就站在树林里，安安静静地吃着草，偶尔抬头看我一眼。那个瞬间我觉得，这是森林送给我的生日礼物——不需要包装，不需要理由，遇见了就是遇见了。"
  start:1.2

## 安营
layout:transitionSeries transition:fade transitionTime:1.0
- image src:inputs/IMG_7100.JPG fit:cover duration:5
- parallel
  - audio src:assets/sfx/sfx-forest-birds.mp3 volume:0.15 isBackground:true
  - image src:inputs/IMG_7104.JPG isBackground:true fit:cover
  - script "土路的尽头有一块木牌，上面写着'Enchantment'——魔法。是啊，这个被森林和湖水包围的地方，真的有某种魔力。搭好帐篷，点上露营灯，这就是我在森林里的小窝了。虽然不大，但此刻它是全世界最温暖的地方。"
    start:1.0

## 闪回
layout:transitionSeries transition:fade transitionTime:0.5
- video src:inputs/IMG_7079.MOV playbackRate:8 fit:cover volume:0
- video src:inputs/IMG_7082.MOV playbackRate:5 fit:cover volume:0
- video src:inputs/IMG_7081.MOV startFrom:30 playbackRate:4 volume:0

## 溪边
layout:parallel
- audio src:assets/sfx/sfx-stream-long.mp3 volume:0.2 isBackground:true
- video src:inputs/IMG_7080.MOV startFrom:13 endAt:52 isBackground:true volume:0.2
- script "营地旁边有条小溪，水冰得刺骨。把啤酒放进去泡一会儿，就是天然的冰镇啤酒。Nickel Brook 的 Wicked Awesome，新英格兰风格IPA。喝一口，跟酒吧里现打的鲜啤一样爽。在森林里喝冰啤酒——幸福有时候就这么简单。"
  start:1.2

## 营火
layout:transitionSeries transition:fade transitionTime:1.0
- parallel
  - audio src:assets/sfx/sfx-campfire.mp3 volume:0.15 isBackground:true
  - video src:inputs/IMG_7083.MOV isBackground:true volume:0.2
  - script "白天在火堆边看书。穿着红T恤，坐在蓝色折叠椅上。风一吹过来，书页哗哗地响，我也懒得去翻——就这样发呆，挺好的。"
    start:1.0
- parallel
  - audio src:assets/sfx/sfx-campfire.mp3 volume:0.15 isBackground:true
  - image src:inputs/IMG_7111.JPG isBackground:true fit:cover
  - script "到了这个年纪，最奢侈的事情不是买了什么，而是有时间什么都不做。坐在火堆边看着烟升起来，飘进树林里，然后消失不见。就像时间一样。中年人的快乐，不是加法，是减法。"
    start:1.0

## 雨夜
layout:parallel
- audio src:assets/sfx/sfx-rain-tent.mp3 volume:0.2 isBackground:true
- video src:inputs/IMG_7118.MOV startFrom:0 endAt:20 isBackground:true volume:0.2
- script "晚上下起了大雨。躲在车里，看着篝火在雨中烧。火苗一跳一跳的，雨水噼里啪啦打在地上。有点狼狈，但又特别真实。人生就是这样，不是每个生日都阳光灿烂。但雨里的火，反而烧得更亮。"
  start:1.2

## 清晨
layout:transitionSeries transition:fade transitionTime:1.0
- parallel
  - audio src:assets/sfx/sfx-morning-birds.mp3 volume:0.15 isBackground:true
  - image src:inputs/IMG_7125.JPG isBackground:true fit:cover
  - script "第二天早上，在草地边发现了一朵小野花。没人给她浇水，没人给她施肥，她就开在那个不起眼的角落里。花瓣上还挂着露水，安安静静地，特别好看。"
    start:1.0
- parallel
  - audio src:assets/sfx/sfx-morning-birds.mp3 volume:0.12 isBackground:true
  - video src:inputs/IMG_7124.MOV startFrom:6 endAt:17 isBackground:true volume:0.2
  - script "收拾东西之前去湖边走了走。有人在划船，有人在说笑，湖面上漂着几只红色的小船。我把花留在原地，继续上路。五十岁，不是终点，是另一段旅程的开始。人生就像一场露营——重要的不是去了多远的地方，而是每次停下来的时候，心里是不是安静的。"
    start:1.0

## 片尾
layout:parallel
- image src:inputs/IMG_7068.JPG fit:cover duration:5
  style:"filter:brightness(0.35)"
- component duration:5
  effects:[fadeIn(2, ease-out)]
  ~~~jsx
  <div style={{display:'flex',flexDirection:'column',justifyContent:'center',alignItems:'center',height:'100%',padding:'0 60px',textAlign:'center'}}>
    <div style={{fontSize:28,fontWeight:300,color:'#fff',textShadow:'0 2px 12px rgba(0,0,0,0.5)',opacity:0.9,lineHeight:1.8}}>
      五十岁不是终点<br/>下一站，去哪里？
    </div>
    <div style={{fontSize:18,fontWeight:300,color:'#aaa',marginTop:60}}>
      2026 · 夏 · Gatineau Park
    </div>
  </div>
  ~~~
