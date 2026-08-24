---
title: "Barkley Finds His Brave"
description: "A heartwarming picture book about a shy dog who learns that confidence isn't about being the loudest — it's about taking one small step at a time."
hook: "What if the bravest thing you could do was also the smallest?"
conflict: "Barkley wants to play, but fear keeps his paws glued to the ground."
emotion: "Warm, encouraging, relatable — like a friend saying 'you've got this'."
ending: "Barkley finds his courage by helping someone else find theirs."
---

# video
seed:1334320411
width:1080 height:1920 fps:30 layout:transitionSeries transition:fade transitionTime:1.2
subtitle:{type:"Typewriter",fontSize:52,fontFamily:"Comic Neue, Patrick Hand, cursive",style:"text-shadow: 2px 2px 4px rgba(0,0,0,0.5); color: #FFE4B5"}
- audio isBackground:true src:./assets/bgm.mp3 volume:0.8

~~~css stylesheet
@import url('https://fonts.googleapis.com/css2?family=Comic+Neue:wght@400;700&family=Patrick+Hand&display=swap');

.text-glow { text-shadow: 0 0 30px rgba(255,215,0,0.3); }
.fade-soft { animation: fadeSoft 1.2s ease-out; }
.bounce-in { animation: bounceIn 0.8s ease-out; }
.wag { animation: wag 0.6s ease-in-out infinite; }

@keyframes bounceIn {
  0% { transform: scale(0.3); opacity: 0; }
  50% { transform: scale(1.05); }
  70% { transform: scale(0.9); }
  100% { transform: scale(1); opacity: 1; }
}

@keyframes fadeSoft {
  0% { opacity: 0; }
  100% { opacity: 1; }
}

@keyframes wag {
  0%, 100% { transform: rotate(-5deg); }
  50% { transform: rotate(5deg); }
}
~~~

## TitleCard
layout:parallel
description:"A beautiful sunlit park meadow with golden light streaming through oak trees. A colorful frisbee lies on the grass in the foreground. Warm, inviting atmosphere."
- image prompt:"A beautiful sunlit park meadow with soft golden morning light streaming through tall oak trees. A red frisbee rests on the green grass in the foreground. Distant rolling hills and wildflowers. Warm golden hour lighting, dreamy atmosphere, soft bokeh. No characters. Children's book illustration style, digital painting, soft warm lighting, inviting palette, detailed background." isBackground:true fit:cover style:"filter:brightness(0.45)"
- component duration:7 effects:[fadeIn(1.5, ease-out)]
  ~~~jsx jsx
  <div style="display:flex; flex-direction:column; align-items:center; justify-content:center; width:100%; height:100%; padding: 0 40px;">
    <h1 style="font-family:'Comic Neue', cursive; font-size:80px; color:#FFE4B5; text-shadow:3px 3px 10px rgba(0,0,0,0.8); text-align:center; margin-bottom:16px;">Barkley Finds<br/>His Brave</h1>
    <p style="font-family:'Patrick Hand', cursive; font-size:40px; color:#FFF8DC; text-shadow:2px 2px 6px rgba(0,0,0,0.6); text-align:center; margin-bottom:8px;">What if the bravest thing you could do</p>
    <p style="font-family:'Patrick Hand', cursive; font-size:40px; color:#FFF8DC; text-shadow:2px 2px 6px rgba(0,0,0,0.6); text-align:center; margin:0;">was also the smallest?</p>
    <p style="font-family:'Patrick Hand', cursive; font-size:32px; color:#FFE4B5; text-shadow:2px 2px 6px rgba(0,0,0,0.6); text-align:center; margin-top:20px;">A story about one small step</p>
  </div>
  ~~~

## ShyPup
layout:parallel
description:"A bright sunny park with green grass and trees. Barkley, a medium-sized cream-gold puppy with floppy ears and a white chest patch, sits behind a park bench, peeking out nervously. In the distance, three happy dogs chase a frisbee. Barkley's tail is tucked between his legs, but his eyes are filled with longing."
- image prompt:"A medium-sized cream-gold mixed-breed puppy named Barkley with soft floppy ears, one ear flopping slightly forward, big warm brown eyes, and a white patch on his chest, peeking nervously from behind a wooden park bench in a sunny meadow. Three happy dogs chase a frisbee in the distance. Barkley's tail is tucked between his legs, but his eyes are wide with longing. A gentle breeze rustles the green grass. Warm mid-morning sunlight, soft golden highlights, dappled shadows under oak trees. Storybook illustration style, digital painting, soft lighting, warm and inviting palette, detailed background." isBackground:true fit:cover effects:[fadeIn(1.5, ease-out)]
- audio src:./assets/sfx/birds-ambience.mp3 volume:0.1 isBackground:true
- script start:1.2
  ~~~script
  Barkley loved watching the dogs at the park. They chased, they bounded, they barked with joy. But every time he tried to join them, his paws felt glued to the ground. "Maybe tomorrow," he whispered.
  ~~~

## FirstTry
layout:parallel
description:"Closer view of Barkley tentatively stepping toward the play area. A large black-and-tan dog has suddenly turned and let out a loud WOOF. Barkley is caught mid-step, ears flattened, one paw lifted, ready to bolt back. The other dogs pause and look. The frisbee lies forgotten on the grass."
- image prompt:"Same cream-gold puppy Barkley caught mid-step with flattened ears and one paw lifted, ready to bolt. A large black-and-tan dog has turned abruptly, mouth open in a loud bark. Barkley's big brown eyes are wide with alarm, his white chest patch visible. Other dogs freeze and look. A colorful frisbee lies forgotten on the grass. The park background is soft-focus, emphasizing the tense standoff. Harsh noon sunlight creating sharp shadows, a moment of stillness. Storybook illustration style, digital painting, soft lighting, cinematic composition, detailed background." isBackground:true fit:cover
- audio src:./assets/sfx/dog-bark.mp3 volume:0.15 start:3.5
- audio src:./assets/sfx/birds-ambience.mp3 volume:0.08 isBackground:true
- script start:1.2
  ~~~script
  One sunny afternoon, Barkley took a step forward. Then another! But a big, booming WOOF sent him scurrying back behind the bench. His heart pounded. "I'm just not brave enough," he sighed.
  ~~~

## UnexpectedFriend
layout:parallel
description:"A quiet corner of the park near a flower bed. Barkley has discovered a tiny scruffy puppy hiding under a bush — shivering, with big worried eyes. Barkley's posture has changed: head tilted, ears perked forward gently, a soft concerned look on his face. The puppy is even smaller and more scared than Barkley."
- image prompt:"Same cream-gold puppy Barkley with head tilted, ears perked gently forward, a soft concerned look in his big brown eyes, discovering a tiny scruffy grey puppy with worried eyes hiding under a flowering bush. Barkley's white chest patch is visible as he leans in gently. Dappled afternoon sunlight filters through leaves, creating a gentle spotlight on the two dogs. A quiet corner of the park with colorful flower beds. Intimate close-up framing, tender atmosphere. Storybook illustration style, digital painting, soft warm lighting, detailed botanical background." isBackground:true fit:cover
- audio src:./assets/sfx/gentle-birds.mp3 volume:0.1 isBackground:true
- script start:1.2
  ~~~script
  Then Barkley saw something — a tiny puppy trembling under a bush, all alone. The puppy looked even more scared than Barkley felt. And for the first time, Barkley didn't think about his own fear. He just walked over, sat down gently, and said, "It's okay. I'll stay with you."
  ~~~

## BraveStep
layout:parallel
description:"Barkley and the tiny puppy are playing together — chasing a leaf, rolling in the grass, tails wagging. The puppy is giggling (a happy puppy expression). Two of the bigger dogs from earlier are watching from a few feet away, tails starting to wag too. Barkley notices but doesn't run. His tail is up for the first time."
- image prompt:"Same cream-gold puppy Barkley rolling joyfully in the grass with a tiny scruffy grey puppy, both wagging tails held high. Barkley's floppy ears bounce as he playfully pounces on a fallen leaf. His big brown eyes are bright, his mouth open in a happy pant. Two bigger dogs approach from a few feet away with friendly curiosity, their tails beginning to wag. Rich golden afternoon sunlight casting long warm shadows, grass glowing amber. Wide shot capturing the playful energy. Storybook illustration style, digital painting, warm golden lighting, detailed park background." isBackground:true fit:cover effects:[fadeIn(1.5, ease-out), bounceIn(1, ease-out)]
- audio src:./assets/sfx/birds-ambience.mp3 volume:0.1 isBackground:true
- script start:1.2
  ~~~script
  They played together — just a small chase, a rolled-over tumble. And soon, Barkley was wagging without even thinking. The other dogs noticed. One of them trotted over, tail wagging too. Barkley's heart raced — but this time, it felt different.
  ~~~

## YourTurn
layout:parallel
description:"A wide heartwarming scene: Barkley is now in the middle of the park, surrounded by all the dogs — playing, chasing, barking happily. The tiny puppy is right beside him. Barkley's head is high, ears relaxed, tail held high and wagging. The sun is starting to set with warm golden light. The boy who owns Barkley sits nearby, smiling proudly."
- image prompt:"Same cream-gold puppy Barkley now standing confidently in the middle of the park, surrounded by all the dogs playing, chasing, and barking happily. His ears are relaxed, his tail held high and wagging, his big brown eyes shining with joy. The tiny scruffy grey puppy stays right beside him. The boy who owns Barkley sits on a nearby bench, watching with a proud smile. Sunset golden hour with warm amber and rose light washing over the scene, long soft shadows. Triumphant heartwarming atmosphere. Storybook illustration style, digital painting, soft golden sunset lighting, cinematic wide panorama, detailed background." isBackground:true fit:cover effects:[fadeIn(1.5, ease-out)]
- audio src:./assets/sfx/birds-ambience.mp3 volume:0.1 isBackground:true
- script start:1.2
  ~~~script
  Confidence isn't about being the loudest or the fastest. It's about taking one tiny step. And sometimes, the bravest thing you can do is help someone else feel brave too. So — what's your one small step going to be?
  ~~~

## EndingCard
layout:parallel
description:"A peaceful golden sunset over a park. Warm amber and rose light fills the sky. A wooden bench sits under a large oak tree. Peaceful, reflective atmosphere."
- image prompt:"A peaceful golden sunset over a quiet park meadow. Warm amber and rose light fills the sky with soft clouds. A wooden bench sits under a large oak tree, leaves gently rustling. Fireflies begin to glow in the fading light. Peaceful, reflective atmosphere, no characters. Children's book illustration style, digital painting, soft golden sunset lighting, dreamy atmosphere, detailed background." isBackground:true fit:cover style:"filter:brightness(0.45)"
- component duration:6 effects:[fadeIn(2, ease-out)]
  ~~~jsx jsx
  <div style="display:flex; flex-direction:column; align-items:center; justify-content:center; width:100%; height:100%; padding: 0 40px;">
    <h2 style="font-family:'Comic Neue', cursive; font-size:64px; color:#FFE4B5; text-shadow:3px 3px 10px rgba(0,0,0,0.8); text-align:center; margin-bottom:20px;">What's your<br/>one small step?</h2>
    <p style="font-family:'Patrick Hand', cursive; font-size:32px; color:#FFF; text-shadow:2px 2px 6px rgba(0,0,0,0.6); text-align:center;">Share your brave story</p>
  </div>
  ~~~
