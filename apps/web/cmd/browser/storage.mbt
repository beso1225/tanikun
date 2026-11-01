///|
/// The explicit load outcome at the JavaScript boundary. `Missing` is distinct
/// from `Failed` so only an absent document can start normal seeding.
pub(all) enum StorageLoadResult {
  Missing
  Loaded(String)
  Failed(String)
} derive(Eq, Debug)

///|
/// The explicit save outcome at the JavaScript boundary.
pub(all) enum StorageSaveResult {
  Saved
  Failed(String)
} derive(Eq, Debug)

///|
let storage_load_failure_message = "保存データを読み込めません"

///|
let storage_save_failure_message = "保存できません。再読み込みしてください"

///|
extern "js" fn storage_configure(validate : (String) -> Bool) -> Unit =
  #| (validate) => globalThis.tanikunStorage.configure(validate)

///|
extern "js" fn replica_id() -> String =
  #| () => crypto.randomUUID() + "-"

///|
/// Validate the raw wire before MoonBit sees it: `Array[String]` erases its
/// element type, so a non-string payload would otherwise reach the planner.
extern "js" fn storage_load_ffi() -> @js_async.Promise[Array[String]] =
  #| () =>
  #|   Promise.resolve()
  #|     .then(() => globalThis.tanikunStorage.loadResult())
  #|     .then(
  #|       (wire) =>
  #|         Array.isArray(wire) &&
  #|         wire.every((part) => typeof part === "string")
  #|           ? wire
  #|           : ["failed"],
  #|       () => ["failed"],
  #|     )

///|
extern "js" fn storage_save_ffi(
  text : String,
  replace : Bool,
) -> @js_async.Promise[Array[String]] =
  #| (text, replace) =>
  #|   Promise.resolve()
  #|     .then(() => globalThis.tanikunStorage.saveResult(text, replace))
  #|     .then(
  #|       (wire) =>
  #|         Array.isArray(wire) &&
  #|         wire.every((part) => typeof part === "string")
  #|           ? wire
  #|           : ["failed"],
  #|       () => ["failed"],
  #|     )

///|
/// Decode the wire array in one place. Unknown tags, missing payloads, empty
/// payloads, and extra fields fail safely instead of reaching the planner.
fn decode_storage_load_result(wire : Array[String]) -> StorageLoadResult {
  match wire.length() {
    1 =>
      if wire[0] == "missing" {
        Missing
      } else {
        Failed(storage_load_failure_message)
      }
    2 =>
      match wire[0] {
        "loaded" =>
          if wire[1].is_empty() {
            Failed(storage_load_failure_message)
          } else {
            Loaded(wire[1])
          }
        "failed" =>
          if wire[1].is_empty() {
            Failed(storage_load_failure_message)
          } else {
            Failed(wire[1])
          }
        _ => Failed(storage_load_failure_message)
      }
    _ => Failed(storage_load_failure_message)
  }
}

///|
fn decode_storage_save_result(wire : Array[String]) -> StorageSaveResult {
  match wire.length() {
    1 =>
      if wire[0] == "saved" {
        Saved
      } else {
        Failed(storage_save_failure_message)
      }
    2 =>
      match wire[0] {
        "failed" =>
          if wire[1].is_empty() {
            Failed(storage_save_failure_message)
          } else {
            Failed(wire[1])
          }
        _ => Failed(storage_save_failure_message)
      }
    _ => Failed(storage_save_failure_message)
  }
}

///|
pub async fn storage_load() -> StorageLoadResult noraise {
  decode_storage_load_result(storage_load_ffi().wait()) catch {
    _ => Failed(storage_load_failure_message)
  }
}

///|
pub async fn storage_save(
  text : String,
  replace? : Bool = false,
) -> StorageSaveResult noraise {
  decode_storage_save_result(storage_save_ffi(text, replace).wait()) catch {
    _ => Failed(storage_save_failure_message)
  }
}
