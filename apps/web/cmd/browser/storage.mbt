///|
extern "js" fn storage_configure(validate : (String) -> Bool) -> Unit =
  #| (validate) => globalThis.tanikunStorage.configure(validate)

///|
extern "js" fn replica_id() -> String =
  #| () => crypto.randomUUID() + "-"

///|
extern "js" fn storage_load_ffi() -> @js_async.Promise[String] =
  #| () => globalThis.tanikunStorage.load()

///|
extern "js" fn storage_save_ffi(text : String) -> @js_async.Promise[Unit] =
  #| (text) => globalThis.tanikunStorage.save(text)

///|
pub async fn storage_load() -> String {
  storage_load_ffi().wait()
}

///|
pub async fn storage_save(text : String) -> Unit {
  storage_save_ffi(text).wait()
}
