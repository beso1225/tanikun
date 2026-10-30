///|
enum StorageLoadResult {
  Loaded(String)
  Missing
  Failed
}

///|
fn app_init(emit : Emit[@app.PlannerMsg]) -> (@app.PlannerState, @rabbita.Cmd) {
  let state = initial_planner_state()
  let command = @rabbita.perform(
    result => {
      match result {
        Loaded(text) => emit(@app.PlannerMsg::Hydrate(text~))
        Missing =>
          emit(
            @app.PlannerMsg::StorageStatusChanged(
              status=@app.StorageStatus::Saved,
              revision=state.revision,
            ),
          )
        Failed =>
          emit(
            @app.PlannerMsg::StorageStatusChanged(
              status=@app.StorageStatus::Failed,
              revision=state.revision,
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
        let revision = next.revision
        let unsaved = emit(
          @app.PlannerMsg::StorageStatusChanged(
            status=@app.StorageStatus::Unsaved,
            revision~,
          ),
        )
        let saving = emit(
          @app.PlannerMsg::StorageStatusChanged(
            status=@app.StorageStatus::Saving,
            revision~,
          ),
        )
        let save = @rabbita.perform(
          saved => {
            if saved {
              emit(
                @app.PlannerMsg::StorageStatusChanged(
                  status=@app.StorageStatus::Saved,
                  revision~,
                ),
              )
            } else {
              emit(
                @app.PlannerMsg::StorageStatusChanged(
                  status=@app.StorageStatus::Failed,
                  revision~,
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
