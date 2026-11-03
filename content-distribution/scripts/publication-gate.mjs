import {
  readFileSync, readdirSync, mkdirSync, openSync, writeFileSync,
  closeSync, fsyncSync, unlinkSync, realpathSync
} from "node:fs";
import { isAbsolute, join, resolve, sep } from "node:path";
import { createHash, createPublicKey, verify } from "node:crypto";

const sha = (b) => createHash("sha256").update(b).digest("hex");
const requireValue = (x, reason) => { if (!x) throw new Error(reason); return x; };
const requireEq = (a, b, reason) => { if (a !== b) throw new Error(reason); };
const fresh = (s, now, reason, hours = 24) => {
  const t = Date.parse(s);
  if (!Number.isFinite(t) || now - t > hours*3600000 || t - now > 30000) throw new Error(reason);
};
const safeChild = (parent, name) => {
  if (typeof name !== "string" || !name || isAbsolute(name) || name.split(/[\\/]/).includes(".."))
    throw new Error("unsafe_private_evidence_path");
  const p = resolve(parent, name);
  const base = realpathSync(parent), physical = realpathSync(p);
  if (!physical.startsWith(base + sep) || physical === base) throw new Error("evidence_outside_run");
  return physical;
};
const readJson = (p) => JSON.parse(readFileSync(p, "utf8"));
export const canonical = (v) => JSON.stringify(v, (_key, value) =>
  value && typeof value === "object" && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value).sort(([a],[b]) => a.localeCompare(b)))
    : value
);
const validateAttachment = (dir, ref) => {
  requireValue(ref && /^[0-9a-f]{64}$/.test(ref.sha256), "evidence_hash_missing");
  const bytes = readFileSync(safeChild(dir, ref.path));
  if (!bytes.length || sha(bytes) !== ref.sha256) throw new Error("evidence_bytes_hash_mismatch");
  return bytes;
};
function verifyRole(signature, role, keys, data) {
  const key = keys.find(k => k.id === signature?.key_id && k.role === role);
  if (!key?.public_key_pem || !signature?.signature_b64) throw new Error(role + "_trusted_signature_missing");
  if (!verify(null, Buffer.from(canonical(data)), createPublicKey(key.public_key_pem),
    Buffer.from(signature.signature_b64, "base64"))) {
    throw new Error(role + "_trusted_signature_invalid");
  }
  return key.id;
}
function accounts(md, accountId) {
  const row = md.split("\n").find(line => line.startsWith("|") &&
    line.split("|").map(s => s.trim())[1] === "`" + accountId + "`");
  if (!row) throw new Error("account_id_not_in_registry");
  const cols = row.split("|").slice(1,-1).map(x => x.trim());
  const platform = cols[1].toLowerCase().includes("tiktok") ? "tiktok"
    : cols[1].toLowerCase().includes("youtube") ? "youtube" : null;
  if (!platform) throw new Error("unknown_registry_platform");
  if (!/\bApproved\b/i.test(cols[5]) || /pending/i.test(cols[5])) {
    throw new Error("registry_safelist_not_approved");
  }
  const expected = platform === "tiktok" ? cols[2].match(/@([A-Za-z0-9_.]+)/)?.[1]
    : md.match(/YouTube's public channel ID is `(UC[A-Za-z0-9_-]+)`/)?.[1];
  if (!expected) throw new Error("registry_account_mapping_unverified");
  return { platform, expected };
}
const validateUrl = (uri, host, reason, prefix = "/") => {
  let u; try { u = new URL(uri); } catch { throw new Error(reason); }
  if (u.protocol !== "https:" || u.hostname !== host || !u.pathname.startsWith(prefix) || u.username || u.password)
    throw new Error(reason);
};
function checkBundle(payload, { runDir, keys, accountsMarkdown, providers, now }) {
  requireEq(payload.schema, "content-distribution.release.v1", "unsupported_release_schema");
  if (!payload.campaign_id || !payload.series_id || !payload.creative_revision_id)
    throw new Error("release_identity_missing");
  const provider = providers.providers.find(p => p.id === payload.provider_id && p.stage === "first-pilot");
  if (!provider || payload.provider_id !== "rs-boost") throw new Error("provider_not_cleared");
  const registry = accounts(accountsMarkdown, payload.account_id);
  requireEq(payload.platform, registry.platform, "registry_platform_mismatch");
  requireEq(payload.expected_account, registry.expected, "registry_account_mismatch");
  const allowed = registry.platform === "tiktok" ? ["public", "friends", "private"] : ["public", "unlisted", "private"];
  if (!allowed.includes(payload.visibility)) throw new Error("visibility_invalid");
  if (typeof payload.publication_attempt_id !== "string" ||
      !/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(payload.publication_attempt_id))
    throw new Error("publication_attempt_id_invalid");
  if (!payload.caption?.trim() && payload.platform === "tiktok" ||
      !payload.title?.trim() && payload.platform === "youtube")
    throw new Error("publication_text_missing");
  if (!/^[0-9a-f]{64}$/.test(payload.video_sha256 || "")) throw new Error("video_sha256_missing");
  const path = safeChild(runDir, payload.video_path);
  if (!/\.mp4$/i.test(path)) throw new Error("video_format_unverified");
  if (sha(readFileSync(path)) !== payload.video_sha256) throw new Error("video_bytes_hash_mismatch");

  const a = requireValue(payload.owner_approval, "owner_approval_missing");
  requireEq(a.action, "public_post", "owner_approval_not_publication");
  requireEq(a.account_id, payload.account_id, "owner_account_mismatch");
  requireEq(a.creative_revision_id, payload.creative_revision_id, "owner_revision_mismatch");
  requireEq(a.video_sha256, payload.video_sha256, "owner_video_hash_mismatch");
  requireEq(a.visibility, payload.visibility, "owner_visibility_mismatch");
  requireEq(a.publication_attempt_id, payload.publication_attempt_id, "owner_attempt_mismatch");
  requireEq(a.link_placement, payload.link?.placement, "owner_link_placement_mismatch");
  validateUrl(a.source_url, "chatgpt.com", "owner_source_unverified", "/c/");
  requireValue(a.source_message_id, "owner_message_id_missing");
  fresh(a.issued_at, now, "owner_approval_stale", 168);

  const rights = requireValue(payload.rights, "rights_evidence_missing");
  requireEq(rights.permission, "granted", "rights_not_granted");
  requireEq(rights.provider_id, payload.provider_id, "rights_provider_mismatch");
  requireEq(rights.series_id, payload.series_id, "rights_series_mismatch");
  if (!Array.isArray(rights.allowed_platforms) || !rights.allowed_platforms.includes(payload.platform) ||
      !Array.isArray(rights.allowed_territories) || !rights.allowed_territories.includes("CA") ||
      rights.edit_scope !== "approved_revision") throw new Error("licensed_scope_not_verified");
  validateUrl(rights.source_url, "cps.reelshort.com", "rights_source_unverified");
  fresh(rights.verified_at, now, "rights_evidence_stale", 168);
  validateAttachment(runDir, rights.document);

  const list = requireValue(payload.safelist, "safelist_evidence_missing");
  requireEq(list.status, "approved", "safelist_not_approved");
  requireEq(list.account_id, payload.account_id, "safelist_account_mismatch");
  requireEq(list.expected_account, payload.expected_account, "safelist_identity_mismatch");
  validateUrl(list.source_url, "cps.reelshort.com", "safelist_source_unverified");
  fresh(list.observed_at, now, "safelist_observation_stale");
  validateAttachment(runDir, list.document);

  const link = requireValue(payload.link, "link_evidence_missing");
  requireEq(link.provider_id, payload.provider_id, "link_provider_mismatch");
  requireEq(link.series_id, payload.series_id, "link_series_mismatch");
  requireEq(link.account_id, payload.account_id, "link_account_mismatch");
  requireEq(link.placement, "profile", "link_placement_not_verified");
  requireEq(link.clickable, true, "link_clickability_not_verified");
  validateUrl(link.source_url, "cps.reelshort.com", "link_source_unverified");
  fresh(link.observed_at, now, "link_observation_stale");
  const trackingBytes = validateAttachment(runDir, link.document);
  let tracking; try { tracking = JSON.parse(trackingBytes.toString("utf8")); } catch { throw new Error("tracking_link_invalid"); }
  validateUrl(tracking.url, "reelslink.com", "tracking_link_invalid");
  requireEq(tracking.series_id, payload.series_id, "tracking_link_series_mismatch");
  fresh(link.placement_observed_at, now, "profile_link_observation_stale");
  validateAttachment(runDir, link.profile_document);
  if (payload.platform === "youtube" && link.placement !== "profile")
    throw new Error("shorts_description_unclickable");
  return { platform: payload.platform, account_id:payload.account_id, expected_account:registry.expected,
    video_path:path, video_sha256:payload.video_sha256,
    publication_attempt_id:payload.publication_attempt_id, creative_revision_id:payload.creative_revision_id,
    title:payload.title || null, caption:payload.caption || null, visibility:payload.visibility };
}
function walkRuns(root, out = []) {
  for (const e of readdirSync(root,{withFileTypes:true})) {
    if (!e.isDirectory() || e.isSymbolicLink() || e.name.startsWith(".")) continue;
    const p=join(root,e.name);
    if (e.name === "publication-attempts") {
      for (const f of readdirSync(p,{withFileTypes:true})) {
        if (!f.isFile() || !f.name.endsWith(".json")) throw new Error("unknown_attempt_ledger_entry");
        out.push(readJson(join(p,f.name)));
      }
    } else walkRuns(p,out);
  }
  return out;
}
export function verifyPublication({runDir, runsRoot, release, keys, accountsMarkdown, providers, now=Date.now(), reserve=false}) {
  const run = realpathSync(runDir), root=realpathSync(runsRoot);
  if (!run.startsWith(root + sep)) throw new Error("run_not_under_canonical_runs_root");
  if (keys.some(k => !["owner","rights_reviewer"].includes(k.role))) throw new Error("unrecognized_trust_key_role");
  const payload = release.payload;
  requireValue(payload && release.signatures, "release_signature_missing");
  // Signatures cover every field and every evidence SHA. Owner and rights
  // reviewer must use independently enrolled, distinct trusted keys.
  const owner = verifyRole(release.signatures.owner, "owner", keys, payload);
  const reviewer = verifyRole(release.signatures.rights_reviewer, "rights_reviewer", keys, payload);
  if (owner === reviewer ||
      keys.find(k => k.id === owner)?.public_key_pem === keys.find(k => k.id === reviewer)?.public_key_pem)
    throw new Error("independent_review_signature_required");
  const scope = checkBundle(payload,{runDir:run,keys,accountsMarkdown,providers,now});
  const conflict = (attempts) => attempts.some(a =>
    a.publication_attempt_id === scope.publication_attempt_id ||
    (a.account_id === scope.account_id && a.platform === scope.platform &&
      (a.video_sha256 === scope.video_sha256 || a.creative_revision_id === scope.creative_revision_id)));
  const examine=() => { if (conflict(walkRuns(root))) throw new Error("prior_publication_attempt_requires_manual_reconciliation"); };
  examine();
  if (reserve) {
    const lock = join(root, ".publication-reserve.lock");
    let fd;
    try { fd=openSync(lock,"wx",0o600); } catch { throw new Error("attempt_ledger_busy_or_stale_lock"); }
    try {
      examine();
      const d=join(run,"publication-attempts");
      mkdirSync(d,{recursive:true,mode:0o700});
      const file=join(d,sha(scope.publication_attempt_id)+".json");
      const fd2=openSync(file,"wx",0o600);
      try { writeFileSync(fd2, JSON.stringify({
        schema:"content-distribution.attempt.v1", status:"reserved_unverified",
        reserved_at:new Date(now).toISOString(), ...scope, video_path:undefined, title:undefined, caption:undefined
      },null,2)+"\n"); fsyncSync(fd2); } finally { closeSync(fd2); }
    } finally { closeSync(fd); unlinkSync(lock); }
  }
  return { status:reserve?"reserved_unverified":"validated_not_reserved",
    business_validation:"signed_release_evidence_checked",
    scope, webhelm_config:reserve ? {
      confirm_publish:true, video:scope.video_path, visibility:scope.visibility,
      expected_account:scope.expected_account, publication_attempt_id:scope.publication_attempt_id,
      creative_revision_id:scope.creative_revision_id,
      video_sha256:scope.video_sha256,
      ...(scope.title?{title:scope.title}:{}), ...(scope.caption?{caption:scope.caption}:{})
    } : null };
}
