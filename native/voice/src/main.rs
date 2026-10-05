mod backend;
mod protocol;
use protocol::{MAX_MESSAGE, Method, VERSION};
use serde_json::{Value, json};
use std::io::{self, BufRead, Read, Write};
use std::sync::{
    Arc, Mutex,
    atomic::{AtomicBool, Ordering},
};
use std::{thread, time::Duration};
fn emit(out: &Mutex<io::Stdout>, value: &Value) -> io::Result<()> {
    let mut out = out.lock().map_err(|_| io::Error::other("output closed"))?;
    serde_json::to_writer(&mut *out, value)?;
    out.write_all(b"\n")?;
    out.flush()
}
fn run() -> Result<(), Box<dyn std::error::Error>> {
    let backend = Arc::new(backend::Backend::load()?);
    let running = Arc::new(AtomicBool::new(true));
    let output = Arc::new(Mutex::new(io::stdout()));
    emit(
        &output,
        &json!({"type":"ready", "protocol":VERSION, "engine":"libwebrtc-m140", "media":["voice"]}),
    )?;
    let reader_backend = backend.clone();
    let reader_running = running.clone();
    thread::spawn(move || {
        let mut input = io::stdin().lock();
        let mut bytes = Vec::new();
        while reader_running.load(Ordering::Acquire) {
            bytes.clear();
            let read = Read::by_ref(&mut input)
                .take((MAX_MESSAGE + 1) as u64)
                .read_until(b'\n', &mut bytes);
            if !matches!(read, Ok(n) if n > 0 && n <= MAX_MESSAGE && bytes.last() == Some(&b'\n')) {
                break;
            }
            match protocol::decode(&bytes) {
                Ok(command) if matches!(command.method, Method::Stop) => break,
                Ok(_) if reader_backend.submit(&bytes) => {}
                _ => break,
            }
        }
        reader_running.store(false, Ordering::Release);
    });
    let mut buffer = vec![0u8; MAX_MESSAGE];
    while running.load(Ordering::Acquire) {
        let count = backend.poll(&mut buffer);
        if count > buffer.len() {
            return Err("backend protocol failure".into());
        }
        if count > 0 {
            let value: Value = serde_json::from_slice(&buffer[..count])?;
            emit(&output, &value)?;
        } else {
            thread::sleep(Duration::from_millis(5));
        }
    }
    Ok(())
}
fn main() {
    if run().is_err() {
        let _ = emit(
            &Mutex::new(io::stdout()),
            &json!({"type":"fatal", "error":"native-voice-unavailable"}),
        );
        std::process::exit(1);
    }
}
