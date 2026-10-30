///|
let last_saved_text : @ref.Ref[String] = @ref.Ref("")

///|
let pending_text : @ref.Ref[String] = @ref.Ref("")

///|
enum StorageLoadResult {
  Loaded(String)
  Missing
  Failed
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
        Failed =>
          emit(
            @app.PlannerMsg::StorageStatusChanged(
              status=@app.StorageStatus::LoadFailed,
              text=initial_text,
            ),
          )
      }
    },
    async fn() noraise {
      try {
        let text = storage_load()
        if text.is_empty() {
          Missing
        } else {
          Loaded(text)
        }
      } catch {
        _ => Failed
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
  match message {
    @app.PlannerMsg::Hydrate(_) | @app.PlannerMsg::StorageStatusChanged(_) =>
      (next, @rabbita.none)
    _ =>
      if next.revision == state.revision {
        (next, @rabbita.none)
      } else {
        let text = @app.encode_planner_state(next)
        if text == last_saved_text.val || text == pending_text.val {
          (next, @rabbita.none)
        } else {
          pending_text.val = text
          let unsaved = emit(
            @app.PlannerMsg::StorageStatusChanged(
              status=@app.StorageStatus::Unsaved,
              text~,
            ),
          )
          let saving = @rabbita.delay(
            emit(
              @app.PlannerMsg::StorageStatusChanged(
                status=@app.StorageStatus::Saving,
                text~,
              ),
            ),
            100,
          )
          let save = @rabbita.delay(
            @rabbita.perform(
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
            ),
            100,
          )
          (next, @rabbita.batch([unsaved, saving, save]))
        }
      }
  }
}
