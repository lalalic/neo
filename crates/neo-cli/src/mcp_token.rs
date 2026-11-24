//! Native, short-lived OAuth PKCE client for NeoY's existing OAuth gateway.
//! No background refresh, no custom token issuer, no broker or new service.
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
#[cfg(unix)]
use std::os::unix::fs::OpenOptionsExt;
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
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OAuthRequest {
    pub method: &'static str,
    pub path: String,
    pub url: String,
    pub content_type: Option<&'static str>,
    pub body: String,
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
    let usage="usage: neo mcp token issue (--stdout | --output ABSOLUTE_PATH) [--origin HTTPS_URL] [--client-name NAME]\n       neo mcp token revoke --file ABSOLUTE_PATH [--origin HTTPS_URL]";
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
    let access = access.to_string();
    if let Some(refresh) = doc["refresh_token"].as_str().filter(|s| !s.is_empty()) {
        let revoked = send(
            fetch,
            &origin,
            "POST",
            "/revoke",
            form(&[("token", refresh)]),
            Some("application/x-www-form-urlencoded"),
        )?;
        if revoked.status != 200 {
            return Err("Neo OAuth failed to revoke its unused refresh token".into());
        }
    }
    Ok(Issued {
        access_token: access,
        expires_in_seconds: 3600,
        mcp_url: format!("{origin}/mcp"),
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
        agent
            .post(&request.url)
            .header(
                "content-type",
                request.content_type.unwrap_or("application/json"),
            )
            .send(request.body.as_bytes())
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
pub fn run(args: &[String]) -> Result<Value, String> {
    execute_with(args, operator_token, &mut live_http)
}
