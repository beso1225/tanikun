///|
/// All bookkeeping belongs to one app instance. This model has no effects;
/// the runtime executes its returned request and sends the result back.
struct PersistenceModel {
  planner : @app.PlannerState
  last_saved_text : String?
  pending_text : String?
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
  ReadFinished(Result[String, String])
  WriteFinished(text~ : String, result~ : Result[Unit, String])
}

///|
enum PersistenceRequest {
  Read
  Write(text~ : String, replace~ : Bool)
} derive(Eq, Debug)

///|
fn PersistenceModel::new(planner : @app.PlannerState) -> PersistenceModel {
  { planner, last_saved_text: None, pending_text: None, startup: Reading, }
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
    planner,
    last_saved_text: if planner.storage_status == @app.StorageStatus::Saved {
      Some(@app.encode_planner_state(planner))
    } else {
      None
    },
    pending_text: None,
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
        Err(message) =>
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
        Ok(text) =>
          if !text.is_empty() {
            (self.hydrate(text), None)
          } else {
            match self.startup {
              RecoveringSeed(message) =>
                (
                  {
                    ..self,
                    startup: Ready,
                    pending_text: None,
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
                (
                  { ..self, startup: Seeding, pending_text: Some(text), },
                  Some(Write(text~, replace=false)),
                )
              }
            }
          }
      }
    }
    WriteFinished(text~, result~) => {
      if self.startup is Seeding {
        return match result {
          Ok(_) => (self.hydrate(text), None)
          Err(message) =>
            (
              { ..self, startup: RecoveringSeed(message), pending_text: None, },
              Some(Read),
            )
        }
      }
      let current = self.pending_text == Some(text)
      let next = if current {
        {
          ..self,
          pending_text: None,
          last_saved_text: match result {
            Ok(_) => Some(text)
            Err(_) => self.last_saved_text
          },
        }
      } else {
        self
      }
      let message = match result {
        Ok(_) =>
          @app.PlannerMsg::StorageStatusChanged(
            status=@app.StorageStatus::Saved,
            text~,
          )
        Err(message) => @app.PlannerMsg::StorageSaveFailed(message~, text~)
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
          let queued = self.pending_text == Some(text)
          let up_to_date = self.planner.storage_status ==
            @app.StorageStatus::Saved &&
            self.last_saved_text == Some(text) &&
            self.pending_text is None
          if !discarding && (queued || up_to_date) {
            (next, None)
          } else {
            (
              {
                ..next,
                last_saved_text: if discarding {
                  None
                } else {
                  self.last_saved_text
                },
                pending_text: Some(text),
              },
              Some(Write(text~, replace=discarding)),
            )
          }
        }
      }
    }
  }
}
