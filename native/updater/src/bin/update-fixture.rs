// Isolated integration-test process. Never copied into a desktop package.
use std::{
    fs,
    io::{self, Read},
    path::PathBuf,
};
fn main() {
    if std::env::args().any(|arg| arg == "--wait") {
        let _ = io::stdin().read_to_end(&mut Vec::new());
        return;
    }
    let directory = std::env::current_exe()
        .unwrap()
        .parent()
        .unwrap()
        .to_owned();
    if directory.join("fail-start").exists() {
        std::process::exit(1);
    }
    if let Ok(ack) = std::env::var("CUESCORD_UPDATE_TEST_ACK") {
        let version = fs::read_to_string(directory.join("version.txt")).unwrap();
        fs::write(PathBuf::from(ack), format!("{{\"version\":\"{version}\"}}")).unwrap();
    }
}
