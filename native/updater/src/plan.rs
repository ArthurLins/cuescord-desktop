use serde::Deserialize;
use std::path::{Path, PathBuf};

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct Entry {
    pub path: String,
    pub size: u64,
    pub sha512: String,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct Plan {
    pub schema: u8,
    pub install: PathBuf,
    pub stage: PathBuf,
    pub backup: PathBuf,
    pub version: String,
    pub files: Vec<Entry>,
    pub acknowledgement: PathBuf,
    pub result: PathBuf,
}

impl Plan {
    // Pure transaction policy. The filesystem adapter separately verifies
    // ancestors, existence, file catalog and the signed plan digest.
    pub fn validate_paths(&self, directory: &Path) -> Result<(), &'static str> {
        if self.schema != 1
            || self.files.is_empty()
            || self.files.len() > 8192
            || !self.install.is_absolute()
            || !self.stage.is_absolute()
            || !self.backup.is_absolute()
            || self.install.parent().is_none()
            || self.stage.parent() != self.install.parent()
            || self.backup.parent() != self.install.parent()
            || !self
                .stage
                .file_name()
                .and_then(|s| s.to_str())
                .is_some_and(|s| s.starts_with(".cuescord-update-"))
            || !self
                .backup
                .file_name()
                .and_then(|s| s.to_str())
                .is_some_and(|s| s.starts_with(".cuescord-backup-"))
            || self.acknowledgement != directory.join("started.json")
            || self.result != directory.join("result.json")
            || self.install == self.stage
            || self.install == self.backup
            || self.stage == self.backup
            || directory.starts_with(&self.install)
            || directory.starts_with(&self.stage)
        {
            return Err("invalid transaction paths");
        }
        Ok(())
    }
}

pub(super) fn valid_relative(value: &str) -> bool {
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

    #[cfg(windows)]
    #[test]
    fn transaction_stages_are_siblings_and_acknowledgement_is_local() {
        let directory = Path::new("C:/profile/updates/apply-123");
        let mut plan = Plan {
            schema: 1,
            install: "C:/apps/Cuescord".into(),
            stage: "C:/apps/.cuescord-update-123".into(),
            backup: "C:/apps/.cuescord-backup-123".into(),
            version: "0.5.0".into(),
            files: vec![Entry {
                path: "Cuescord.exe".into(),
                size: 1,
                sha512: "fixture".into(),
            }],
            acknowledgement: directory.join("started.json"),
            result: directory.join("result.json"),
        };
        assert!(plan.validate_paths(directory).is_ok());
        plan.stage = "D:/apps/.cuescord-update-123".into();
        assert!(plan.validate_paths(directory).is_err());
        plan.stage = "C:/apps/.cuescord-update-123".into();
        plan.acknowledgement = "C:/apps/Cuescord/started.json".into();
        assert!(plan.validate_paths(directory).is_err());
    }
}
