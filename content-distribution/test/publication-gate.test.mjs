import test from "node:test";
import assert from "node:assert/strict";
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync,cpSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {createHash,generateKeyPairSync,sign} from "node:crypto";
import {verifyPublication,canonical} from "../scripts/publication-gate.mjs";

const digest=b=>createHash("sha256").update(b).digest("hex");
const providers=JSON.parse(readFileSync(new URL("../config/providers.json",import.meta.url)));
const accounts=readFileSync(new URL("../accounts.md",import.meta.url),"utf8");
function fixture(t){
  const root=mkdtempSync(join(tmpdir(),"cd-campaign-release-"));
  t.after(()=>rmSync(root,{recursive:true,force:true}));
  const runsRoot=join(root,"runs"),runDir=join(runsRoot,"2026-11-03-fixture");
  mkdirSync(join(runDir,"creatives","v1"),{recursive:true});
  mkdirSync(join(runDir,"creatives","v2"),{recursive:true});
  mkdirSync(join(runDir,"evidence"));
  const save=(rel,data)=>{const bytes=Buffer.from(data);writeFileSync(join(runDir,rel),bytes);return {path:rel,sha256:digest(bytes)};};
  const video=save("creatives/v1/preview.mp4","synthetic promotional video");
  save("creatives/v1/video.md","# Test revision");
  const second=save("creatives/v2/preview.mp4","different synthetic clip");
  save("creatives/v2/video.md","# Next test revision");
  const rights=save("evidence/rights.txt","synthetic official terms and selected materials");
  const special=save("evidence/special-consent.txt","synthetic permission for dubbing");
  const tracking=save("evidence/private-link.json",JSON.stringify({url:"https://reelslink.com/test-no-real-token",series_id:"series-1"}));
  writeFileSync(join(runDir,"campaign.json"),JSON.stringify({
    campaign_id:"campaign-1",provider_id:"rs-boost",target_account_ids:["tiktok-primary","youtube-primary"],
    creatives:[{id:"v1",video_path:"creatives/v1/video.md",status:"qa_passed"},
      {id:"v2",video_path:"creatives/v2/video.md",status:"qa_passed"}]
  }));
  const owner=generateKeyPairSync("ed25519");
  const keys=[{id:"owner-1",role:"owner",public_key_pem:owner.publicKey.export({type:"spki",format:"pem"})}];
  const approval={action:"campaign_publication",campaign_id:"campaign-1",provider_id:"rs-boost",series_id:"series-1",
    account_ids:["tiktok-primary","youtube-primary"],allowed_visibilities:["public","private"],
    allowed_edit_types:["standard_clip"],allowed_link_placements:["profile","description"],
    source_url:"https://chatgpt.com/c/synthetic-not-real",source_message_id:"fake-test-message",
    issued_at:"2026-11-03T09:00:00Z"};
  const signApproval=(a=approval,key=owner)=>{
    writeFileSync(join(runDir,"campaign-authorization.json"),JSON.stringify({
      schema:"content-distribution.campaign-authorization.v1",payload:a,
      signature:{key_id:"owner-1",signature_b64:sign(null,Buffer.from(canonical(a)),key.privateKey).toString("base64")}
    }));
  };
  signApproval();
  const payload={schema:"content-distribution.release.v2",campaign_id:"campaign-1",provider_id:"rs-boost",
    series_id:"series-1",creative_revision_id:"v1",video_path:video.path,video_sha256:video.sha256,
    platform:"tiktok",account_id:"tiktok-primary",expected_account:"lalalic001",
    visibility:"public",caption:"Distinct promo clip",publication_attempt_id:"attempt-1",
    edit_type:"standard_clip",
    rights:{permission:"granted",provider_id:"rs-boost",series_id:"series-1",source_url:"https://cps.reelshort.com/user/agreement",
      allowed_platforms:["tiktok","youtube"],allowed_territories:["CA"],edit_scope:"standard_promotion",
      verified_at:"2026-11-02T15:00:00Z",document:rights},
    link:{provider_id:"rs-boost",series_id:"series-1",account_id:"tiktok-primary",placement:"description",
      clickable:false,source_url:"https://cps.reelshort.com/resource-square/detail/synthetic",
      document:tracking}};
  const release=p=>({schema:"content-distribution.release-envelope.v2",
    authorization_path:"campaign-authorization.json",payload:p});
  const opts=(p=payload)=>({runDir,runsRoot,release:release(p),keys,accountsMarkdown:accounts,providers,
    now:Date.parse("2026-11-03T14:00:00Z")});
  return {runDir,runsRoot,payload,video,second,rights,special,tracking,keys,owner,approval,signApproval,release,opts};
}
test("one campaign authorization applies to multiple clips without per-video approval",t=>{
  const f=fixture(t);
  const first=verifyPublication(f.opts());
  assert.equal(first.status,"validated_not_reserved");
  assert.ok(first.scope.warnings.includes("safelist_pending_monetization_unverified"));
  assert.ok(first.scope.warnings.includes("tracking_link_clickability_unverified"));
  const second={...f.payload,creative_revision_id:"v2",video_path:f.second.path,
    video_sha256:f.second.sha256,publication_attempt_id:"attempt-2"};
  assert.equal(verifyPublication(f.opts(second)).status,"validated_not_reserved");
});
test("no authorization, no owner key, or forged approval cannot publish",t=>{
  const f=fixture(t);
  assert.throws(()=>verifyPublication({...f.opts(),keys:[]}),/owner_trusted_signature_missing/);
  const invalid={...f.approval,source_message_id:"forged-after-signing"};
  writeFileSync(join(f.runDir,"campaign-authorization.json"),JSON.stringify({
    schema:"content-distribution.campaign-authorization.v1",payload:invalid,
    signature:{key_id:"owner-1",signature_b64:"fake"}}));
  assert.throws(()=>verifyPublication(f.opts()),/owner_trusted_signature_invalid/);
  f.signApproval({...f.approval,action:"review_preview"});
  assert.throws(()=>verifyPublication(f.opts()),/owner_approval_not_publication/);
});
test("campaign grant is confined to series, account, edit type, visibility and approved placements",t=>{
  const f=fixture(t);
  const variants=[
    [{...f.payload,series_id:"other"},/campaign_approval_series_id_mismatch/],
    [{...f.payload,account_id:"youtube-primary"},/registry_platform_mismatch/],
    [{...f.payload,visibility:"friends"},/campaign_visibility_not_authorized/],
    [{...f.payload,edit_type:"narration_with_consent"},/campaign_edit_not_authorized/],
    [{...f.payload,link:{...f.payload.link,placement:"pinned_comment"}},/link_placement_not_authorized/]
  ];
  for(const [p,re] of variants)assert.throws(()=>verifyPublication(f.opts(p)),re);
});
test("normal promotional editing does not require extra episode reviewer or safelist approved",t=>{
  const f=fixture(t);
  assert.equal(verifyPublication(f.opts()).business_validation,"campaign_owner_authorization_checked");
  assert.throws(()=>verifyPublication({...f.opts(),accountsMarkdown:accounts.replaceAll("Pending Update","Rejected")}),
    /safelist_filing_or_status_unverified/);
});
test("restricted narration needs separate written provider consent",t=>{
  const f=fixture(t);
  f.signApproval({...f.approval,allowed_edit_types:["standard_clip","narration_with_consent"]});
  assert.throws(()=>verifyPublication(f.opts({...f.payload,edit_type:"narration_with_consent"})),
    /special_edit_consent_missing/);
  const p={...f.payload,edit_type:"narration_with_consent",rights:{...f.payload.rights,
    edit_scope:"narration_with_consent",special_consent_document:f.special,
    special_consent_source_url:"https://cps.reelshort.com/user/agreement"}};
  assert.equal(verifyPublication(f.opts(p)).status,"validated_not_reserved");
  assert.throws(()=>verifyPublication(f.opts({...p,rights:{...p.rights,special_consent_document:{...f.special,sha256:"0".repeat(64)}}})),
    /evidence_bytes_hash_mismatch/);
});
test("source, link, video bytes and creative ownership are checked",t=>{
  const f=fixture(t);
  assert.throws(()=>verifyPublication(f.opts({...f.payload,rights:{...f.payload.rights,document:{...f.rights,sha256:"0".repeat(64)}}})),
    /evidence_bytes_hash_mismatch/);
  assert.throws(()=>verifyPublication(f.opts({...f.payload,link:{...f.payload.link,series_id:"other"}})),
    /link_series_id_mismatch/);
  assert.throws(()=>verifyPublication(f.opts({...f.payload,video_path:"../../elsewhere.mp4"})),
    /unsafe_private_evidence_path/);
  writeFileSync(join(f.runDir,f.video.path),"tampered bytes");
  assert.throws(()=>verifyPublication(f.opts()),/video_bytes_hash_mismatch/);
});
test("one campaign grant permits future posts but an attempted revision cannot be blindly retried",t=>{
  const f=fixture(t);
  const p=verifyPublication({...f.opts(),reserve:true});
  assert.equal(p.status,"reserved_unverified");
  assert.equal(p.webhelm_config.video_sha256,f.video.sha256);
  assert.equal(p.scope.warnings.length,2);
  assert.throws(()=>verifyPublication(f.opts()),/prior_publication_attempt_requires_manual_reconciliation/);
  const newAttempt={...f.payload,publication_attempt_id:"attempt-2"};
  assert.throws(()=>verifyPublication(f.opts(newAttempt)),/prior_publication_attempt_requires_manual_reconciliation/);
  const next={...newAttempt,creative_revision_id:"v2",video_path:f.second.path,video_sha256:f.second.sha256};
  assert.equal(verifyPublication(f.opts(next)).status,"validated_not_reserved");
  // Another Run must still honor all prior attempts from the canonical ledger.
  const secondRun=join(f.runsRoot,"2026-11-04-another-run");
  cpSync(f.runDir,secondRun,{recursive:true,filter:p=>!p.includes("publication-attempts")});
  assert.throws(()=>verifyPublication({...f.opts(newAttempt),runDir:secondRun}),
    /prior_publication_attempt_requires_manual_reconciliation/);
});
test("v1 per-video signatures cannot bypass new campaign-scope consent",t=>{
  const f=fixture(t);
  assert.throws(()=>verifyPublication({...f.opts(),release:{payload:f.payload,signatures:{owner:{}}}}),
    /unsupported_release_envelope/);
});
test("preview alone is not audio/video QA for automatic publication",t=>{
  const f=fixture(t);
  const campaign=JSON.parse(readFileSync(join(f.runDir,"campaign.json"),"utf8"));
  campaign.creatives[0].status="previewed";
  writeFileSync(join(f.runDir,"campaign.json"),JSON.stringify(campaign));
  assert.throws(()=>verifyPublication(f.opts()),/creative_not_rendered_or_qa_ready/);
});
test("official worldwide promotional scope is not limited to Canada",t=>{
  const f=fixture(t);
  const p={...f.payload,rights:{...f.payload.rights,allowed_territories:["worldwide"]}};
  assert.equal(verifyPublication(f.opts(p)).status,"validated_not_reserved");
});
