///|
/// All bookkeeping belongs to one app instance. This model has no effects;
/// the runtime executes its returned request and sends the result back.
struct PersistenceModel {
  planner : @app.PlannerState
  last_saved_text : String?
  pending_write : PersistenceWrite?
  next_sequence : Int
  startup : PersistenceStartup
}

///|
enum PersistenceStartup {
  Reading
  Seeding
  RecoveringSeed(String)
  Ready
}

///|
enum PersistenceEvent {
  Planner(@app.PlannerMsg)
  ReadFinished(StorageLoadResult)
  WriteFinished(PersistenceWrite, StorageSaveResult)
  WriteStatus(PersistenceWrite, @app.StorageStatus)
}

///|
struct PersistenceWrite {
  sequence : Int
  text : String
  replace : Bool
} derive(Eq, Debug)

///|
enum PersistenceRequest {
  Read
  Write(PersistenceWrite)
} derive(Eq, Debug)

///|
fn PersistenceModel::new(planner : @app.PlannerState) -> PersistenceModel {
  {
    planner,
    last_saved_text: None,
    pending_write: None,
    next_sequence: 1,
    startup: Reading,
  }
}

///|
fn PersistenceModel::write(
  self : PersistenceModel,
  text : String,
  replace : Bool,
) -> (PersistenceModel, PersistenceRequest?) {
  let write = { sequence: self.next_sequence, text, replace, }
  (
    {
      ..self,
      pending_write: Some(write),
      next_sequence: self.next_sequence + 1,
    },
    Some(Write(write)),
  )
}

///|
// Bookkeeping alone does not redraw the planner. The runtime still retains
// the full model for the next event, including changes made during startup.
impl Eq for PersistenceModel with fn equal(self, other) {
  self.planner == other.planner
}

///|
fn PersistenceModel::hydrate(
  self : PersistenceModel,
  text : String,
) -> PersistenceModel {
  let planner = @app.update_planner(
    self.planner,
    @app.PlannerMsg::Hydrate(text~),
  )
  {
    ..self,
    planner,
    last_saved_text: if planner.storage_status == @app.StorageStatus::Saved {
      Some(@app.encode_planner_state(planner))
    } else {
      None
    },
    pending_write: None,
    startup: Ready,
  }
}

///|
fn PersistenceModel::update(
  self : PersistenceModel,
  event : PersistenceEvent,
) -> (PersistenceModel, PersistenceRequest?) {
  match event {
    ReadFinished(result) => {
      match self.startup {
        Ready | Seeding => return (self, None)
        Reading | RecoveringSeed(_) => ()
      }
      match result {
        Failed(message) =>
          (
            {
              ..self,
              startup: Ready,
              planner: @app.update_planner(
                self.planner,
                @app.PlannerMsg::StorageLoadFailed(message~),
              ),
            },
            None,
          )
        Loaded(text) => (self.hydrate(text), None)
        Missing =>
          match self.startup {
            RecoveringSeed(message) =>
              (
                {
                  ..self,
                  startup: Ready,
                  pending_write: None,
                  planner: @app.update_planner(
                    self.planner,
                    @app.PlannerMsg::StorageSaveFailed(
                      message~,
                      text=@app.encode_planner_state(self.planner),
                    ),
                  ),
                },
                None,
              )
            _ => {
              let text = @app.encode_planner_state(self.planner)
              { ..self, startup: Seeding, }.write(text, false)
            }
          }
      }
    }
    WriteStatus(write, status) => {
      if self.pending_write != Some(write) {
        return (self, None)
      }
      (
        {
          ..self,
          planner: @app.update_planner(
            self.planner,
            @app.PlannerMsg::StorageStatusChanged(status~, text=write.text),
          ),
        },
        None,
      )
    }
    WriteFinished(write, result) => {
      // Content can repeat while several writes are in flight. Only the
      // latest request may acknowledge a save or change its visible outcome.
      if self.pending_write != Some(write) {
        return (self, None)
      }
      let text = write.text
      if self.startup is Seeding {
        return match result {
          Saved => (self.hydrate(text), None)
          Failed(message) =>
            (
              { ..self, startup: RecoveringSeed(message), pending_write: None, },
              Some(Read),
            )
        }
      }
      let next = {
        ..self,
        pending_write: None,
        last_saved_text: match result {
          Saved => Some(text)
          Failed(_) => self.last_saved_text
        },
      }
      let message = match result {
        Saved =>
          @app.PlannerMsg::StorageStatusChanged(
            status=@app.StorageStatus::Saved,
            text~,
          )
        Failed(message) => @app.PlannerMsg::StorageSaveFailed(message~, text~)
      }
      ({ ..next, planner: @app.update_planner(next.planner, message), }, None)
    }
    Planner(message) => {
      let planner = @app.update_planner(self.planner, message)
      let next = { ..self, planner, }
      let discarding = message is @app.PlannerMsg::DiscardStoredPlan
      match message {
        @app.PlannerMsg::Hydrate(_) =>
          if planner.storage_status == @app.StorageStatus::Saved {
            (
              {
                ..next,
                last_saved_text: Some(@app.encode_planner_state(planner)),
              },
              None,
            )
          } else {
            (next, None)
          }
        @app.PlannerMsg::StorageStatusChanged(_)
        | @app.PlannerMsg::StorageLoadFailed(_)
        | @app.PlannerMsg::StorageSaveFailed(_) => (next, None)
        _ => {
          if planner.revision == self.planner.revision ||
            (
              !discarding &&
              self.planner.storage_status == @app.StorageStatus::LoadFailed
            ) {
            return (next, None)
          }
          let text = @app.encode_planner_state(planner)
          if !discarding && text == @app.encode_planner_state(self.planner) {
            return (next, None)
          }
          let queued = self.pending_write.map(write => write.text) == Some(text)
          let up_to_date = self.planner.storage_status ==
            @app.StorageStatus::Saved &&
            self.last_saved_text == Some(text) &&
            self.pending_write is None
          if !discarding && (queued || up_to_date) {
            (next, None)
          } else {
            {
              ..next,
              last_saved_text: if discarding {
                None
              } else {
                self.last_saved_text
              },
            }.write(text, discarding)
          }
        }
      }
    }
  }
}
