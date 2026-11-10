// Reuse an immutable E2E image only when the complete fixture/runtime content
// is unchanged between its published source commit and current checkout.
import {spawnSync} from 'node:child_process';
export function reusableFixtureImage(saved,plan,project,fixturePaths=[
  'gpu/e2e/Dockerfile','gpu/e2e/fixture.mjs','gpu/runtime/']){
  if(!saved?.published||saved.mode!==plan.mode||saved.appPort!==plan.appPort||
     !/^ghcr\.io\/[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+:sha-[a-f0-9]{12}$/.test(saved.image||'')||
     !/^[0-9a-f]{40}$/.test(saved.sourceCommit||''))return false;
  const git=args=>spawnSync('git',['-C',project,...args],{timeout:10000,stdio:'ignore'}).status;
  if(git(['merge-base','--is-ancestor',saved.sourceCommit,plan.commit])!==0)return false;
  return git(['diff','--quiet',saved.sourceCommit,plan.commit,'--',...fixturePaths])===0;
}
