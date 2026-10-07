use serde::Deserialize;
use sha2::{Digest, Sha512};
use std::{
    collections::HashSet,
    fs,
    io::{Read, Write},
    path::{Path, PathBuf},
    process::{Command, Stdio},
    thread,
    time::{Duration, Instant},
};

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Entry {
    path: String,
    size: u64,
    sha512: String,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Plan {
    schema: u8,
    install: PathBuf,
    stage: PathBuf,
    backup: PathBuf,
    version: String,
    files: Vec<Entry>,
    acknowledgement: PathBuf,
    result: PathBuf,
}
type Result<T> = std::result::Result<T, Box<dyn std::error::Error>>;

fn hash_file(path: &Path) -> Result<String> {
    let mut input = fs::File::open(path)?;
    let mut hash = Sha512::new();
    let mut buffer = [0u8; 65536];
    loop {
        let size = input.read(&mut buffer)?;
        if size == 0 {
            break;
        }
        hash.update(&buffer[..size]);
    }
    Ok(format!("{:x}", hash.finalize()))
}

fn ordinary(path: &Path) -> Result<fs::Metadata> {
    let meta = fs::symlink_metadata(path)?;
    if meta.is_symlink() {
        return Err("links are not permitted".into());
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        if meta.file_attributes() & 0x400 != 0 {
            return Err("reparse points are not permitted".into());
        }
    }
    Ok(meta)
}

fn ordinary_ancestors(path: &Path) -> Result<()> {
    for ancestor in path.ancestors() {
        if !ordinary(ancestor)?.is_dir() {
            return Err("invalid directory".into());
        }
    }
    Ok(())
}

fn valid_relative(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 240
        && value.split('/').all(|part| {
            let base = part.split('.').next().unwrap_or("").to_ascii_lowercase();
            !part.is_empty()
                && !part.ends_with(['.', ' '])
                && part
                    .bytes()
                    .all(|b| b.is_ascii_alphanumeric() || b"_.@+() -".contains(&b))
                && !["con", "prn", "aux", "nul"].contains(&base.as_str())
                && !(base.len() == 4
                    && (base.starts_with("com") || base.starts_with("lpt"))
                    && base.as_bytes()[3].is_ascii_digit())
        })
}

fn tree_files(root: &Path, relative: &Path, actual: &mut HashSet<String>) -> Result<()> {
    for entry in fs::read_dir(root.join(relative))? {
        let entry = entry?;
        let location = relative.join(entry.file_name());
        let meta = ordinary(&root.join(&location))?;
        if meta.is_dir() {
            tree_files(root, &location, actual)?;
        } else if meta.is_file() {
            let name = location.to_str().ok_or("invalid name")?.replace('\\', "/");
            if !actual.insert(name) {
                return Err("duplicate file".into());
            }
        } else {
            return Err("unsupported file".into());
        }
    }
    Ok(())
}

fn verify_tree(plan: &Plan) -> Result<()> {
    ordinary_ancestors(&plan.stage)?;
    let mut actual = HashSet::new();
    tree_files(&plan.stage, Path::new(""), &mut actual)?;
    let mut names = HashSet::new();
    for entry in &plan.files {
        if !valid_relative(&entry.path)
            || !names.insert(entry.path.to_ascii_lowercase())
            || !actual.remove(&entry.path)
        {
            return Err("invalid file catalog".into());
        }
        let location = plan.stage.join(&entry.path);
        let meta = ordinary(&location)?;
        if !meta.is_file() || meta.len() != entry.size || hash_file(&location)? != entry.sha512 {
            return Err("file integrity mismatch".into());
        }
    }
    if !actual.is_empty() {
        return Err("unexpected files".into());
    }
    for required in [
        "Cuescord.exe",
        "resources/app.asar",
        "resources/updater/cuescord-update.exe",
    ] {
        if !names.contains(&required.to_ascii_lowercase()) {
            return Err("incomplete application".into());
        }
    }
    Ok(())
}

fn read_plan(file: &Path, digest: &str) -> Result<Plan> {
    if !ordinary(file)?.is_file()
        || ordinary(file)?.len() > 2 * 1024 * 1024
        || hash_file(file)? != digest
    {
        return Err("plan integrity mismatch".into());
    }
    let plan: Plan = serde_json::from_slice(&fs::read(file)?)?;
    let directory = file.parent().ok_or("invalid plan path")?;
    ordinary_ancestors(directory)?;
    ordinary_ancestors(&plan.install)?;
    if plan.schema != 1
        || plan.files.is_empty()
        || plan.files.len() > 8192
        || !plan.install.is_absolute()
        || !plan.stage.is_absolute()
        || !plan.backup.is_absolute()
        || plan.install.parent().is_none()
        || plan.stage.parent() != plan.install.parent()
        || plan.backup.parent() != plan.install.parent()
        || !plan
            .stage
            .file_name()
            .and_then(|s| s.to_str())
            .is_some_and(|s| s.starts_with(".cuescord-update-"))
        || !plan
            .backup
            .file_name()
            .and_then(|s| s.to_str())
            .is_some_and(|s| s.starts_with(".cuescord-backup-"))
        || plan.acknowledgement != directory.join("started.json")
        || plan.result != directory.join("result.json")
        || plan.install == plan.stage
        || plan.install == plan.backup
        || plan.stage == plan.backup
        || plan.backup.exists()
        || directory.starts_with(&plan.install)
        || directory.starts_with(&plan.stage)
        || plan.acknowledgement.exists()
    {
        return Err("invalid transaction paths".into());
    }
    verify_tree(&plan)?;
    Ok(plan)
}

fn record(plan: &Plan, status: &str) -> Result<()> {
    let mut output = fs::OpenOptions::new()
        .create(true)
        .write(true)
        .truncate(true)
        .open(&plan.result)?;
    output.write_all(
        serde_json::to_string(&serde_json::json!({ "version": plan.version, "status": status }))?
            .as_bytes(),
    )?;
    output.sync_all()?;
    Ok(())
}

fn rename_retry(from: &Path, to: &Path) -> Result<()> {
    let deadline = Instant::now() + Duration::from_secs(20);
    loop {
        match fs::rename(from, to) {
            Ok(()) => return Ok(()),
            Err(error) if Instant::now() >= deadline => return Err(error.into()),
            Err(_) => thread::sleep(Duration::from_millis(200)),
        }
    }
}

fn start(install: &Path) -> Result<std::process::Child> {
    Ok(Command::new(install.join("Cuescord.exe"))
        .current_dir(install)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()?)
}

fn replace(plan: &Plan) -> Result<()> {
    // Revalidate after waiting: no staged code may change while the parent exits.
    verify_tree(plan)?;
    record(plan, "replacing")?;
    rename_retry(&plan.install, &plan.backup)?;
    if let Err(error) = rename_retry(&plan.stage, &plan.install) {
        rename_retry(&plan.backup, &plan.install)?;
        let _ = record(plan, "rolled-back");
        let _ = start(&plan.install);
        return Err(error);
    }
    let _ = record(plan, "starting");
    let started = start(&plan.install);
    let mut child = started.ok();
    let deadline = Instant::now() + Duration::from_secs(60);
    if let Some(app) = child.as_mut() {
        loop {
            if let Ok(bytes) = fs::read(&plan.acknowledgement) {
                if let Ok(ack) = serde_json::from_slice::<serde_json::Value>(&bytes)
                    && ack.get("version").and_then(|v| v.as_str()) == Some(&plan.version)
                {
                    let _ = record(plan, "complete");
                    // Keep the backup; never delete an installation or user files automatically.
                    return Ok(());
                }
            }
            if app.try_wait().ok().flatten().is_some() || Instant::now() >= deadline {
                break;
            }
            thread::sleep(Duration::from_millis(200));
        }
        let _ = app.kill();
        let _ = app.wait();
    }
    let _ = record(plan, "rolling-back");
    rename_retry(&plan.install, &plan.stage)?;
    rename_retry(&plan.backup, &plan.install)?;
    let _ = record(plan, "rolled-back");
    start(&plan.install)?;
    Err("new application did not acknowledge startup; previous application restored".into())
}

#[cfg(windows)]
mod parent {
    use super::*;
    use std::ffi::c_void;
    type Handle = *mut c_void;
    #[link(name = "kernel32")]
    unsafe extern "system" {
        fn OpenProcess(access: u32, inherit: i32, pid: u32) -> Handle;
        fn QueryFullProcessImageNameW(
            process: Handle,
            flags: u32,
            name: *mut u16,
            size: *mut u32,
        ) -> i32;
        fn WaitForSingleObject(handle: Handle, timeout: u32) -> u32;
        fn CloseHandle(handle: Handle) -> i32;
    }
    pub struct Parent(Handle);
    impl Parent {
        pub fn open(pid: u32, install: &Path) -> Result<Self> {
            let handle = unsafe { OpenProcess(0x100000 | 0x1000, 0, pid) };
            if handle.is_null() {
                return Err("parent unavailable".into());
            }
            let parent = Self(handle);
            let mut name = [0u16; 32768];
            let mut length = name.len() as u32;
            if unsafe { QueryFullProcessImageNameW(handle, 0, name.as_mut_ptr(), &mut length) } == 0
            {
                return Err("parent identity unavailable".into());
            }
            let actual = PathBuf::from(String::from_utf16(&name[..length as usize])?);
            if actual != install.join("Cuescord.exe") {
                return Err("unexpected parent executable".into());
            }
            Ok(parent)
        }
        pub fn wait(&self) -> Result<()> {
            if unsafe { WaitForSingleObject(self.0, 90000) } != 0 {
                return Err("parent did not exit".into());
            }
            Ok(())
        }
    }
    impl Drop for Parent {
        fn drop(&mut self) {
            unsafe {
                CloseHandle(self.0);
            }
        }
    }
}

#[cfg(windows)]
fn run() -> Result<()> {
    let args: Vec<_> = std::env::args().collect();
    if args.len() != 4 {
        return Err("invalid arguments".into());
    }
    let plan = read_plan(Path::new(&args[1]), &args[2])?;
    let parent = parent::Parent::open(args[3].parse()?, &plan.install)?;
    record(&plan, "prepared")?;
    println!("ready");
    std::io::stdout().flush()?;
    parent.wait()?;
    match replace(&plan) {
        Ok(()) => Ok(()),
        Err(error) => {
            // If replacement never began, keep the installed application usable.
            let rolled_back = fs::read_to_string(&plan.result)
                .unwrap_or_default()
                .contains("rolled-back");
            if plan.install.exists() && !plan.backup.exists() && !rolled_back {
                let _ = start(&plan.install);
            }
            if !rolled_back {
                let _ = record(&plan, "failed");
            }
            Err(error)
        }
    }
}

fn main() {
    #[cfg(windows)]
    if let Err(error) = run() {
        eprintln!("Cuescord update: {error}");
        std::process::exit(1);
    }
    #[cfg(not(windows))]
    {
        eprintln!("Windows only");
        std::process::exit(1);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rejects_windows_path_aliases() {
        for path in [
            "../evil", "/evil", "a\\b", "a:stream", "NUL.txt", "COM1", "a./file", "a /file", "a//b",
        ] {
            assert!(!valid_relative(path), "{path}");
        }
        assert!(valid_relative("resources/app.asar.unpacked/module.node"));
    }
}
