//! Owns the packaged C ABI. The backend serializes operations internally; only
//! submit/poll may run concurrently. Destruction happens after their last owner.
use crate::protocol::VERSION;
use libloading::Library;
use std::{ffi::c_void, ptr::NonNull};

type Send = unsafe extern "C" fn(*mut c_void, *const u8, usize) -> i32;
type Poll = unsafe extern "C" fn(*mut c_void, *mut u8, usize) -> usize;
type Destroy = unsafe extern "C" fn(*mut c_void);
pub struct Backend {
    handle: NonNull<c_void>,
    send: Send,
    poll: Poll,
    destroy: Destroy,
    _library: Library,
}
// SAFETY: version 1 explicitly guarantees thread-safe submit/poll. The owning
// Arc prevents destruction during either operation; media has its own worker.
unsafe impl std::marker::Send for Backend {}
unsafe impl Sync for Backend {}
impl Backend {
    pub fn load() -> Result<Self, Box<dyn std::error::Error>> {
        let exe = std::env::current_exe()?;
        let folder = exe.parent().ok_or("missing executable folder")?;
        let filename = if cfg!(target_os = "windows") {
            "CuescordVoiceBackend.dll"
        } else if cfg!(target_os = "macos") {
            "libCuescordVoiceBackend.dylib"
        } else {
            "libCuescordVoiceBackend.so"
        };
        // SAFETY: fixed adjacent packaged path; no renderer-supplied libraries.
        unsafe {
            let library = Library::new(folder.join(filename))?;
            let version =
                library.get::<unsafe extern "C" fn() -> u32>(b"cuescord_voice_version\0")?;
            if version() != VERSION {
                return Err("incompatible backend".into());
            }
            let create =
                library.get::<unsafe extern "C" fn() -> *mut c_void>(b"cuescord_voice_create\0")?;
            let send = *library.get::<Send>(b"cuescord_voice_send\0")?;
            let poll = *library.get::<Poll>(b"cuescord_voice_poll\0")?;
            let destroy = *library.get::<Destroy>(b"cuescord_voice_destroy\0")?;
            let handle = NonNull::new(create()).ok_or("backend unavailable")?;
            Ok(Self {
                handle,
                send,
                poll,
                destroy,
                _library: library,
            })
        }
    }
    pub fn submit(&self, bytes: &[u8]) -> bool {
        unsafe { (self.send)(self.handle.as_ptr(), bytes.as_ptr(), bytes.len()) == 0 }
    }
    pub fn poll(&self, bytes: &mut [u8]) -> usize {
        unsafe { (self.poll)(self.handle.as_ptr(), bytes.as_mut_ptr(), bytes.len()) }
    }
}
impl Drop for Backend {
    fn drop(&mut self) {
        unsafe { (self.destroy)(self.handle.as_ptr()) };
    }
}
