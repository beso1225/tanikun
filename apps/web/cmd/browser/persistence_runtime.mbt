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
        storage_load()
      })
    Some(Write(write)) => {
      let save = @rabbita.perform(
        result => emit(WriteFinished(write, result)),
        async fn() noraise { storage_save(write.text, replace=write.replace) },
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
