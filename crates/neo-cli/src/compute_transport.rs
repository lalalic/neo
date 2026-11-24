//! Provider-independent Neo Compute v1 HTTP transport. Every transfer is
//! size-bounded and output publication is atomic create-if-absent.
use serde_json::{json, Value};
#[cfg(unix)]
use std::os::unix::fs::OpenOptionsExt;
use std::{
    env,
    fs::{self, OpenOptions},
    io::{Read, Write},
    path::{Path, PathBuf},
    thread,
    time::{Duration, Instant},
};
const MAX_OUTPUT: u64 = 2 * 1024 * 1024 * 1024;
#[derive(Clone)]
pub struct Endpoint {
    pub origin: String,
    pub bearer: Option<String>,
}
impl Endpoint {
    pub fn hf(job: &str) -> Result<Self, String> {
        if job.len() != 24 || !job.bytes().all(|b| b.is_ascii_hexdigit()) {
            return Err("Invalid HF Job ID for Compute proxy".into());
        }
        let token = env::var("HF_TOKEN")
            .ok()
            .filter(|t| !t.trim().is_empty())
            .or_else(|| {
                let path = env::var_os("HF_HOME")
                    .map(PathBuf::from)
                    .unwrap_or_else(|| {
                        PathBuf::from(env::var("HOME").unwrap_or_default())
                            .join(".cache/huggingface")
                    })
                    .join("token");
                fs::read_to_string(path)
                    .ok()
                    .map(|s| s.trim().to_string())
                    .filter(|s| !s.is_empty())
            })
            .ok_or("Hugging Face token not configured on this host")?;
        Ok(Self {
            origin: format!("https://{job}--8000.hf.jobs"),
            bearer: Some(token),
        })
    }
    pub fn local(port: u16) -> Result<Self, String> {
        if port == 0 {
            return Err("Invalid local Compute service port".into());
        }
        Ok(Self {
            origin: format!("http://127.0.0.1:{port}"),
            bearer: None,
        })
    }
    fn agent(timeout: Duration) -> ureq::Agent {
        ureq::Agent::config_builder()
            .timeout_global(Some(timeout))
            .max_redirects(0)
            .http_status_as_error(false)
            .build()
            .new_agent()
    }
    fn url(&self, path: &str) -> Result<String, String> {
        if !path.starts_with('/') || path.contains(['#', '?']) || path.contains("..") {
            return Err("Invalid Compute HTTP resource path".into());
        }
        Ok(format!("{}{}", self.origin, path))
    }
    fn get(
        &self,
        path: &str,
        timeout: Duration,
    ) -> Result<ureq::http::Response<ureq::Body>, String> {
        let url = self.url(path)?;
        let agent = Self::agent(timeout);
        let mut req = agent.get(&url);
        if let Some(token) = &self.bearer {
            req = req.header("Authorization", format!("Bearer {token}"));
        }
        let reply = req
            .call()
            .map_err(|_| "Compute service HTTP request failed")?;
        if !reply.status().is_success() {
            return Err(format!("Compute service {path} HTTP {}", reply.status()));
        }
        Ok(reply)
    }
    fn post(
        &self,
        path: &str,
        payload: &[u8],
        content_type: &str,
        timeout: Duration,
    ) -> Result<ureq::http::Response<ureq::Body>, String> {
        let url = self.url(path)?;
        let agent = Self::agent(timeout);
        let mut req = agent.post(&url).header("Content-Type", content_type);
        if let Some(token) = &self.bearer {
            req = req.header("Authorization", format!("Bearer {token}"));
        }
        let reply = req
            .send(payload)
            .map_err(|_| "Compute service upload failed")?;
        if !reply.status().is_success() {
            return Err(format!("Compute service {path} HTTP {}", reply.status()));
        }
        Ok(reply)
    }
    fn read_json(mut response: ureq::http::Response<ureq::Body>) -> Result<Value, String> {
        response
            .body_mut()
            .with_config()
            .limit(128 * 1024)
            .read_json()
            .map_err(|_| "Invalid Compute service JSON result".into())
    }
    pub fn json_get(&self, path: &str, timeout: Duration) -> Result<Value, String> {
        Self::read_json(self.get(path, timeout)?)
    }
    pub fn json_post(
        &self,
        path: &str,
        body: &[u8],
        content_type: &str,
        timeout: Duration,
    ) -> Result<Value, String> {
        Self::read_json(self.post(path, body, content_type, timeout)?)
    }
    fn encode_name(name: &str) -> Result<&str, String> {
        if !regex::Regex::new(r"^[A-Za-z][A-Za-z0-9_-]{0,63}(?:\.[A-Za-z0-9]{1,10})?$")
            .expect("constant file binding name")
            .is_match(name)
        {
            return Err("Invalid Compute input/output name".into());
        }
        Ok(name)
    }
    fn output(&self, name: &str, location: &Path) -> Result<Value, String> {
        let name = Self::encode_name(name)?;
        let mut response = self.get(&format!("/outputs/{name}"), Duration::from_secs(90))?;
        let length = response
            .headers()
            .get("Content-Length")
            .and_then(|v| v.to_str().ok())
            .and_then(|s| s.parse::<u64>().ok())
            .filter(|size| *size > 0 && *size <= MAX_OUTPUT)
            .ok_or("Compute output size invalid")?;
        if fs::symlink_metadata(location).is_ok() {
            return Err("Output already exists".into());
        }
        let parent = location
            .parent()
            .filter(|path| path.is_dir())
            .ok_or("Output directory missing")?;
        let temp = parent.join(format!(".neo-compute-part-{}", uuid::Uuid::new_v4()));
        let mut open = OpenOptions::new();
        open.write(true).create_new(true);
        #[cfg(unix)]
        open.mode(0o600);
        let mut file = open.open(&temp).map_err(|e| e.to_string())?;
        let result = (|| {
            let mut source = response.body_mut().as_reader().take(length + 1);
            let count = std::io::copy(&mut source, &mut file)
                .map_err(|_| "Compute output download failed")?;
            if count != length {
                return Err("Compute output truncated or exceeded declared size".into());
            }
            file.flush()
                .and_then(|_| file.sync_all())
                .map_err(|e| e.to_string())?;
            fs::hard_link(&temp, location)
                .map_err(|_| "Output already exists or could not be published")?;
            Ok(json!({"name":name,"path":location,"bytes":length}))
        })();
        drop(file);
        let _ = fs::remove_file(temp);
        result
    }
}
pub fn run_service(
    endpoint: &Endpoint,
    inputs: &[Value],
    outputs: &[Value],
    deadline: Instant,
) -> Result<Vec<Value>, String> {
    let readiness = std::cmp::min(
        deadline
            .checked_sub(Duration::from_secs(45))
            .unwrap_or(deadline),
        Instant::now() + Duration::from_secs(420),
    );
    let mut ready = false;
    while Instant::now() < readiness {
        if endpoint
            .json_get("/health", Duration::from_secs(8))
            .is_ok_and(|s| s["ok"] == true && s["service"] == "neo-gpu-v1")
        {
            ready = true;
            break;
        }
        thread::sleep(Duration::from_secs(2));
    }
    if !ready {
        return Err("Compute service did not expose the Neo GPU v1 contract".into());
    }
    for binding in inputs {
        let name = binding["name"].as_str().ok_or("Invalid input binding")?;
        let path = binding["file"].as_str().ok_or("Missing input file")?;
        let meta = fs::symlink_metadata(path).map_err(|_| "Input unavailable")?;
        if !meta.is_file()
            || meta.file_type().is_symlink()
            || meta.len() == 0
            || meta.len() > 64 * 1024 * 1024
        {
            return Err("Compute input must be a 1..64MiB regular file".into());
        }
        let data = fs::read(path).map_err(|_| "Cannot read authorized Compute input")?;
        let name = Endpoint::encode_name(name)?;
        let info = endpoint.json_post(
            &format!("/inputs/{name}"),
            &data,
            "application/octet-stream",
            Duration::from_secs(90),
        )?;
        if info["bytes"].as_u64() != Some(data.len() as u64) {
            return Err("Incomplete Compute upload".into());
        }
    }
    endpoint.json_post("/start", b"{}", "application/json", Duration::from_secs(20))?;
    loop {
        if Instant::now() + Duration::from_secs(45) >= deadline {
            return Err("Compute service timed out".into());
        }
        let status = endpoint.json_get("/status", Duration::from_secs(20))?;
        match status["phase"].as_str() {
            Some("completed") => break,
            Some("running") => thread::sleep(Duration::from_secs(2)),
            Some("failed") => {
                return Err("Compute service reported failure; raw task logs suppressed".into())
            }
            _ => return Err("Compute service reported invalid phase".into()),
        }
    }
    let mut result = Vec::new();
    for binding in outputs {
        let name = binding["name"].as_str().ok_or("Invalid output binding")?;
        let target = PathBuf::from(
            binding["file"]
                .as_str()
                .ok_or("Invalid output destination")?,
        );
        result.push(endpoint.output(name, &target)?);
    }
    Ok(result)
}
