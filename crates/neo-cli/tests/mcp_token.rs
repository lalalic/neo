use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use neo_harness_cli::mcp_token::{self, OAuthRequest, OAuthResponse};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
#[cfg(unix)]
use std::os::unix::fs::PermissionsExt;
use std::{
    collections::VecDeque,
    fs,
    path::{Path, PathBuf},
    process::{Command, Output},
};
struct Fixture {
    _tmp: tempfile::TempDir,
    home: PathBuf,
    root: PathBuf,
}
impl Fixture {
    fn new() -> Self {
        let temp = tempfile::tempdir().unwrap();
        let home = temp.path().join("home");
        fs::create_dir_all(&home).unwrap();
        let root = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../..")
            .canonicalize()
            .unwrap();
        Self {
            _tmp: temp,
            home,
            root,
        }
    }
    fn call(&self, args: &[&str]) -> Output {
        let mut c = Command::new(env!("CARGO_BIN_EXE_neo-rs"));
        c.args(["mcp", "token"])
            .args(args)
            .env("HOME", &self.home)
            .env("NEO_HARNESS_ROOT", &self.root)
            .current_dir(&self.root)
            .output()
            .unwrap()
    }
}
fn make(status: u16, body: &str, location: Option<String>) -> OAuthResponse {
    OAuthResponse {
        status,
        body: body.to_string(),
        location,
    }
}
fn mock_oauth<'a>(
    reqs: &'a mut Vec<OAuthRequest>,
    _operator: &str,
    name: &str,
) -> impl FnMut(&OAuthRequest) -> Result<OAuthResponse, String> + 'a {
    let name = name.to_string();
    move |r| {
        reqs.push(r.clone());
        let answer = match (r.method, r.path.as_str()) {
            ("POST", "/register") => {
                let doc: Value = serde_json::from_str(&r.body).unwrap();
                assert_eq!(doc["client_name"], name);
                make(201, r#"{"client_id":"cli-test"}"#, None)
            }
            ("GET", "/authorize") => {
                assert!(r.url.contains("code_challenge_method=S256"));
                make(
                    200,
                    "<input type=\"hidden\" name=\"rid\" value=\"requestID_9\">",
                    None,
                )
            }
            ("POST", "/authorize") => {
                let get = reqs.iter().find(|x| x.method == "GET").unwrap();
                let parsed = url::Url::parse(&get.url).unwrap();
                let state = parsed.query_pairs().find(|(k, _)| k == "state").unwrap().1;
                make(302,"",Some(format!("http://127.0.0.1:8765/neo/oauth/callback?code=real-test-code&state={state}&iss=https%3A%2F%2Fneoy.qili2.com")))
            }
            ("POST", "/token") => make(
                200,
                r#"{"access_token":"private-test-access-token","expires_in":3600,"refresh_token":"private-test-refresh-token"}"#,
                None,
            ),
            ("POST", "/revoke") => make(200, "", None),
            _ => panic!("unexpected OAuth request: {} {}", r.method, r.path),
        };
        Ok(answer)
    }
}

#[test]
fn token_cli_invalid_options_are_rejected_without_network_or_secret_reads() {
    let f = Fixture::new();
    let path = f.home.join("access.token");
    let invalid = vec![
        vec!["issue"],
        vec!["issue", "--stdout", "--stdout"],
        vec!["issue", "--stdout", "--output", "/tmp/a"],
        vec!["issue", "--output", "relative"],
        vec!["issue", "--file", "/tmp/a"],
        vec!["issue", "--output", "/tmp/a", "--format", "json"],
        vec!["revoke"],
        vec!["revoke", "--file", "relative"],
        vec!["revoke", "--file", "/tmp/a", "--stdout"],
        vec!["revoke", "--file", "/tmp/a", "--client-name", "bad"],
    ];
    for args in invalid {
        let native = f.call(&args);
        assert_eq!(native.status.code(), Some(1), "invalid token args {args:?}");
        assert!(native.stdout.is_empty());
    }
    assert!(!path.exists());
}

#[test]
fn pkce_oauth_issues_one_hour_token_and_revokes_unused_refresh() {
    let mut reqs = Vec::new();
    let mut responder = mock_oauth(&mut reqs, "trusted-operator-test-only", "Z.ai interactive");
    let result = mcp_token::issue_with(
        "https://neoy.qili2.com",
        "trusted-operator-test-only",
        "Z.ai interactive",
        &mut responder,
    )
    .unwrap();
    assert_eq!(result.access_token, "private-test-access-token");
    assert_eq!(result.expires_in_seconds, 3600);
    drop(responder);
    assert_eq!(
        reqs.iter().map(|r| r.path.as_str()).collect::<Vec<_>>(),
        vec!["/register", "/authorize", "/authorize", "/token", "/revoke"]
    );
    let authorize = reqs.iter().find(|r| r.method == "GET").unwrap();
    let query = url::Url::parse(&authorize.url).unwrap();
    let challenge = query
        .query_pairs()
        .find(|(k, _)| k == "code_challenge")
        .unwrap()
        .1;
    assert!(challenge.len() >= 43);
    let token_req = reqs.iter().find(|r| r.path == "/token").unwrap();
    let verifier = url::form_urlencoded::parse(token_req.body.as_bytes())
        .find(|(k, _)| k == "code_verifier")
        .unwrap()
        .1;
    assert!(verifier.len() >= 43);
    assert_eq!(
        URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes())),
        challenge
    );
    assert_eq!(
        reqs.last().unwrap().body,
        "token=private-test-refresh-token"
    );
    assert!(!reqs
        .iter()
        .any(|r| r.url.contains("private-test-access-token")));
}

#[test]
fn token_output_file_is_private_and_existing_output_never_issues_credentials() {
    let f = Fixture::new();
    let path = f.home.join("access.token");
    let mut calls = Vec::new();
    let mut responder = mock_oauth(
        &mut calls,
        "trusted-operator-test-only",
        "Neo interactive MCP client",
    );
    let opts = vec![
        "issue".to_string(),
        "--output".into(),
        path.to_string_lossy().to_string(),
    ];
    let issued = mcp_token::execute_with(
        &opts,
        || Ok("trusted-operator-test-only".into()),
        &mut responder,
    )
    .unwrap();
    assert_eq!(
        fs::read_to_string(&path).unwrap(),
        "private-test-access-token\n"
    );
    #[cfg(unix)]
    assert_eq!(
        fs::metadata(&path).unwrap().permissions().mode() & 0o777,
        0o600
    );
    let meta = serde_json::to_string(&issued).unwrap();
    assert!(!meta.contains("private-test-access-token"));
    assert!(!meta.contains("trusted-operator-test-only"));
    drop(responder);
    let before = calls.len();
    let mut denial = |_: &OAuthRequest| -> Result<OAuthResponse, String> {
        panic!("existing output must not access OAuth");
    };
    assert!(mcp_token::execute_with(
        &opts,
        || Ok("trusted-operator-test-only".into()),
        &mut denial
    )
    .is_err());
    assert_eq!(before, calls.len());
}

#[test]
fn failed_issuance_removes_empty_output_and_revoke_failure_preserves_token_file() {
    let f = Fixture::new();
    let path = f.home.join("access.token");
    let issue = vec![
        "issue".into(),
        "--output".into(),
        path.to_string_lossy().to_string(),
    ];
    let mut refusal = |_: &OAuthRequest| Ok(make(403, "", None));
    assert!(mcp_token::execute_with(&issue, || Ok("private-secret".into()), &mut refusal).is_err());
    assert!(!path.exists());
    fs::write(&path, "test-access-token\n").unwrap();
    let revoke = vec![
        "revoke".into(),
        "--file".into(),
        path.to_string_lossy().to_string(),
    ];
    let mut denial = |_: &OAuthRequest| Ok(make(503, "", None));
    assert!(mcp_token::execute_with(
        &revoke,
        || panic!("revoke does not read operator token"),
        &mut denial
    )
    .is_err());
    assert_eq!(fs::read_to_string(&path).unwrap(), "test-access-token\n");
    let mut success = |req: &OAuthRequest| {
        assert_eq!(req.path, "/revoke");
        assert_eq!(req.body, "token=test-access-token");
        Ok(make(200, "", None))
    };
    let revoked = mcp_token::execute_with(
        &revoke,
        || panic!("revoke does not read operator token"),
        &mut success,
    )
    .unwrap();
    assert_eq!(
        revoked,
        json!({"revoked":true,"removed_file":path.to_string_lossy()})
    );
    assert!(!path.exists());
}

#[test]
fn oauth_callback_state_issuer_and_one_hour_limits_reject_malicious_responses() {
    for fault in [
        "wrong-state",
        "wrong-issuer",
        "wrong-path",
        "expired",
        "no-client",
    ] {
        let mut sent = VecDeque::<OAuthRequest>::new();
        let mut respond = |req: &OAuthRequest| {
            sent.push_back(req.clone());
            let response = match (req.method, req.path.as_str()) {
                ("POST", "/register") if fault == "no-client" => make(201, "{}", None),
                ("POST", "/register") => make(201, r#"{"client_id":"abc"}"#, None),
                ("GET", "/authorize") => make(200, "<input name=\"rid\" value=\"id1\">", None),
                ("POST", "/authorize") => {
                    let get = sent.iter().find(|r| r.method == "GET").unwrap();
                    let state = url::Url::parse(&get.url)
                        .unwrap()
                        .query_pairs()
                        .find(|(k, _)| k == "state")
                        .unwrap()
                        .1
                        .into_owned();
                    let state = if fault == "wrong-state" {
                        "evil"
                    } else {
                        &state
                    };
                    let iss = if fault == "wrong-issuer" {
                        "evil.example"
                    } else {
                        "neoy.qili2.com"
                    };
                    let path = if fault == "wrong-path" {
                        "/secret"
                    } else {
                        "/neo/oauth/callback"
                    };
                    make(302,"",Some(format!("http://127.0.0.1:8765{path}?code=abc&state={state}&iss=https%3A%2F%2F{iss}")))
                }
                ("POST", "/token") => {
                    make(200, r#"{"access_token":"secret","expires_in":1}"#, None)
                }
                _ => panic!("unexpected request"),
            };
            Ok(response)
        };
        let result =
            mcp_token::issue_with("https://neoy.qili2.com", "operator", "Test", &mut respond);
        assert!(result.is_err(), "{fault} must reject OAuth");
    }
}

#[test]
fn explicit_stdout_token_is_only_returned_in_opted_in_mode() {
    let f = Fixture::new();
    let args = [
        "issue".to_string(),
        "--stdout".to_string(),
        "--client-name".to_string(),
        "Z.ai interactive".to_string(),
    ];
    let mut requests = Vec::new();
    let mut responder = mock_oauth(&mut requests, "trusted", "Z.ai interactive");
    let issued = mcp_token::execute_with(&args, || Ok("trusted".into()), &mut responder).unwrap();
    assert_eq!(issued["access_token"], "private-test-access-token");
    assert_eq!(issued["expires_in_seconds"], 3600);
    assert!(!f.home.join("access.token").exists());
}

#[test]
fn unexpected_oauth_refresh_revocation_failure_must_not_release_access_token() {
    let mut requested = Vec::new();
    let mut responder = |r: &OAuthRequest| {
        requested.push(r.clone());
        if r.path == "/revoke" {
            return Ok(make(503, "", None));
        }
        // Run the normal response using the request observed so far.
        match r.path.as_str() {
            "/register" => Ok(make(201, r#"{"client_id":"cli-test"}"#, None)),
            "/authorize" if r.method == "GET" => Ok(make(
                200,
                "<input name=\"rid\" value=\"requestID_9\">",
                None,
            )),
            "/authorize" => {
                let get = requested.iter().find(|x| x.method == "GET").unwrap();
                let state = url::Url::parse(&get.url)
                    .unwrap()
                    .query_pairs()
                    .find(|(k, _)| k == "state")
                    .unwrap()
                    .1
                    .into_owned();
                Ok(make(302,"",Some(format!("http://127.0.0.1:8765/neo/oauth/callback?code=abc&state={state}&iss=https%3A%2F%2Fneoy.qili2.com"))))
            }
            "/token" => Ok(make(
                200,
                r#"{"access_token":"private-test-access-token","expires_in":3600,"refresh_token":"refresh-must-revoke"}"#,
                None,
            )),
            _ => panic!("unexpected"),
        }
    };
    let denied = mcp_token::issue_with("https://neoy.qili2.com", "trusted", "Test", &mut responder);
    assert!(denied.is_err());
    assert!(denied.unwrap_err().contains("refresh token"));
}
