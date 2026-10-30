///|
let last_saved_text : @ref.Ref[String] = @ref.Ref("")

///|
let pending_text : @ref.Ref[String] = @ref.Ref("")

///|
// Keep this prefix in sync with apps/web/public/persistence.js.
let storage_error_prefix = "__tanikun_storage_error__"

///|
enum StorageLoadResult {
  Loaded(String)
  Missing
  Failed(String)
}

///|
fn app_init(emit : Emit[@app.PlannerMsg]) -> (@app.PlannerState, @rabbita.Cmd) {
  let state = initial_planner_state()
  let initial_text = @app.encode_planner_state(state)
  last_saved_text.val = initial_text
  pending_text.val = ""
  let command = @rabbita.perform(
    result => {
      match result {
        Loaded(text) => {
          last_saved_text.val = text
          emit(@app.PlannerMsg::Hydrate(text~))
        }
        Missing =>
          emit(
            @app.PlannerMsg::StorageStatusChanged(
              status=@app.StorageStatus::Saved,
              text=initial_text,
            ),
          )
        Failed(message) => emit(@app.PlannerMsg::StorageLoadFailed(message~))
      }
    },
    async fn() noraise {
      try {
        let text = storage_load()
        if text.has_prefix(storage_error_prefix) {
          Failed(text[storage_error_prefix.length():].to_owned())
        } else if text.is_empty() {
          Missing
        } else {
          Loaded(text)
        }
      } catch {
        _ => Failed("保存データを読み込めません")
      }
    },
  )
  (state, command)
}

///|
fn app_update(
  state : @app.PlannerState,
  message : @app.PlannerMsg,
  emit : Emit[@app.PlannerMsg],
) -> (@app.PlannerState, @rabbita.Cmd) {
  let next = @app.update_planner(state, message)
  let discarding = match message {
    @app.PlannerMsg::DiscardStoredPlan => true
    _ => false
  }
  if discarding {
    last_saved_text.val = ""
    pending_text.val = ""
  }
  match message {
    @app.PlannerMsg::Hydrate(_) | @app.PlannerMsg::StorageStatusChanged(_) =>
      (next, @rabbita.none)
    _ =>
      if next.revision == state.revision {
        (next, @rabbita.none)
      } else if !discarding &&
        state.storage_status == @app.StorageStatus::LoadFailed {
        (next, @rabbita.none)
      } else {
        let text = @app.encode_planner_state(next)
        let queued = text == pending_text.val
        let up_to_date = text == last_saved_text.val && pending_text.val == ""
        if queued || up_to_date {
          (next, @rabbita.none)
        } else {
          pending_text.val = text
          let unsaved = emit(
            @app.PlannerMsg::StorageStatusChanged(
              status=@app.StorageStatus::Unsaved,
              text~,
            ),
          )
          // Delay only the label: the write below starts immediately, while
          // the short window lets the Unsaved label paint.
          let saving = @rabbita.delay(
            emit(
              @app.PlannerMsg::StorageStatusChanged(
                status=@app.StorageStatus::Saving,
                text~,
              ),
            ),
            100,
          )
          let save = @rabbita.perform(
            saved => {
              if saved {
                if pending_text.val == text {
                  pending_text.val = ""
                  last_saved_text.val = text
                }
                emit(
                  @app.PlannerMsg::StorageStatusChanged(
                    status=@app.StorageStatus::Saved,
                    text~,
                  ),
                )
              } else {
                if pending_text.val == text {
                  pending_text.val = ""
                }
                emit(
                  @app.PlannerMsg::StorageStatusChanged(
                    status=@app.StorageStatus::Failed,
                    text~,
                  ),
                )
              }
            },
            async fn() noraise {
              try {
                storage_save(text)
                true
              } catch {
                _ => false
              }
            },
          )
          (next, @rabbita.batch([unsaved, saving, save]))
        }
      }
  }
}
