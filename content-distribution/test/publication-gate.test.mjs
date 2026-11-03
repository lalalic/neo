import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync, appendFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { verifyPublication, canonical } from "../scripts/publication-gate.mjs";

const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const providers = JSON.parse(readFileSync(new URL("../config/providers.json", import.meta.url)));
const actualAccounts = readFileSync(new URL("../accounts.md", import.meta.url),"utf8");

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(),"cd-gate-test-"));
  t.after(()=>rmSync(root,{recursive:true,force:true}));
  const runsRoot=join(root,"runs"), runDir=join(runsRoot,"2026-11-02-fixture");
  mkdirSync(runDir,{recursive:true});
  const now=Date.parse("2026-11-02T16:00:00Z");
  const file = (name, content) => {
    const bytes = Buffer.from(content);
    writeFileSync(join(runDir,name),bytes);
    return {path:name,sha256:sha(bytes)};
  };
  const video=file("exact-revision.mp4","synthetic test fixture only");
  const rights=file("rights-document.txt","synthetic provider rights snapshot");
  const list=file("safelist-document.txt","synthetic approved safelist snapshot");
  const profile=file("profile-evidence.txt","synthetic verified clickable profile proof");
  const tracking=file("private-content-link.json",JSON.stringify({
    url:"https://reelslink.com/test-synthetic",series_id:"series-1"
  }));
  const payload={
    schema:"content-distribution.release.v1",campaign_id:"campaign-1",
    provider_id:"rs-boost",series_id:"series-1",creative_revision_id:"rev-1",
    video_path:video.path,video_sha256:video.sha256,platform:"tiktok",
    account_id:"tiktok-primary",expected_account:"lalalic001",
    visibility:"public",caption:"Test clip",publication_attempt_id:"attempt-1",
    owner_approval:{
      action:"public_post",account_id:"tiktok-primary",creative_revision_id:"rev-1",
      video_sha256:video.sha256,visibility:"public",publication_attempt_id:"attempt-1",
      link_placement:"profile",source_url:"https://chatgpt.com/c/synthetic-test",
      source_message_id:"synthetic-message-1",issued_at:"2026-11-02T15:00:00Z"
    },
    rights:{
      permission:"granted",provider_id:"rs-boost",series_id:"series-1",
      source_url:"https://cps.reelshort.com/resource-square/detail/synthetic-test",
      allowed_platforms:["tiktok"],allowed_territories:["CA"],
      edit_scope:"approved_revision",verified_at:"2026-11-02T15:00:00Z",
      document:rights
    },
    safelist:{
      status:"approved",account_id:"tiktok-primary",expected_account:"lalalic001",
      source_url:"https://cps.reelshort.com/user/safelist",
      observed_at:"2026-11-02T15:00:00Z",document:list
    },
    link:{
      provider_id:"rs-boost",series_id:"series-1",account_id:"tiktok-primary",
      placement:"profile",clickable:true,
      source_url:"https://cps.reelshort.com/resource-square/detail/synthetic-test",
      observed_at:"2026-11-02T15:00:00Z",document:tracking,
      placement_observed_at:"2026-11-02T15:00:00Z",profile_document:profile
    }
  };
  const kp = () => generateKeyPairSync("ed25519");
  const owner=kp(), reviewer=kp();
  const keys=[
    {id:"test-owner",role:"owner",public_key_pem:owner.publicKey.export({type:"spki",format:"pem"})},
    {id:"test-rights",role:"rights_reviewer",public_key_pem:reviewer.publicKey.export({type:"spki",format:"pem"})}
  ];
  const signed = (p=payload) => ({
    payload:p,
    signatures:{
      owner:{key_id:"test-owner",signature_b64:sign(null,Buffer.from(canonical(p)),owner.privateKey).toString("base64")},
      rights_reviewer:{key_id:"test-rights",signature_b64:sign(null,Buffer.from(canonical(p)),reviewer.privateKey).toString("base64")}
    }
  });
  const opts = (p=payload) => ({
    runDir,runsRoot,release:signed(p),keys,now,providers,
    accountsMarkdown:actualAccounts.replaceAll("Pending Update","Approved")
  });
  return {root,runDir,runsRoot,payload,keys,signed,opts,file};
}
test("two independently enrolled signatures and real bytes permit synthetic dry run", t=>{
  const f=fixture(t), result=verifyPublication(f.opts());
  assert.equal(result.status,"validated_not_reserved");
  assert.equal(result.webhelm_config,null);
  assert.equal(result.scope.video_sha256,f.payload.video_sha256);
  assert.equal(result.scope.expected_account,"lalalic001");
});
test("real registry Pending Update is never overwritten by fake signed approved evidence",t=>{
  const f=fixture(t);
  const o=f.opts(); o.accountsMarkdown=actualAccounts;
  assert.throws(()=>verifyPublication(o),/registry_safelist_not_approved/);
});
test("booleans, nonexistent approval_ref and wrong account ID cannot authorize",t=>{
  const f=fixture(t);
  const noEvidence=f.opts();
  noEvidence.release={payload:{...f.payload,owner_approved:true,rights_verified:true,approval_ref:"nonexistent",account_id:"wrong-account"}};
  assert.throws(()=>verifyPublication(noEvidence),/release_signature_missing|trusted_signature_missing/);
  const wrong={...f.payload,account_id:"wrong-account"};
  assert.throws(()=>verifyPublication(f.opts(wrong)),/account_id_not_in_registry/);
  const mismatch={...f.payload,expected_account:"wrong-account"};
  assert.throws(()=>verifyPublication(f.opts(mismatch)),/registry_account_mismatch/);
});
test("provider_id substitution cannot bypass rights gates",t=>{
  const f=fixture(t), p={...f.payload,provider_id:"not-rs-boost"};
  assert.throws(()=>verifyPublication(f.opts(p)),/provider_not_cleared/);
});
test("actual video bytes must match exact approved revision digest, regardless of path",t=>{
  const f=fixture(t);
  writeFileSync(join(f.runDir,f.payload.video_path),"altered video bytes at same path");
  assert.throws(()=>verifyPublication(f.opts()),/video_bytes_hash_mismatch/);
});
test("tampered signatures and same key in two roles cannot authorize",t=>{
  const f=fixture(t);
  const o=f.opts(); o.release.payload={...f.payload,visibility:"private"};
  assert.throws(()=>verifyPublication(o),/trusted_signature_invalid/);
  const dup=f.opts(); dup.keys[1]={...dup.keys[1],public_key_pem:dup.keys[0].public_key_pem};
  assert.throws(()=>verifyPublication(dup),/trusted_signature_invalid|independent_review_signature_required/);
});
test("owner approval must match exact attempt, account, hash, visibility and purpose",t=>{
  const f=fixture(t);
  for(const [field,value] of [["visibility","private"],["account_id","youtube-primary"],["video_sha256","0".repeat(64)],["publication_attempt_id","attempt-2"]]){
    const p={...f.payload,owner_approval:{...f.payload.owner_approval,[field]:value}};
    assert.throws(()=>verifyPublication(f.opts(p)),new RegExp("owner_.*mismatch"));
  }
  const p={...f.payload,owner_approval:{...f.payload.owner_approval,action:"review_preview"}};
  assert.throws(()=>verifyPublication(f.opts(p)),/owner_approval_not_publication/);
});
test("rights evidence must be affirmative, exact series, valid scope and real file digest",t=>{
  const f=fixture(t);
  const invalid=[
    {...f.payload.rights,permission:"pending"},
    {...f.payload.rights,series_id:"other"},
    {...f.payload.rights,allowed_platforms:["youtube"]},
    {...f.payload.rights,document:{...f.payload.rights.document,sha256:"0".repeat(64)}}
  ];
  for(const rights of invalid) assert.throws(()=>verifyPublication(f.opts({...f.payload,rights})),
    /rights_not_granted|rights_series_mismatch|licensed_scope_not_verified|evidence_bytes_hash_mismatch/);
});
test("Safelist must be fresh and actually approved for exact mapped account",t=>{
  const f=fixture(t);
  for(const safelist of [
    {...f.payload.safelist,status:"Pending Update"},
    {...f.payload.safelist,account_id:"wrong-account"},
    {...f.payload.safelist,observed_at:"2026-10-01T00:00:00Z"}
  ]) assert.throws(()=>verifyPublication(f.opts({...f.payload,safelist})),
    /safelist_not_approved|safelist_account_mismatch|safelist_observation_stale/);
});
test("link host, series, placement, clickability, evidence and source are required",t=>{
  const f=fixture(t);
  const link=f.payload.link;
  for(const invalid of [
    {...link,placement:"description"},
    {...link,clickable:false},
    {...link,document:{...link.document,sha256:"0".repeat(64)}},
    {...link,series_id:"different"},
    {...link,source_url:"https://example.net"}
  ]) assert.throws(()=>verifyPublication(f.opts({...f.payload,link:invalid})),
    /owner_link_placement_mismatch|link_placement_not_verified|link_clickability_not_verified|evidence_bytes_hash_mismatch|link_series_mismatch|link_source_unverified/);
});
test("path traversal or symlinks cannot make evidence leave ignored Run",t=>{
  const f=fixture(t);
  const p={...f.payload,video_path:"../../elsewhere.mp4"};
  assert.throws(()=>verifyPublication(f.opts(p)),/unsafe_private_evidence_path/);
});
test("reserve is persistent and blocks repeated id, new id with same revision and cross-run attempts",t=>{
  const f=fixture(t);
  const first=verifyPublication({...f.opts(),reserve:true});
  assert.equal(first.status,"reserved_unverified");
  assert.equal(first.webhelm_config.confirm_publish,true);
  assert.equal(first.webhelm_config.video_sha256,f.payload.video_sha256);
  assert.throws(()=>verifyPublication(f.opts()),/prior_publication_attempt_requires_manual_reconciliation/);
  const next={...f.payload,publication_attempt_id:"attempt-2",
    owner_approval:{...f.payload.owner_approval,publication_attempt_id:"attempt-2"}};
  assert.throws(()=>verifyPublication(f.opts(next)),/prior_publication_attempt_requires_manual_reconciliation/);
  // Populate a second valid Run with every approved byte and evidence file.
  // A missing file/ENOENT must not be mistaken for a cross-Run ledger test.
  const otherRun=join(f.runsRoot,"2026-11-03-other"); mkdirSync(otherRun);
  for (const name of readdirSync(f.runDir)) {
    if (name === "publication-attempts") continue;
    writeFileSync(join(otherRun,name),readFileSync(join(f.runDir,name)));
  }
  assert.throws(
    ()=>verifyPublication({...f.opts(next),runDir:otherRun}),
    /prior_publication_attempt_requires_manual_reconciliation/
  );
});

test("no independently enrolled owner key cannot authorize even synthetic status approved",t=>{
  const f=fixture(t), opts=f.opts();
  opts.keys=[];
  assert.throws(()=>verifyPublication({...opts,reserve:true}),/owner_trusted_signature_missing/);
});
test("release signatures cannot be substituted with caller booleans after signing",t=>{
  const f=fixture(t), opts=f.opts();
  opts.release.payload.owner_approved=true;
  opts.release.payload.rights_verified=true;
  opts.release.payload.approval_ref="nonexistent";
  assert.throws(()=>verifyPublication(opts),/owner_trusted_signature_invalid/);
});
