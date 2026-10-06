//! Version 1 control protocol. Audio and credentials never appear in logs.
use serde::Deserialize;
use serde_json::Value;

pub const MAX_MESSAGE: usize = 1024 * 1024;
pub const VERSION: u32 = 1;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Method {
    Load,
    Devices,
    Configure,
    Transport,
    Produce,
    Consume,
    CloseConsumer,
    Stats,
    RestartIce,
    IceServers,
    SetBitrate,
    Reply,
    Stop,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Command {
    pub id: u64,
    pub method: Method,
    #[serde(default = "object")]
    pub data: Value,
}
fn object() -> Value {
    Value::Object(Default::default())
}
pub fn decode(bytes: &[u8]) -> Result<Command, &'static str> {
    if bytes.len() > MAX_MESSAGE {
        return Err("message-too-large");
    }
    let command: Command = serde_json::from_slice(bytes).map_err(|_| "invalid-command")?;
    if command.id == 0 || command.id > 9_007_199_254_740_991 || !command.data.is_object() {
        return Err("invalid-command");
    }
    Ok(command)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rejects_incompatible_or_unbounded_commands() {
        for bytes in [
            br#"{"id":0,"method":"stats"}"#.as_slice(),
            br#"{"id":1,"method":"exec"}"#,
            br#"{"id":1,"method":"produce","data":[]}"#,
            br#"{"id":1,"method":"stats","path":"x"}"#,
        ] {
            assert!(decode(bytes).is_err());
        }
        assert!(decode(&vec![b' '; MAX_MESSAGE + 1]).is_err());
        assert!(decode(br#"{"id":1,"method":"configure","data":{"muted":true}}"#).is_ok());
    }
}
