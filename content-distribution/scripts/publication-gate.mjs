import {readFileSync,readdirSync,mkdirSync,openSync,writeFileSync,closeSync,fsyncSync,unlinkSync,realpathSync} from "node:fs";
import {isAbsolute,join,resolve,sep,dirname} from "node:path";
import {createHash,createPublicKey,verify} from "node:crypto";

const hash = b => createHash("sha256").update(b).digest("hex");
const required = (v,e) => {if(!v)throw Error(e);return v;};
const eq = (a,b,e) => {if(a!==b)throw Error(e);};
const timestamp = (s,e) => {const t=Date.parse(s);if(!Number.isFinite(t))throw Error(e);return t;};
const child = (root,path) => {
  if(typeof path!=="string"||!path||isAbsolute(path)||path.split(/[\\/]/).includes(".."))throw Error("unsafe_private_evidence_path");
  const base=realpathSync(root),physical=realpathSync(resolve(base,path));
  if(!physical.startsWith(base+sep))throw Error("evidence_outside_run");
  return physical;
};
const json = p => JSON.parse(readFileSync(p,"utf8"));
export const canonical = v => JSON.stringify(v,(_k,x)=>
  x&&typeof x==="object"&&!Array.isArray(x)?Object.fromEntries(Object.entries(x).sort(([a],[b])=>a.localeCompare(b))):x);
const attachment = (run,ref) => {
  if(!ref||!/^[0-9a-f]{64}$/.test(ref.sha256||""))throw Error("evidence_hash_missing");
  const bytes=readFileSync(child(run,ref.path));
  if(!bytes.length||hash(bytes)!==ref.sha256)throw Error("evidence_bytes_hash_mismatch");
  return bytes;
};
const url = (value,host,error) => {
  let u;try{u=new URL(value);}catch{throw Error(error);}
  if(u.protocol!=="https:"||u.hostname!==host||u.username||u.password)throw Error(error);
  return u;
};
function ownerApproval(run,path,keys,now){
  const record=json(child(run,path));
  eq(record.schema,"content-distribution.campaign-authorization.v1","campaign_authorization_schema_invalid");
  const a=required(record.payload,"campaign_authorization_missing");
  eq(a.action,"campaign_publication","owner_approval_not_publication");
  if(!a.campaign_id||!a.provider_id||!a.series_id||!a.source_message_id)throw Error("campaign_approval_scope_missing");
  const source=url(a.source_url,"chatgpt.com","campaign_approval_source_invalid");
  if(!source.pathname.startsWith("/c/"))throw Error("campaign_approval_source_invalid");
  if(timestamp(a.issued_at,"campaign_approval_date_invalid")>now+30000)throw Error("campaign_approval_future");
  if(a.expires_at&&timestamp(a.expires_at,"campaign_approval_expiry_invalid")<now)throw Error("campaign_approval_expired");
  for(const key of ["account_ids","allowed_visibilities","allowed_edit_types","allowed_link_placements"])
    if(!Array.isArray(a[key])||!a[key].length)throw Error("campaign_approval_scope_missing");
  const key=keys.find(k=>k.role==="owner"&&k.id===record.signature?.key_id);
  if(!key?.public_key_pem||!record.signature?.signature_b64)throw Error("owner_trusted_signature_missing");
  if(!verify(null,Buffer.from(canonical(a)),createPublicKey(key.public_key_pem),Buffer.from(record.signature.signature_b64,"base64")))
    throw Error("owner_trusted_signature_invalid");
  return a;
}
function accountRegistry(md,id){
  const tick=String.fromCharCode(96);
  const row=md.split("\n").find(line=>line.startsWith("|")&&line.split("|").map(s=>s.trim())[1]===tick+id+tick);
  if(!row)throw Error("account_id_not_in_registry");
  const cols=row.split("|").slice(1,-1).map(s=>s.trim());
  const platform=/tiktok/i.test(cols[1])?"tiktok":/youtube/i.test(cols[1])?"youtube":null;
  if(!platform)throw Error("unknown_registry_platform");
  const observedStatus=cols[5].replace(/\*/g,"").trim();
  const safelistStatus=["Approved","Pending Update"].includes(observedStatus)?observedStatus:null;
  if(!safelistStatus)throw Error("safelist_filing_or_status_unverified");
  const expected=platform==="tiktok"?cols[2].match(/@([A-Za-z0-9_.]+)/)?.[1]:
    md.match(new RegExp("YouTube's public channel ID is "+tick+"(UC[A-Za-z0-9_-]+)"+tick))?.[1];
  if(!expected)throw Error("registry_account_mapping_unverified");
  return {platform,expected,safelistStatus};
}
function bundle(p,{run,approval,accountsMarkdown,providers,now}){
  eq(p.schema,"content-distribution.release.v2","unsupported_release_schema");
  if(!p.campaign_id||!p.series_id||!p.creative_revision_id)throw Error("release_identity_missing");
  if(!providers.providers.some(x=>x.id===p.provider_id&&x.stage==="first-pilot")||p.provider_id!=="rs-boost")
    throw Error("provider_not_cleared");
  for(const k of ["campaign_id","provider_id","series_id"])eq(p[k],approval[k],"campaign_approval_"+k+"_mismatch");
  if(!approval.account_ids.includes(p.account_id))throw Error("campaign_account_not_authorized");
  if(!approval.allowed_visibilities.includes(p.visibility))throw Error("campaign_visibility_not_authorized");
  if(!approval.allowed_edit_types.includes(p.edit_type))throw Error("campaign_edit_not_authorized");
  const registry=accountRegistry(accountsMarkdown,p.account_id);
  eq(p.platform,registry.platform,"registry_platform_mismatch");
  eq(p.expected_account,registry.expected,"registry_account_mismatch");
  const allowed=registry.platform==="tiktok"?["public","friends","private"]:["public","unlisted","private"];
  if(!allowed.includes(p.visibility))throw Error("visibility_invalid");
  if(!/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(p.publication_attempt_id||""))throw Error("publication_attempt_id_invalid");
  if((p.platform==="tiktok"&&!p.caption?.trim())||(p.platform==="youtube"&&!p.title?.trim()))
    throw Error("publication_text_missing");
  if(!/^[0-9a-f]{64}$/.test(p.video_sha256||""))throw Error("video_sha256_missing");
  const campaign=json(child(run,"campaign.json"));
  eq(campaign.campaign_id,p.campaign_id,"campaign_id_mismatch");
  eq(campaign.provider_id,p.provider_id,"campaign_provider_mismatch");
  if(!campaign.target_account_ids?.includes(p.account_id))throw Error("campaign_target_not_listed");
  const creative=campaign.creatives?.find(x=>x.id===p.creative_revision_id);
  if(!creative||!["qa_passed","approved"].includes(creative.status))
    throw Error("creative_not_rendered_or_qa_ready");
  const folder=dirname(child(run,creative.video_path));
  const video=child(run,p.video_path);
  if(dirname(video)!==folder||!/\.mp4$/i.test(video)||!video.includes(sep+"creatives"+sep))
    throw Error("release_not_from_campaign_creative");
  if(hash(readFileSync(video))!==p.video_sha256)throw Error("video_bytes_hash_mismatch");
  const rights=required(p.rights,"rights_evidence_missing");
  eq(rights.permission,"granted","rights_not_granted");
  eq(rights.provider_id,p.provider_id,"rights_provider_mismatch");
  eq(rights.series_id,p.series_id,"rights_series_mismatch");
  if(!rights.allowed_platforms?.includes(p.platform)||!Array.isArray(rights.allowed_territories)||!rights.allowed_territories.length)
    throw Error("licensed_scope_not_verified");
  url(rights.source_url,"cps.reelshort.com","rights_source_unverified");
  attachment(run,rights.document);
  if(timestamp(rights.verified_at,"rights_verified_at_invalid")>now+30000)throw Error("rights_verification_future");
  if(rights.expires_at&&timestamp(rights.expires_at,"rights_expiry_invalid")<now)throw Error("rights_expired");
  if(p.edit_type==="standard_clip"){
    if(!["standard_promotion","narration_with_consent"].includes(rights.edit_scope))throw Error("licensed_scope_not_verified");
  }else if(p.edit_type==="narration_with_consent"){
    if(rights.edit_scope!=="narration_with_consent"||!rights.special_consent_document||!rights.special_consent_source_url)
      throw Error("special_edit_consent_missing");
    attachment(run,rights.special_consent_document);
    url(rights.special_consent_source_url,"cps.reelshort.com","special_edit_consent_source_invalid");
  }else throw Error("unrecognized_edit_type");
  const link=required(p.link,"link_evidence_missing");
  for(const k of ["provider_id","series_id","account_id"])eq(link[k],p[k],"link_"+k+"_mismatch");
  if(!approval.allowed_link_placements.includes(link.placement)||
    !["profile","channel_profile","description","pinned_comment","other_disclosed"].includes(link.placement))
    throw Error("link_placement_not_authorized");
  url(link.source_url,"cps.reelshort.com","link_source_unverified");
  const tracking=json(child(run,link.document?.path));
  attachment(run,link.document);
  url(tracking.url,"reelslink.com","tracking_link_invalid");
  eq(tracking.series_id,p.series_id,"tracking_link_series_mismatch");
  const warnings=[];
  if(registry.safelistStatus!=="Approved")warnings.push("safelist_pending_monetization_unverified");
  if(link.clickable!==true)warnings.push("tracking_link_clickability_unverified");
  return {platform:p.platform,account_id:p.account_id,expected_account:registry.expected,
    video_path:video,video_sha256:p.video_sha256,publication_attempt_id:p.publication_attempt_id,
    creative_revision_id:p.creative_revision_id,title:p.title||null,caption:p.caption||null,
    visibility:p.visibility,warnings};
}
function attempts(root,out=[]){
  for(const item of readdirSync(root,{withFileTypes:true})){
    if(!item.isDirectory()||item.isSymbolicLink()||item.name.startsWith("."))continue;
    const d=join(root,item.name);
    if(item.name==="publication-attempts"){
      for(const file of readdirSync(d,{withFileTypes:true})){
        if(!file.isFile()||!file.name.endsWith(".json"))throw Error("unknown_attempt_ledger_entry");
        out.push(json(join(d,file.name)));
      }
    }else attempts(d,out);
  }
  return out;
}
export function verifyPublication({runDir,runsRoot,release,keys,accountsMarkdown,providers,now=Date.now(),reserve=false}){
  const run=realpathSync(runDir),root=realpathSync(runsRoot);
  if(!run.startsWith(root+sep))throw Error("run_not_under_canonical_runs_root");
  eq(release.schema,"content-distribution.release-envelope.v2","unsupported_release_envelope");
  const p=required(release.payload,"release_payload_missing");
  const approval=ownerApproval(run,release.authorization_path,keys,now);
  const scope=bundle(p,{run,approval,accountsMarkdown,providers,now});
  const conflict=()=>attempts(root).some(a=>a.publication_attempt_id===scope.publication_attempt_id||
    (a.account_id===scope.account_id&&a.platform===scope.platform&&
      (a.video_sha256===scope.video_sha256||a.creative_revision_id===scope.creative_revision_id)));
  if(conflict())throw Error("prior_publication_attempt_requires_manual_reconciliation");
  if(reserve){
    const lock=join(root,".publication-reserve.lock");
    let fd;try{fd=openSync(lock,"wx",0o600);}catch{throw Error("attempt_ledger_busy_or_stale_lock");}
    try{
      if(conflict())throw Error("prior_publication_attempt_requires_manual_reconciliation");
      const dir=join(run,"publication-attempts");
      mkdirSync(dir,{recursive:true,mode:0o700});
      const f=openSync(join(dir,hash(scope.publication_attempt_id)+".json"),"wx",0o600);
      try{
        const receipt={...scope,video_path:undefined,title:undefined,caption:undefined};
        writeFileSync(f,JSON.stringify({schema:"content-distribution.attempt.v1",status:"reserved_unverified",
          reserved_at:new Date(now).toISOString(),...receipt},null,2)+"\n");
        fsyncSync(f);
      }finally{closeSync(f);}
    }finally{closeSync(fd);unlinkSync(lock);}
  }
  return {status:reserve?"reserved_unverified":"validated_not_reserved",
    business_validation:"campaign_owner_authorization_checked",scope,
    webhelm_config:reserve?{confirm_publish:true,video:scope.video_path,visibility:scope.visibility,
      expected_account:scope.expected_account,publication_attempt_id:scope.publication_attempt_id,
      creative_revision_id:scope.creative_revision_id,video_sha256:scope.video_sha256,
      ...(scope.title?{title:scope.title}:{}),...(scope.caption?{caption:scope.caption}:{})}:null};
}
