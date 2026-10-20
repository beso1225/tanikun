///|
/// An opaque Automerge document handle owned by the JavaScript bridge.
#external
pub type Doc

///|
/// An opaque list of Automerge changes owned by the JavaScript bridge.
#external
pub type Changes

///|
extern "js" fn js_create() -> Doc =
  #| () => globalThis.__tanikunAutomerge.create()

///|
extern "js" fn js_set(doc : Doc, key : String, value : String) -> Doc =
  #| (doc, key, value) => globalThis.__tanikunAutomerge.set(doc, key, value)

///|
extern "js" fn js_save(doc : Doc) -> Bytes =
  #| (doc) => globalThis.__tanikunAutomerge.save(doc)

///|
extern "js" fn js_load(bytes : Bytes) -> Doc =
  #| (bytes) => globalThis.__tanikunAutomerge.load(bytes)

///|
extern "js" fn js_get(doc : Doc, key : String) -> String =
  #| (doc, key) => globalThis.__tanikunAutomerge.get(doc, key)

///|
extern "js" fn js_changes(from : Doc, to : Doc) -> Changes =
  #| (from, to) => globalThis.__tanikunAutomerge.changes(from, to)

///|
extern "js" fn js_apply(doc : Doc, changes : Changes) -> Doc =
  #| (doc, changes) => globalThis.__tanikunAutomerge.apply(doc, changes)

///|
extern "js" fn js_idb_put(
  key : String,
  bytes : Bytes,
) -> @js_async.Promise[Unit] =
  #| (key, bytes) => globalThis.__tanikunAutomerge.idbPut(key, bytes)

///|
extern "js" fn js_idb_get(key : String) -> @js_async.Promise[Bytes] =
  #| (key) => globalThis.__tanikunAutomerge.idbGet(key)

///|
pub fn create_doc() -> Doc {
  js_create()
}

///|
pub fn set_field(doc : Doc, key : String, value : String) -> Doc {
  js_set(doc, key, value)
}

///|
pub fn save_doc(doc : Doc) -> Bytes {
  js_save(doc)
}

///|
pub fn load_doc(bytes : Bytes) -> Doc {
  js_load(bytes)
}

///|
pub fn get_field(doc : Doc, key : String) -> String {
  js_get(doc, key)
}

///|
pub fn get_changes(from : Doc, to : Doc) -> Changes {
  js_changes(from, to)
}

///|
pub fn apply_changes(doc : Doc, changes : Changes) -> Doc {
  js_apply(doc, changes)
}

///|
pub async fn idb_put(key : String, bytes : Bytes) -> Unit {
  js_idb_put(key, bytes).wait()
}

///|
pub async fn idb_get(key : String) -> Bytes {
  js_idb_get(key).wait()
}
