///|
extern "js" fn storage_load_ffi() -> @js_async.Promise[String] =
  #| () => globalThis.__tanikunStorage.load()

///|
extern "js" fn storage_save_ffi(text : String) -> @js_async.Promise[Unit] =
  #| (text) => globalThis.__tanikunStorage.save(text)

///|
pub async fn storage_load() -> String {
  storage_load_ffi().wait()
}

///|
pub async fn storage_save(text : String) -> Unit {
  storage_save_ffi(text).wait()
}
