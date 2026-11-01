///|
// Keep this prefix in sync with apps/web/public/persistence.js until #124
// replaces the string protocol at the FFI boundary.
let storage_error_prefix = "__tanikun_storage_error__"

///|
fn persistence_command(
  model : PersistenceModel,
  request : PersistenceRequest?,
  emit : Emit[PersistenceEvent],
) -> @rabbita.Cmd {
  match request {
    None => @rabbita.none
    Some(Read) =>
      @rabbita.perform(result => emit(ReadFinished(result)), async fn() noraise {
        try {
          let text = storage_load()
          if text.has_prefix(storage_error_prefix) {
            Err(text[storage_error_prefix.length():].to_owned())
          } else {
            Ok(text)
          }
        } catch {
          _ => Err("保存データを読み込めません")
        }
      })
    Some(Write(write)) => {
      let save = @rabbita.perform(
        result => emit(WriteFinished(write, result)),
        async fn() noraise {
          try {
            let message = storage_save(write.text, replace=write.replace)
            if message.is_empty() {
              Ok(())
            } else {
              Err(message)
            }
          } catch {
            _ =>
              Err("保存できません。再読み込みしてください")
          }
        },
      )
      if model.startup is Seeding {
        return save
      }
      let unsaved = emit(WriteStatus(write, @app.StorageStatus::Unsaved))
      // Delay only the label. The write starts in the same batch immediately.
      let saving = @rabbita.delay(
        emit(WriteStatus(write, @app.StorageStatus::Saving)),
        100,
      )
      @rabbita.batch([unsaved, saving, save])
    }
  }
}

///|
fn app_init(emit : Emit[PersistenceEvent]) -> (PersistenceModel, @rabbita.Cmd) {
  let state = initial_planner_state().with_custom_id_prefix(replica_id())
  storage_configure(text => @app.decode_planner_state(state, text) is Ok(_))
  let model = PersistenceModel::new(state)
  (model, persistence_command(model, Some(Read), emit))
}

///|
fn app_update(
  model : PersistenceModel,
  event : PersistenceEvent,
  emit : Emit[PersistenceEvent],
) -> (PersistenceModel, @rabbita.Cmd) {
  let (next, request) = model.update(event)
  (next, persistence_command(next, request, emit))
}
