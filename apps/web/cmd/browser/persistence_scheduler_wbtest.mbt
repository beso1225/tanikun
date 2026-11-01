///|
fn scheduler_seed() -> @app.PlannerState {
  @app.sample_state()
}

///|
fn ready_scheduler() -> PersistenceModel raise {
  let seed = scheduler_seed()
  let (model, request) = PersistenceModel::new(seed).update(
    ReadFinished(Ok(@app.encode_planner_state(seed))),
  )
  assert_true(request is None)
  model
}

///|
fn scheduler_text(model : PersistenceModel) -> String {
  @app.encode_planner_state(model.planner)
}

///|
test "UI-only edits and storage notifications do not schedule a write" {
  let seed = ready_scheduler()
  let text = scheduler_text(seed)
  let (model, request) = seed.update(Planner(@app.PlannerMsg::OpenSettings))
  assert_eq(request, None)
  assert_eq(model.pending_text, None)
  for
    message in [
      @app.PlannerMsg::StorageSaveFailed(message="Failure", text~),
      @app.PlannerMsg::StorageLoadFailed(message="Unreadable"),
      @app.PlannerMsg::StorageStatusChanged(
        status=@app.StorageStatus::Unsaved,
        text~,
      ),
      @app.PlannerMsg::StorageStatusChanged(
        status=@app.StorageStatus::Saving,
        text~,
      ),
      @app.PlannerMsg::StorageStatusChanged(
        status=@app.StorageStatus::Saved,
        text~,
      ),
      @app.PlannerMsg::Hydrate(text~),
    ] {
    let (next, request) = model.update(Planner(message))
    assert_eq(request, None)
    assert_eq(next.pending_text, None)
  }
}

///|
test "a pending removal requires a compensating write after Undo" {
  let seed = ready_scheduler()
  let (removed, request) = seed.update(
    Planner(
      @app.PlannerMsg::RemoveEnrollment(
        offering_id=@tanikun-domain.OfferingId::new("phy101-s1").unwrap(),
      ),
    ),
  )
  assert_eq(request, Some(Write(text=scheduler_text(removed), replace=false)))
  let (undone, request) = removed.update(
    Planner(@app.PlannerMsg::UndoEnrollmentRemoval),
  )
  assert_eq(scheduler_text(undone), scheduler_text(seed))
  assert_eq(request, Some(Write(text=scheduler_text(seed), replace=false)))
}

///|
test "failed loads protect edits until explicit discard" {
  let (failed, request) = PersistenceModel::new(scheduler_seed()).update(
    ReadFinished(Err("Unreadable")),
  )
  assert_eq(request, None)
  assert_true(failed.planner.storage_status == @app.StorageStatus::LoadFailed)
  let (edited, request) = failed.update(
    Planner(@app.PlannerMsg::SelectTerm(term=@app.PlannerTerm::S2)),
  )
  assert_eq(request, None)
  assert_eq(edited.pending_text, None)
  let (discarded, request) = edited.update(
    Planner(@app.PlannerMsg::DiscardStoredPlan),
  )
  assert_eq(request, Some(Write(text=scheduler_text(discarded), replace=true)))
  assert_true(discarded.planner.storage_status == @app.StorageStatus::Unsaved)
}

///|
test "scheduler instances own their acknowledgements and pending writes" {
  let left = ready_scheduler()
  let right = ready_scheduler()
  let (left, _) = left.update(
    Planner(@app.PlannerMsg::SelectTerm(term=@app.PlannerTerm::S2)),
  )
  let (left, _) = left.update(
    WriteFinished(text=scheduler_text(left), result=Ok(())),
  )
  assert_eq(left.last_saved_text, Some(scheduler_text(left)))
  assert_eq(right.last_saved_text, Some(scheduler_text(right)))
  assert_true(left.last_saved_text != right.last_saved_text)
  let (right, request) = right.update(
    Planner(@app.PlannerMsg::SelectTerm(term=@app.PlannerTerm::S2)),
  )
  assert_eq(request, Some(Write(text=scheduler_text(right), replace=false)))
  assert_eq(left.pending_text, None)
  assert_eq(right.pending_text, Some(scheduler_text(right)))
}

///|
test "unchanged source and a duplicate queued document do not write again" {
  let seed = ready_scheduler()
  let (_, request) = seed.update(
    Planner(@app.PlannerMsg::SelectTerm(term=@app.PlannerTerm::S1)),
  )
  assert_eq(request, None)
  let (edited, _) = seed.update(
    Planner(@app.PlannerMsg::SelectTerm(term=@app.PlannerTerm::S2)),
  )
  let (_, request) = edited.update(Planner(@app.PlannerMsg::OpenSettings))
  assert_eq(request, None)
  let (_, request) = edited.update(
    Planner(@app.PlannerMsg::SelectTerm(term=@app.PlannerTerm::S2)),
  )
  assert_eq(request, None)
}

///|
test "stale success and failure preserve the current pending document and Undo" {
  for result in [Ok(()), Err("Old write failed")] {
    let seed = ready_scheduler()
    let (first, _) = seed.update(
      Planner(@app.PlannerMsg::SelectTerm(term=@app.PlannerTerm::S2)),
    )
    let (current, _) = first.update(
      Planner(
        @app.PlannerMsg::RemoveEnrollment(
          offering_id=@tanikun-domain.OfferingId::new("phy101-s1").unwrap(),
        ),
      ),
    )
    let (current, _) = current.update(
      Planner(
        @app.PlannerMsg::StorageStatusChanged(
          status=@app.StorageStatus::Unsaved,
          text=scheduler_text(current),
        ),
      ),
    )
    let revision = current.planner.revision
    let (current, request) = current.update(
      WriteFinished(text=scheduler_text(first), result~),
    )
    assert_eq(request, None)
    assert_eq(current.pending_text, Some(scheduler_text(current)))
    assert_eq(current.last_saved_text, seed.last_saved_text)
    assert_true(current.planner.storage_status == @app.StorageStatus::Unsaved)
    assert_true(current.planner.error is None)
    assert_true(current.planner.undo_available())
    assert_eq(current.planner.revision, revision)
    let (saved, _) = current.update(
      WriteFinished(text=scheduler_text(current), result=Ok(())),
    )
    assert_eq(saved.last_saved_text, Some(scheduler_text(saved)))
    assert_eq(saved.pending_text, None)
    assert_true(saved.planner.undo_available())
  }
}

///|
test "an ambiguous failed write requires saving the previously acknowledged source again" {
  let seed = ready_scheduler()
  let (edited, _) = seed.update(
    Planner(@app.PlannerMsg::SelectTerm(term=@app.PlannerTerm::S2)),
  )
  let (failed, _) = edited.update(
    WriteFinished(text=scheduler_text(edited), result=Err("Timeout")),
  )
  assert_true(failed.planner.storage_status == @app.StorageStatus::Failed)
  let (returned, request) = failed.update(
    Planner(@app.PlannerMsg::SelectTerm(term=@app.PlannerTerm::S1)),
  )
  assert_eq(scheduler_text(returned), scheduler_text(seed))
  assert_eq(request, Some(Write(text=scheduler_text(seed), replace=false)))
}

///|
test "a missing document seeds before hydration" {
  let model = PersistenceModel::new(scheduler_seed())
  let (seeding, request) = model.update(ReadFinished(Ok("")))
  assert_eq(request, Some(Write(text=scheduler_text(model), replace=false)))
  assert_true(seeding.planner.storage_status == @app.StorageStatus::Loading)
  let (saved, request) = seeding.update(
    WriteFinished(text=scheduler_text(seeding), result=Ok(())),
  )
  assert_eq(request, None)
  assert_true(saved.planner.storage_status == @app.StorageStatus::Saved)
  assert_eq(saved.pending_text, None)
}

///|
test "a failed seed re-reads storage and remains retryable if it is still empty" {
  let (seeding, _) = PersistenceModel::new(scheduler_seed()).update(
    ReadFinished(Ok("")),
  )
  let (recovering, request) = seeding.update(
    WriteFinished(text=scheduler_text(seeding), result=Err("Quota")),
  )
  assert_eq(request, Some(Read))
  let (failed, request) = recovering.update(ReadFinished(Ok("")))
  assert_eq(request, None)
  assert_true(failed.planner.storage_status == @app.StorageStatus::Failed)
  assert_eq(failed.planner.error.unwrap().message, "Quota")
  let (edited, request) = failed.update(
    Planner(@app.PlannerMsg::SelectTerm(term=@app.PlannerTerm::S2)),
  )
  assert_eq(request, Some(Write(text=scheduler_text(edited), replace=false)))
}

///|
test "seed recovery hydrates a winning document or protects a failed re-read" {
  let (seeding, _) = PersistenceModel::new(scheduler_seed()).update(
    ReadFinished(Ok("")),
  )
  let (recovering, _) = seeding.update(
    WriteFinished(text=scheduler_text(seeding), result=Err("Conflict")),
  )
  let winner = @app.update_planner(
    scheduler_seed(),
    @app.PlannerMsg::SelectTerm(term=@app.PlannerTerm::S2),
  )
  let (saved, request) = recovering.update(
    ReadFinished(Ok(@app.encode_planner_state(winner))),
  )
  assert_eq(request, None)
  assert_true(saved.planner.storage_status == @app.StorageStatus::Saved)
  assert_true(saved.planner.selected_term == @app.PlannerTerm::S2)
  let (failed, request) = recovering.update(ReadFinished(Err("Read failed")))
  assert_eq(request, None)
  assert_true(failed.planner.storage_status == @app.StorageStatus::LoadFailed)
  let (_, request) = failed.update(Planner(@app.PlannerMsg::OpenSettings))
  assert_eq(request, None)
}

///|
test "a corrupt document never schedules a seed" {
  let (failed, request) = PersistenceModel::new(scheduler_seed()).update(
    ReadFinished(Ok("{broken")),
  )
  assert_eq(request, None)
  assert_true(failed.planner.storage_status == @app.StorageStatus::LoadFailed)
  assert_eq(failed.last_saved_text, None)
}

///|
test "delayed Saving labels cannot replace a completed write outcome" {
  for result in [Ok(()), Err("Reload this tab")] {
    let (edited, _) = ready_scheduler().update(
      Planner(
        @app.PlannerMsg::RemoveEnrollment(
          offering_id=@tanikun-domain.OfferingId::new("phy101-s1").unwrap(),
        ),
      ),
    )
    let text = scheduler_text(edited)
    let (completed, _) = edited.update(WriteFinished(text~, result~))
    let (late_label, request) = completed.update(
      Planner(
        @app.PlannerMsg::StorageStatusChanged(
          status=@app.StorageStatus::Saving,
          text~,
        ),
      ),
    )
    assert_eq(request, None)
    assert_true(late_label == completed)
    assert_true(late_label.planner.undo_available())
  }
}

///|
test "scheduler view equality includes changed recovery guidance without expiring Undo" {
  let (edited, _) = ready_scheduler().update(
    Planner(
      @app.PlannerMsg::RemoveEnrollment(
        offering_id=@tanikun-domain.OfferingId::new("phy101-s1").unwrap(),
      ),
    ),
  )
  let text = scheduler_text(edited)
  let (first, _) = edited.update(WriteFinished(text~, result=Err("Timeout")))
  let (second, request) = first.update(
    Planner(
      @app.PlannerMsg::StorageSaveFailed(message="Reload this tab", text~),
    ),
  )
  assert_eq(request, None)
  assert_true(first != second)
  assert_eq(second.planner.revision, first.planner.revision)
  assert_true(second.planner.undo_available())
}
