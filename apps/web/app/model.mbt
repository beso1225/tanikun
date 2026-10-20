///|
pub(all) enum Msg {
  Increment
  Reset
}

///|
pub fn update(count : Int, msg : Msg) -> Int {
  match msg {
    Increment => count + 1
    Reset => 0
  }
}
