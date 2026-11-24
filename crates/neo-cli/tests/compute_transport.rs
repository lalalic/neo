use neo_harness_cli::compute_transport::{run_service, Endpoint};
use serde_json::json;
use std::{
    fs,
    io::{BufRead, BufReader, Read, Write},
    net::TcpListener,
    thread,
    time::{Duration, Instant},
};
fn server(reply_size: Option<usize>) -> (Endpoint, thread::JoinHandle<Vec<String>>) {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let port = listener.local_addr().unwrap().port();
    let handle = thread::spawn(move || {
        let mut paths = Vec::new();
        for index in 0..5 {
            let (mut socket, _) = listener.accept().unwrap();
            socket
                .set_read_timeout(Some(Duration::from_secs(5)))
                .unwrap();
            let mut reader = BufReader::new(socket.try_clone().unwrap());
            let mut line = String::new();
            reader.read_line(&mut line).unwrap();
            let path = line.split_whitespace().nth(1).unwrap().to_string();
            paths.push(path.clone());
            let mut size = 0usize;
            loop {
                line.clear();
                reader.read_line(&mut line).unwrap();
                if line == "\r\n" || line.is_empty() {
                    break;
                }
                if line.to_ascii_lowercase().starts_with("content-length:") {
                    size = line.split(':').nth(1).unwrap().trim().parse().unwrap();
                }
            }
            let mut body = vec![0; size];
            reader.read_exact(&mut body).unwrap();
            if index == 1 {
                assert_eq!(body, b"SYNTHETIC_INPUT");
            }
            let response = match index {
                0 => json!({"ok":true,"service":"neo-gpu-v1"})
                    .to_string()
                    .into_bytes(),
                1 => json!({"bytes":body.len()}).to_string().into_bytes(),
                2 => b"{}".to_vec(),
                3 => json!({"phase":"completed"}).to_string().into_bytes(),
                _ => b"SYNTHETIC_OUTPUT".to_vec(),
            };
            let length = if index == 4 {
                reply_size.unwrap_or(response.len())
            } else {
                response.len()
            };
            let head=format!("HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {length}\r\nConnection: close\r\n\r\n");
            socket.write_all(head.as_bytes()).unwrap();
            socket.write_all(&response).unwrap();
        }
        paths
    });
    (Endpoint::local(port).unwrap(), handle)
}
#[test]
fn native_compute_service_uploads_and_atomically_publishes_verified_output() {
    let temp = tempfile::tempdir().unwrap();
    let input = temp.path().join("input.bin");
    let output = temp.path().join("output.bin");
    fs::write(&input, "SYNTHETIC_INPUT").unwrap();
    let (endpoint, server) = server(None);
    let result = run_service(
        &endpoint,
        &[json!({"name":"media","file":input})],
        &[json!({"name":"result","file":output})],
        Instant::now() + Duration::from_secs(95),
    )
    .unwrap();
    assert_eq!(result.len(), 1);
    assert_eq!(result[0]["bytes"], 16);
    assert_eq!(fs::read(&output).unwrap(), b"SYNTHETIC_OUTPUT");
    assert_eq!(
        server.join().unwrap(),
        vec![
            "/health",
            "/inputs/media",
            "/start",
            "/status",
            "/outputs/result"
        ]
    );
}
#[test]
fn native_compute_rejects_truncated_download_and_never_publishes_partial_output() {
    let temp = tempfile::tempdir().unwrap();
    let input = temp.path().join("input.bin");
    let output = temp.path().join("output.bin");
    fs::write(&input, "SYNTHETIC_INPUT").unwrap();
    let (endpoint, server) = server(Some(20));
    let result = run_service(
        &endpoint,
        &[json!({"name":"media","file":input})],
        &[json!({"name":"result","file":output})],
        Instant::now() + Duration::from_secs(95),
    );
    assert!(result.is_err());
    assert!(!output.exists());
    server.join().unwrap();
    let extra = fs::read_dir(temp.path())
        .unwrap()
        .map(|e| e.unwrap().file_name().to_string_lossy().to_string())
        .filter(|name| name.contains("neo-compute-part"))
        .collect::<Vec<_>>();
    assert!(extra.is_empty(), "partial output should be removed");
}
