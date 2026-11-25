//! Native OAuth PKCE client for NeoY's existing OAuth gateway.
//! Legacy issue/revoke remains one-hour and non-renewable. Explicit device
//! login retains rotating refresh credentials for on-demand renewal.
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
#[cfg(unix)]
use std::os::unix::fs::{MetadataExt, OpenOptionsExt, PermissionsExt};
use std::{
    collections::HashMap,
    env,
    fs::{self, File, OpenOptions},
    io::Write,
    path::{Path, PathBuf},
    time::Duration,
};
use url::Url;

const DEFAULT_ORIGIN: &str = "https://neoy.qili2.com";
const CALLBACK: &str = "http://127.0.0.1:8765/neo/oauth/callback";
const DEFAULT_CLIENT: &str = "Neo interactive MCP client";
const NOTE:&str="Read the private file locally. Do not paste the token into public logs, a repository, or shared bootstrap instructions.";
#[derive(Clone, PartialEq, Eq)]
pub struct OAuthRequest {
    pub method: &'static str,
    pub path: String,
    pub url: String,
    pub content_type: Option<&'static str>,
    pub bearer: Option<String>,
    pub body: String,
}
impl std::fmt::Debug for OAuthRequest {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("OAuthRequest")
            .field("method", &self.method)
            .field("path", &self.path)
            .finish_non_exhaustive()
    }
}
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OAuthResponse {
    pub status: u16,
    pub body: String,
    pub location: Option<String>,
}
#[derive(Debug)]
pub struct Issued {
    pub access_token: String,
    pub expires_in_seconds: u64,
    pub mcp_url: String,
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Verb {
    Issue,
    Revoke,
}
#[derive(Clone, Debug)]
pub struct Options {
    pub verb: Verb,
    pub filepath: Option<PathBuf>,
    pub stdout: bool,
    pub origin: String,
    pub client_name: String,
}
pub fn parse(args: &[String]) -> Result<Options, String> {
    let usage="usage: neo token issue (--stdout | --output ABSOLUTE_PATH) [--origin HTTPS_URL] [--client-name NAME]\n       neo token revoke --file ABSOLUTE_PATH [--origin HTTPS_URL]";
    let (verb, rest) = args.split_first().ok_or(usage)?;
    let verb = match verb.as_str() {
        "issue" => Verb::Issue,
        "revoke" => Verb::Revoke,
        _ => return Err(usage.into()),
    };
    let mut fields = HashMap::<&str, String>::new();
    let mut stdout = false;
    let mut index = 0;
    while index < rest.len() {
        let key = rest[index].as_str();
        if key == "--stdout" {
            if stdout {
                return Err("Repeated Neo MCP token option: --stdout".into());
            }
            stdout = true;
            index += 1;
            continue;
        }
        if !matches!(key, "--output" | "--file" | "--origin" | "--client-name")
            || fields.contains_key(key)
        {
            return Err(format!("Invalid or repeated Neo MCP token option: {key}"));
        }
        index += 1;
        let Some(value) = rest
            .get(index)
            .filter(|s| !s.is_empty() && !s.starts_with("--"))
        else {
            return Err(format!("{key} needs a value"));
        };
        fields.insert(key, value.to_string());
        index += 1;
    }
    let path = if verb == Verb::Issue {
        fields.get("--output")
    } else {
        fields.get("--file")
    };
    if (verb == Verb::Issue && fields.contains_key("--file"))
        || (verb == Verb::Revoke
            && (stdout || fields.contains_key("--output") || fields.contains_key("--client-name")))
    {
        return Err(format!(
            "Unsupported option for token {}",
            if verb == Verb::Issue {
                "issue"
            } else {
                "revoke"
            }
        ));
    }
    if verb == Verb::Issue && (stdout == path.is_some()) {
        return Err("Issue requires exactly one of --stdout or --output ABSOLUTE_PATH".into());
    }
    if path.is_some_and(|s| !Path::new(s).is_absolute()) {
        return Err("Neo MCP token requires an absolute file path".into());
    }
    if verb == Verb::Revoke && path.is_none() {
        return Err("Revoke requires --file ABSOLUTE_PATH".into());
    }
    let origin = fields
        .get("--origin")
        .cloned()
        .or_else(|| env::var("NEO_MCP_ORIGIN").ok())
        .unwrap_or_else(|| DEFAULT_ORIGIN.into());
    let client_name = fields
        .get("--client-name")
        .cloned()
        .unwrap_or_else(|| DEFAULT_CLIENT.into());
    Ok(Options {
        verb,
        filepath: path.map(PathBuf::from),
        stdout,
        origin,
        client_name,
    })
}
fn valid_origin(raw: &str) -> Result<String, String> {
    let origin = raw.strip_suffix('/').unwrap_or(raw);
    let url = Url::parse(origin).map_err(|_| "Neo MCP OAuth origin must use HTTPS".to_string())?;
    let host = url
        .host_str()
        .ok_or("Neo MCP OAuth origin must use HTTPS")?;
    let allowed = host
        .bytes()
        .all(|b| b.is_ascii_alphanumeric() || b == b'.' || b == b'-');
    if url.scheme() != "https"
        || !allowed
        || !url.username().is_empty()
        || url.password().is_some()
        || url.path() != "/"
        || url.query().is_some()
        || url.fragment().is_some()
        || url.port().is_some_and(|p| p == 0)
    {
        return Err("Neo MCP OAuth origin must use HTTPS".into());
    }
    Ok(origin.to_string())
}
fn form(fields: &[(&str, &str)]) -> String {
    let mut data = url::form_urlencoded::Serializer::new(String::new());
    for (key, value) in fields {
        data.append_pair(key, value);
    }
    data.finish()
}
fn json_body(value: &Value) -> Result<String, String> {
    serde_json::to_string(value).map_err(|e| e.to_string())
}
fn send<F: FnMut(&OAuthRequest) -> Result<OAuthResponse, String>>(
    fetch: &mut F,
    origin: &str,
    method: &'static str,
    path: &str,
    body: String,
    content_type: Option<&'static str>,
) -> Result<OAuthResponse, String> {
    let request = OAuthRequest {
        method,
        path: path.split('?').next().unwrap_or(path).into(),
        url: format!("{origin}{path}"),
        body,
        content_type,
        bearer: None,
    };
    fetch(&request)
}
fn required_id(doc: &OAuthResponse, key: &str) -> Result<String, String> {
    let result: Value = serde_json::from_str(&doc.body)
        .map_err(|_| "Neo OAuth returned invalid JSON".to_string())?;
    Ok(result
        .get(key)
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string())
}
fn rid_from_html(html: &str) -> Option<String> {
    // The NeoY OAuth form uses a single hidden input with name="rid" and
    // value="...". No HTML/JS execution, cookie management or browser login.
    let match_index = html.find("name=\"rid\"")?;
    let trailing = &html[match_index + "name=\"rid\"".len()..];
    let whitespace = trailing
        .bytes()
        .take_while(|b| b.is_ascii_whitespace())
        .count();
    if whitespace == 0 || !trailing[whitespace..].starts_with("value=\"") {
        return None;
    }
    let text = trailing[whitespace + 7..].split('"').next()?;
    if text.is_empty()
        || !text
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
    {
        return None;
    }
    Some(text.into())
}

pub fn issue_with<F: FnMut(&OAuthRequest) -> Result<OAuthResponse, String>>(
    origin: &str,
    operator: &str,
    client_name: &str,
    fetch: &mut F,
) -> Result<Issued, String> {
    let (grant, refresh) = issue_grant_with(origin, operator, client_name, fetch)?;
    if let Some(refresh) = refresh {
        revoke_secret(fetch, &grant.origin, &refresh)
            .map_err(|_| "Neo OAuth failed to revoke its unused refresh token")?;
    }
    Ok(Issued {
        access_token: grant.access_token,
        expires_in_seconds: 3600,
        mcp_url: format!("{}/mcp", grant.origin),
    })
}
#[derive(Serialize, Deserialize)]
struct Credential {
    origin: String,
    client_id: String,
    access_token: String,
    expires_at: u64,
    refresh_token: String,
}
fn now() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}
fn issue_grant_with<F: FnMut(&OAuthRequest) -> Result<OAuthResponse, String>>(
    origin: &str,
    operator: &str,
    client_name: &str,
    fetch: &mut F,
) -> Result<(Credential, Option<String>), String> {
    let origin = valid_origin(origin)?;
    if operator.trim().is_empty() {
        return Err("The Neo operator credential is required on the trusted host".into());
    }
    if client_name.trim().is_empty() || client_name.encode_utf16().count() > 100 {
        return Err("Invalid OAuth client name".into());
    }
    let mut verifier_bytes = [0u8; 32];
    getrandom::fill(&mut verifier_bytes).map_err(|_| "OAuth PKCE randomness unavailable")?;
    let verifier = URL_SAFE_NO_PAD.encode(verifier_bytes);
    let challenge = URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()));
    let mut state_bytes = [0u8; 18];
    getrandom::fill(&mut state_bytes).map_err(|_| "OAuth state randomness unavailable")?;
    let state = state_bytes
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect::<String>();
    let registration = json!({"client_name":client_name,"redirect_uris":[CALLBACK],
        "grant_types":["authorization_code","refresh_token"],"response_types":["code"],
        "token_endpoint_auth_method":"none"});
    let registration = send(
        fetch,
        &origin,
        "POST",
        "/register",
        json_body(&registration)?,
        Some("application/json"),
    )?;
    if registration.status != 201 {
        return Err(format!(
            "Neo OAuth client registration rejected: HTTP {}",
            registration.status
        ));
    }
    let client_id = required_id(&registration, "client_id")?;
    if client_id.is_empty() {
        return Err("Neo OAuth client registration returned no client ID".into());
    }
    let query = form(&[
        ("response_type", "code"),
        ("client_id", &client_id),
        ("redirect_uri", CALLBACK),
        ("code_challenge", &challenge),
        ("code_challenge_method", "S256"),
        ("scope", "mcp"),
        ("resource", &format!("{origin}/mcp")),
        ("state", &state),
    ]);
    let auth = send(
        fetch,
        &origin,
        "GET",
        &format!("/authorize?{query}"),
        String::new(),
        None,
    )?;
    if auth.status != 200 {
        return Err(format!(
            "Neo OAuth authorization rejected: HTTP {}",
            auth.status
        ));
    }
    let rid = rid_from_html(&auth.body)
        .ok_or("Neo OAuth authorization page did not return a request ID")?;
    let approved = send(
        fetch,
        &origin,
        "POST",
        "/authorize",
        form(&[("rid", &rid), ("token", operator)]),
        Some("application/x-www-form-urlencoded"),
    )?;
    if approved.status != 302 {
        return Err(format!(
            "Neo OAuth operator approval rejected: HTTP {}",
            approved.status
        ));
    }
    let location = approved
        .location
        .ok_or("Neo OAuth operator approval did not redirect")?;
    let callback = Url::parse(&location)
        .map_err(|_| "Neo OAuth callback failed issuer/state/redirect validation")?;
    let expected = Url::parse(CALLBACK).map_err(|e| e.to_string())?;
    let param = |name: &str| {
        callback
            .query_pairs()
            .find(|(k, _)| k == name)
            .map(|(_, v)| v.to_string())
    };
    if callback.origin() != expected.origin()
        || callback.path() != expected.path()
        || param("state").as_deref() != Some(state.as_str())
        || param("iss").as_deref() != Some(origin.as_str())
    {
        return Err("Neo OAuth callback failed issuer/state/redirect validation".into());
    }
    let code = param("code")
        .filter(|s| !s.is_empty())
        .ok_or("Neo OAuth callback lacked an authorization code")?;
    let token = send(
        fetch,
        &origin,
        "POST",
        "/token",
        form(&[
            ("grant_type", "authorization_code"),
            ("client_id", &client_id),
            ("redirect_uri", CALLBACK),
            ("code", &code),
            ("code_verifier", &verifier),
        ]),
        Some("application/x-www-form-urlencoded"),
    )?;
    if token.status != 200 {
        return Err(format!(
            "Neo OAuth token exchange rejected: HTTP {}",
            token.status
        ));
    }
    let doc: Value = serde_json::from_str(&token.body)
        .map_err(|_| "Neo OAuth returned an invalid one-hour access token")?;
    let access = doc["access_token"]
        .as_str()
        .filter(|s| !s.is_empty())
        .ok_or("Neo OAuth returned an invalid one-hour access token")?;
    if doc["expires_in"] != 3600 {
        return Err("Neo OAuth returned an invalid one-hour access token".into());
    }
    let refresh = doc["refresh_token"]
        .as_str()
        .filter(|s| !s.is_empty())
        .map(str::to_owned);
    Ok((
        Credential {
            origin,
            client_id,
            access_token: access.to_owned(),
            expires_at: now() + 3600,
            refresh_token: String::new(),
        },
        refresh,
    ))
}

fn revoke_secret<F: FnMut(&OAuthRequest) -> Result<OAuthResponse, String>>(
    fetch: &mut F,
    origin: &str,
    secret: &str,
) -> Result<(), String> {
    let revoked = send(
        fetch,
        origin,
        "POST",
        "/revoke",
        form(&[("token", secret)]),
        Some("application/x-www-form-urlencoded"),
    )?;
    if revoked.status != 200 {
        return Err(format!(
            "Neo OAuth token revocation failed: HTTP {}",
            revoked.status
        ));
    }
    Ok(())
}

fn refresh_grant<F: FnMut(&OAuthRequest) -> Result<OAuthResponse, String>>(
    credential: &mut Credential,
    fetch: &mut F,
    force: bool,
) -> Result<bool, String> {
    if !force && credential.expires_at > now() + 120 {
        return Ok(false);
    }
    let response = send(
        fetch,
        &credential.origin,
        "POST",
        "/token",
        form(&[
            ("grant_type", "refresh_token"),
            ("client_id", &credential.client_id),
            ("refresh_token", &credential.refresh_token),
        ]),
        Some("application/x-www-form-urlencoded"),
    )?;
    if response.status != 200 {
        return Err(format!(
            "Neo OAuth refresh failed: HTTP {}; re-enroll if revoked or expired",
            response.status
        ));
    }
    let doc: Value =
        serde_json::from_str(&response.body).map_err(|_| "Invalid OAuth refresh response")?;
    let access = doc["access_token"]
        .as_str()
        .filter(|v| !v.is_empty())
        .ok_or("Missing refreshed access token")?;
    let refresh = doc["refresh_token"]
        .as_str()
        .filter(|v| !v.is_empty() && *v != credential.refresh_token)
        .ok_or("Missing rotated refresh token")?;
    let expiry = doc["expires_in"]
        .as_u64()
        .filter(|v| (1..=3600).contains(v))
        .ok_or("Invalid refreshed token lifetime")?;
    credential.access_token = access.into();
    credential.refresh_token = refresh.into();
    credential.expires_at = now() + expiry;
    Ok(true)
}

const DEVICE_HELP:&str="neo token login [--origin HTTPS_URL] [--file ABSOLUTE_PATH | --node NAME] [--client-name NAME]\nneo token access --stdout [--origin HTTPS_URL] [--file ABSOLUTE_PATH]\nneo token refresh|status|logout [--origin HTTPS_URL] [--file ABSOLUTE_PATH | --node NAME]\nneo token dashboard [--origin HTTPS_URL] [--file ABSOLUTE_PATH] [--node REGISTERED_NAME]\nneo token issue|revoke ... (one-hour legacy tokens)";
pub fn help() -> &'static str {
    DEVICE_HELP
}

fn private_file(path: &Path) -> Result<(), String> {
    let meta = fs::symlink_metadata(path)
        .map_err(|_| "Cannot read private Neo OAuth credential; login first")?;
    if !meta.is_file() || meta.file_type().is_symlink() {
        return Err("Credential must be a regular file, not a symlink".into());
    }
    #[cfg(unix)]
    if meta.permissions().mode() & 0o077 != 0 || meta.uid() != unsafe { libc::geteuid() } {
        return Err("Credential must be owned by current user and private (0600)".into());
    }
    Ok(())
}
fn private_directory(path: &Path) -> Result<(), String> {
    if !path.exists() {
        #[cfg(unix)]
        {
            use std::os::unix::fs::DirBuilderExt;
            let mut builder = fs::DirBuilder::new();
            builder.recursive(true).mode(0o700);
            builder.create(path).map_err(|e| e.to_string())?;
        }
        #[cfg(not(unix))]
        fs::create_dir_all(path).map_err(|e| e.to_string())?;
    }
    let meta = fs::symlink_metadata(path).map_err(|e| e.to_string())?;
    if !meta.is_dir() || meta.file_type().is_symlink() {
        return Err("Credential directory must not be a symlink".into());
    }
    #[cfg(unix)]
    if meta.permissions().mode() & 0o077 != 0 || meta.uid() != unsafe { libc::geteuid() } {
        return Err("Credential directory must be owned by current user and private (0700)".into());
    }
    Ok(())
}
fn atomic_credential(path: &Path, credential: &Credential) -> Result<(), String> {
    let mut temp = tempfile::NamedTempFile::new_in(path.parent().ok_or("Invalid credential path")?)
        .map_err(|e| e.to_string())?;
    #[cfg(unix)]
    temp.as_file()
        .set_permissions(fs::Permissions::from_mode(0o600))
        .map_err(|e| e.to_string())?;
    serde_json::to_writer(&mut temp, credential).map_err(|_| "Credential serialization failed")?;
    temp.as_file().sync_all().map_err(|e| e.to_string())?;
    temp.persist(path)
        .map_err(|_| "Cannot atomically persist Neo OAuth credential")?;
    Ok(())
}
fn with_credential_lock<T>(
    path: &Path,
    work: impl FnOnce() -> Result<T, String>,
) -> Result<T, String> {
    private_directory(path.parent().ok_or("Invalid credential path")?)?;
    let lock = path.with_extension("lock");
    let mut options = OpenOptions::new();
    options.read(true).write(true).create(true);
    #[cfg(unix)]
    options.mode(0o600).custom_flags(libc::O_NOFOLLOW);
    let handle = options
        .open(&lock)
        .map_err(|_| "Cannot open private credential lock")?;
    private_file(&lock)?;
    #[cfg(unix)]
    {
        use std::os::fd::AsRawFd;
        if unsafe { libc::flock(handle.as_raw_fd(), libc::LOCK_EX) } != 0 {
            return Err("Cannot lock OAuth credential".into());
        }
    }
    let result = work();
    drop(handle);
    result
}
fn load_credential(path: &Path, origin: &str) -> Result<Credential, String> {
    private_file(path)?;
    let raw = fs::read(path).map_err(|_| "Cannot read OAuth credential")?;
    if raw.len() > 65536 {
        return Err("Credential file too large".into());
    }
    let c: Credential =
        serde_json::from_slice(&raw).map_err(|_| "Invalid OAuth credential file")?;
    if c.origin != origin
        || c.client_id.is_empty()
        || c.access_token.is_empty()
        || c.refresh_token.is_empty()
    {
        return Err("Credential origin or content mismatch".into());
    }
    Ok(c)
}
fn device_path(origin: &str, file: Option<&str>, node: Option<&str>) -> Result<PathBuf, String> {
    if let Some(node) = node {
        if file.is_some()
            || node.is_empty()
            || node.len() > 64
            || !node
                .bytes()
                .all(|c| c.is_ascii_alphanumeric() || c == b'-' || c == b'_')
        {
            return Err(
                "Registered node must be a simple name; --node and --file are mutually exclusive"
                    .into(),
            );
        }
    }
    if let Some(file) = file {
        let path = PathBuf::from(file);
        if !path.is_absolute() {
            return Err("Credential path must be absolute".into());
        }
        return Ok(path);
    }
    let key = match node {
        Some(name) => format!("{origin}\nnode:{name}"),
        None => origin.into(),
    };
    let digest = URL_SAFE_NO_PAD.encode(Sha256::digest(key.as_bytes()));
    Ok(crate::workspace::home()?
        .join(".local/share/neo/oauth")
        .join(format!("{digest}.json")))
}
fn revoke_grant<F: FnMut(&OAuthRequest) -> Result<OAuthResponse, String>>(
    fetch: &mut F,
    c: &Credential,
) -> Result<(), String> {
    let response = send(
        fetch,
        &c.origin,
        "POST",
        "/revoke",
        form(&[("token", &c.refresh_token), ("revoke_grant", "true")]),
        Some("application/x-www-form-urlencoded"),
    )?;
    if response.status != 200 {
        return Err(format!(
            "Neo OAuth grant revocation failed: HTTP {}",
            response.status
        ));
    }
    revoke_secret(fetch, &c.origin, &c.access_token)
}

pub fn device_with<F, G>(args: &[String], mut operator: G, fetch: &mut F) -> Result<Value, String>
where
    F: FnMut(&OAuthRequest) -> Result<OAuthResponse, String>,
    G: FnMut() -> Result<String, String>,
{
    let verb = args.first().map(String::as_str).ok_or(DEVICE_HELP)?;
    if !matches!(verb, "login" | "access" | "refresh" | "status" | "logout") {
        return Err(DEVICE_HELP.into());
    }
    let mut fields = HashMap::new();
    let mut stdout = false;
    let mut i = 1;
    while i < args.len() {
        let k = args[i].as_str();
        if k == "--stdout" {
            if stdout || verb != "access" {
                return Err(DEVICE_HELP.into());
            }
            stdout = true;
            i += 1;
            continue;
        }
        if !matches!(k, "--origin" | "--file" | "--client-name" | "--node")
            || fields.contains_key(k)
            || (k == "--client-name" && verb != "login")
        {
            return Err(DEVICE_HELP.into());
        }
        let v = args
            .get(i + 1)
            .filter(|v| !v.is_empty() && !v.starts_with("--"))
            .ok_or(DEVICE_HELP)?;
        fields.insert(k, v.as_str());
        i += 2;
    }
    if verb == "access" && !stdout {
        return Err("Access requires explicit --stdout".into());
    }
    let selected = fields
        .get("--origin")
        .map(|s| s.to_string())
        .or_else(|| env::var("NEO_MCP_ORIGIN").ok())
        .unwrap_or(DEFAULT_ORIGIN.into());
    let origin = valid_origin(&selected)?;
    let node = fields.get("--node").copied();
    let path = device_path(&origin, fields.get("--file").copied(), node)?;
    if node.is_some() && fields.contains_key("--client-name") {
        return Err("Registered node client identity is derived from its registration".into());
    }
    with_credential_lock(&path, || {
        if verb == "login" {
            if fs::symlink_metadata(&path).is_ok() {
                return Err("Credential already exists; refresh or logout first".into());
            }
            let base = fields
                .get("--client-name")
                .copied()
                .unwrap_or("Neo registered device");
            if base == "Z.ai interactive"
                || base.starts_with("Neo registered node: ")
                || base.starts_with("Neo Mobile registered device: ")
            {
                return Err("Reserved client name for persistent login".into());
            }
            let client = if let Some(node) = node {
                format!("Neo registered node: {node}")
            } else {
                // Persisted grants must have distinct OAuth client identities
                // so whole-grant revocation does not affect other devices.
                format!(
                    "{}: {}",
                    base.chars().take(55).collect::<String>(),
                    uuid::Uuid::new_v4()
                )
            };
            let secret = operator()?;
            let (mut c, refresh) = issue_grant_with(&origin, &secret, &client, fetch)?;
            c.refresh_token = refresh.ok_or("Server did not issue a renewable credential")?;
            if let Err(error) = atomic_credential(&path, &c) {
                let _ = revoke_secret(fetch, &origin, &c.refresh_token);
                let _ = revoke_secret(fetch, &origin, &c.access_token);
                return Err(error);
            }
            return Ok(
                json!({"authenticated":true,"origin":origin,"credential_file":path,"expires_at":c.expires_at}),
            );
        }
        let mut c = load_credential(&path, &origin)?;
        if verb == "logout" {
            revoke_grant(fetch, &c)?;
            fs::remove_file(&path).map_err(|e| e.to_string())?;
            return Ok(json!({"revoked":true,"origin":origin}));
        }
        if verb == "access" || verb == "refresh" {
            if refresh_grant(&mut c, fetch, verb == "refresh")? {
                if let Err(error) = atomic_credential(&path, &c) {
                    let _ = revoke_secret(fetch, &origin, &c.refresh_token);
                    let _ = revoke_secret(fetch, &origin, &c.access_token);
                    return Err(error);
                }
            }
        }
        if verb == "access" {
            return Ok(json!({"access_token":c.access_token}));
        }
        Ok(
            json!({"origin":origin,"credential_file":path,"expires_at":c.expires_at,"access_token_current":c.expires_at>now()}),
        )
    })
}

fn operator_token() -> Result<String, String> {
    let path = env::var_os("NEO_MCP_OPERATOR_TOKEN_FILE")
        .map(PathBuf::from)
        .unwrap_or_else(|| {
            crate::workspace::home()
                .unwrap_or_default()
                .join("Library/Application Support/NeoY/core-token")
        });
    fs::read_to_string(path)
        .map(|text| text.trim().to_string())
        .map_err(|_| "Cannot read trusted Neo operator credential file".into())
}
fn access_file(path: &Path) -> Result<File, String> {
    let mut options = OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    options.mode(0o600);
    options
        .open(path)
        .map_err(|e| format!("Cannot exclusively create Neo MCP token file: {e}"))
}

pub fn execute_with<F, G>(args: &[String], mut operator: G, fetch: &mut F) -> Result<Value, String>
where
    F: FnMut(&OAuthRequest) -> Result<OAuthResponse, String>,
    G: FnMut() -> Result<String, String>,
{
    let opts = parse(args)?;
    if opts.verb == Verb::Issue {
        if opts.stdout {
            let secret = operator()?;
            let issued = issue_with(&opts.origin, &secret, &opts.client_name, fetch)?;
            return Ok(
                json!({"access_token":issued.access_token,"expires_in_seconds":issued.expires_in_seconds,"mcp_url":issued.mcp_url}),
            );
        }
        let path = opts.filepath.as_ref().ok_or("Missing token output file")?;
        let mut file = access_file(path)?;
        let result = (|| {
            let secret = operator()?;
            let issued = issue_with(&opts.origin, &secret, &opts.client_name, fetch)?;
            file.write_all(format!("{}\n", issued.access_token).as_bytes())
                .map_err(|e| e.to_string())?;
            file.sync_all().map_err(|e| e.to_string())?;
            Ok(
                json!({"token_file":path,"expires_in_seconds":issued.expires_in_seconds,
                "mcp_url":issued.mcp_url,"note":NOTE}),
            )
        })();
        if result.is_err() {
            drop(file);
            let _ = fs::remove_file(path);
        }
        return result;
    }
    let path = opts.filepath.as_ref().ok_or("Missing token file")?;
    let meta = fs::symlink_metadata(path).map_err(|e| e.to_string())?;
    if !meta.is_file() || meta.file_type().is_symlink() {
        return Err("Neo MCP access token file must be a regular file".into());
    }
    let secret = fs::read_to_string(path).map_err(|e| e.to_string())?;
    let secret = secret.trim();
    if secret.is_empty() {
        return Err("Neo MCP access token file is empty".into());
    }
    let origin =
        valid_origin(&opts.origin).map_err(|_| "Revocation requires an HTTPS Neo OAuth origin")?;
    let revoked = send(
        fetch,
        &origin,
        "POST",
        "/revoke",
        form(&[("token", secret)]),
        Some("application/x-www-form-urlencoded"),
    )?;
    if revoked.status != 200 {
        return Err(format!(
            "Neo MCP access token revocation failed: HTTP {}",
            revoked.status
        ));
    }
    fs::remove_file(path).map_err(|e| e.to_string())?;
    Ok(json!({"revoked":true,"removed_file":path}))
}

fn live_http(request: &OAuthRequest) -> Result<OAuthResponse, String> {
    // OAuth is the sole exception to the MCP loopback-only rule; its HTTPS
    // issuer is selected explicitly, validated, and redirects are never followed.
    if !request.url.starts_with("https://") {
        return Err("OAuth transport requires HTTPS".into());
    }
    let mut config = ureq::Agent::config_builder()
        .timeout_global(Some(Duration::from_secs(15)))
        .max_redirects(0)
        .max_redirects_will_error(false)
        .http_status_as_error(false);
    // Explicit, caller-owned private CA is supported only for an IP-literal
    // loopback issuer. Public/production origins always retain normal WebPKI
    // validation. No insecure mode, redirect bypass, or global trust mutation.
    if let Some(path) = env::var_os("NEO_MCP_LOOPBACK_CA_FILE") {
        let url = Url::parse(&request.url).map_err(|_| "Invalid OAuth URL")?;
        if url.host_str() != Some("127.0.0.1") {
            return Err("Custom OAuth CA requires HTTPS 127.0.0.1 issuer".into());
        }
        let path = PathBuf::from(path);
        let meta = fs::symlink_metadata(&path).map_err(|_| "Cannot read loopback OAuth CA")?;
        if !path.is_absolute()
            || !meta.is_file()
            || meta.file_type().is_symlink()
            || meta.len() > 65536
        {
            return Err("Invalid loopback OAuth CA file".into());
        }
        let pem = fs::read(path).map_err(|_| "Cannot read loopback OAuth CA")?;
        let cert = ureq::tls::Certificate::from_pem(&pem)
            .map_err(|_| "Invalid loopback OAuth CA certificate")?;
        config = config.proxy(None).tls_config(
            ureq::tls::TlsConfig::builder()
                .root_certs(ureq::tls::RootCerts::new_with_certs(&[cert]))
                .build(),
        );
    }
    let agent = config.build().new_agent();
    let mut response = if request.method == "GET" {
        agent.get(&request.url).call()
    } else {
        let post = agent.post(&request.url).header(
            "content-type",
            request.content_type.unwrap_or("application/json"),
        );
        let post = if let Some(bearer) = &request.bearer {
            post.header("authorization", format!("Bearer {bearer}"))
        } else {
            post
        };
        post.send(request.body.as_bytes())
    }
    .map_err(|_| "Neo OAuth request could not be completed")?;
    let location = response
        .headers()
        .get("location")
        .and_then(|h| h.to_str().ok())
        .map(str::to_string);
    let status = response.status().as_u16();
    let body = response
        .body_mut()
        .with_config()
        .limit(1024 * 1024)
        .read_to_string()
        .map_err(|_| "Neo OAuth returned invalid or oversized response")?;
    Ok(OAuthResponse {
        status,
        body,
        location,
    })
}
fn dashboard(args: &[String]) -> Result<Value, String> {
    let mut fields: HashMap<&str, &str> = HashMap::new();
    let mut i = 1;
    while i < args.len() {
        let key = args[i].as_str();
        if !matches!(key, "--origin" | "--file" | "--node") || fields.contains_key(key) {
            return Err(DEVICE_HELP.into());
        }
        let value = args
            .get(i + 1)
            .filter(|s| !s.is_empty() && !s.starts_with("--"))
            .ok_or(DEVICE_HELP)?;
        fields.insert(key, value);
        i += 2;
    }
    let selected = fields
        .get("--origin")
        .map(|s| s.to_string())
        .or_else(|| env::var("NEO_MCP_ORIGIN").ok())
        .unwrap_or(DEFAULT_ORIGIN.into());
    let origin = valid_origin(&selected)?;
    let node = fields.get("--node").copied();
    let file = fields.get("--file").copied();
    let path = device_path(&origin, file, node)?;
    let mut options = vec!["--origin".to_string(), origin.clone()];
    if let Some(file) = file {
        options.extend(["--file".to_string(), file.into()]);
    }
    if let Some(node) = node {
        crate::mcp_local::registered_node(node)?;
        options.extend(["--node".to_string(), node.into()]);
        if fs::symlink_metadata(&path).is_err() {
            if origin != DEFAULT_ORIGIN {
                return Err(
                    "Registered node enrollment must use the configured Master HTTPS issuer".into(),
                );
            }
            let mut login = vec!["login".to_string()];
            login.extend(options.clone());
            device_with(&login, operator_token, &mut live_http)?;
        }
    }
    let mut access_args = vec!["access".to_string(), "--stdout".to_string()];
    access_args.extend(options);
    let token = if node.is_some() || file.is_some() || fs::symlink_metadata(&path).is_ok() {
        device_with(&access_args, operator_token, &mut live_http)?["access_token"]
            .as_str()
            .ok_or("No access token")?
            .to_owned()
    } else {
        if origin != DEFAULT_ORIGIN {
            return Err("Login to the selected HTTPS issuer first".into());
        }
        operator_token()?
    };
    let reply = live_http(&OAuthRequest {
        method: "POST",
        path: "/dashboard/ticket".into(),
        url: format!("{origin}/dashboard/ticket"),
        body: String::new(),
        content_type: Some("application/json"),
        bearer: Some(token),
    })?;
    if reply.status != 200 {
        return Err(format!(
            "Dashboard authentication failed: HTTP {}",
            reply.status
        ));
    }
    let doc: Value =
        serde_json::from_str(&reply.body).map_err(|_| "Invalid Dashboard ticket response")?;
    let ticket = doc["ticket"]
        .as_str()
        .filter(|s| {
            (32..=128).contains(&s.len())
                && s.bytes()
                    .all(|c| c.is_ascii_alphanumeric() || c == b'-' || c == b'_')
        })
        .ok_or("Invalid Dashboard ticket")?;
    if doc["expires_in"] != 60 {
        return Err("Invalid Dashboard ticket lifetime".into());
    }
    let url = format!("{origin}/dashboard/connect#{ticket}");
    if let Some(node) = fields.get("--node") {
        crate::mcp_local::open_dashboard_on_node(node, &url)?;
        return Ok(json!({"opened":true,"origin":origin,"node":node}));
    }
    #[cfg(target_os = "macos")]
    let opener = "/usr/bin/open";
    #[cfg(not(target_os = "macos"))]
    let opener = "xdg-open";
    let status = std::process::Command::new(opener)
        .arg(&url)
        .status()
        .map_err(|_| "Could not open Dashboard browser")?;
    if !status.success() {
        return Err("Browser launch failed".into());
    }
    Ok(json!({"opened":true,"origin":origin}))
}

pub fn run(args: &[String]) -> Result<Value, String> {
    if args.first().is_some_and(|s| s == "dashboard") {
        return dashboard(args);
    }
    if args
        .first()
        .is_some_and(|s| matches!(s.as_str(), "issue" | "revoke"))
    {
        execute_with(args, operator_token, &mut live_http)
    } else {
        if args.first().is_some_and(|s| s == "login") {
            if let Some(index) = args.iter().position(|s| s == "--node") {
                let node = args.get(index + 1).ok_or("Missing registered node name")?;
                crate::mcp_local::registered_node(node)?;
            }
        }
        device_with(args, operator_token, &mut live_http)
    }
}
