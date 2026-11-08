import test from 'node:test';
import assert from 'node:assert/strict';
import {finalFilmMarkdown} from '../scripts/final-film-to-md.mjs';

const film={title:'本来拍树，最后镜头全在拍我',width:1080,height:1920,
 duration:22.848,videoSha256:'a'.repeat(64)};

test('completed Producer film becomes one stable Markcut Scene without rendering a new film',()=>{
 const md=finalFilmMarkdown(film);
 assert.equal((md.match(/^## /gm)||[]).length,1);
 assert.match(md,/^## finished-film$/m);
 assert.match(md,/^- video src:output\/video\.mp4 duration:22\.848 volume:1 fit:contain$/m);
 assert.match(md,/instruction:"Producer 已渲染的完整成片/);
 assert.equal(finalFilmMarkdown(film),md);
 assert.doesNotMatch(md,/input\/media\//);
});

test('hash identity updates deterministic seed without changing content contract',()=>{
 const first=finalFilmMarkdown(film),next=finalFilmMarkdown({...film,videoSha256:'b'.repeat(64)});
 assert.notEqual(first,next);
 assert.equal(first.replace(/^seed:\d+$/m,''),next.replace(/^seed:\d+$/m,''));
});

test('malformed dimensions, duration or media hash are rejected',()=>{
 for(const change of [{width:0},{height:0},{duration:0},{duration:Infinity},{videoSha256:'x'}])
  assert.throws(()=>finalFilmMarkdown({...film,...change}));
});
