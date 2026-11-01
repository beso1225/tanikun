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
fn finished(
  model : PersistenceModel,
  result : Result[Unit, String],
) -> PersistenceEvent {
  WriteFinished(model.pending_write.unwrap(), result)
}

///|
fn pending_text(model : PersistenceModel) -> String? {
  model.pending_write.map(write => write.text)
}

///|
fn assert_write(
  request : PersistenceRequest?,
  text : String,
  replace? : Bool = false,
) -> Unit raise {
  guard request is Some(Write(write)) else { fail("expected a write request") }
  assert_eq(write.text, text)
  assert_eq(write.replace, replace)
  assert_true(write.sequence > 0)
}

///|
test "an older failure with repeated source cannot suppress a later save" {
  for outcome in [Err("Timeout"), Ok(())] {
    let seed = ready_scheduler()
    let (first, _) = seed.update(
      Planner(@app.PlannerMsg::SelectTerm(term=@app.PlannerTerm::S2)),
    )
    let (second, _) = first.update(
      Planner(@app.PlannerMsg::SelectTerm(term=@app.PlannerTerm::S1)),
    )
    let (third, _) = second.update(
      Planner(@app.PlannerMsg::SelectTerm(term=@app.PlannerTerm::S2)),
    )
    assert_true(
      first.pending_write.unwrap().sequence <
      second.pending_write.unwrap().sequence,
    )
    assert_true(
      second.pending_write.unwrap().sequence <
      third.pending_write.unwrap().sequence,
    )
    let (old_completed, _) = third.update(finished(first, outcome))
    assert_eq(old_completed.pending_write, third.pending_write)
    assert_eq(old_completed.last_saved_text, seed.last_saved_text)
    assert_true(old_completed.planner.error is None)
    let (middle_completed, _) = old_completed.update(finished(second, Ok(())))
    let (latest_completed, _) = middle_completed.update(finished(third, Ok(())))
    assert_eq(latest_completed.last_saved_text, Some(scheduler_text(third)))
    assert_true(
      latest_completed.planner.storage_status == @app.StorageStatus::Saved,
    )
    assert_true(latest_completed.planner.error is None)
    let (returned, request) = latest_completed.update(
      Planner(@app.PlannerMsg::SelectTerm(term=@app.PlannerTerm::S1)),
    )
    assert_write(request, scheduler_text(seed))
    assert_eq(pending_text(returned), Some(scheduler_text(seed)))
  }
}

///|
test "UI-only edits and storage notifications do not schedule a write" {
  let seed = ready_scheduler()
  let text = scheduler_text(seed)
  let (model, request) = seed.update(Planner(@app.PlannerMsg::OpenSettings))
  assert_eq(request, None)
  assert_eq(model.pending_write, None)
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
    assert_eq(next.pending_write, None)
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
  assert_write(request, scheduler_text(removed))
  let (undone, request) = removed.update(
    Planner(@app.PlannerMsg::UndoEnrollmentRemoval),
  )
  assert_eq(scheduler_text(undone), scheduler_text(seed))
  assert_write(request, scheduler_text(seed))
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
  assert_eq(edited.pending_write, None)
  let (discarded, request) = edited.update(
    Planner(@app.PlannerMsg::DiscardStoredPlan),
  )
  assert_write(request, scheduler_text(discarded), replace=true)
  assert_true(discarded.planner.storage_status == @app.StorageStatus::Unsaved)
}

///|
test "scheduler instances own their acknowledgements and pending writes" {
  let left = ready_scheduler()
  let right = ready_scheduler()
  let (left, _) = left.update(
    Planner(@app.PlannerMsg::SelectTerm(term=@app.PlannerTerm::S2)),
  )
  let (left, _) = left.update(finished(left, Ok(())))
  assert_eq(left.last_saved_text, Some(scheduler_text(left)))
  assert_eq(right.last_saved_text, Some(scheduler_text(right)))
  assert_true(left.last_saved_text != right.last_saved_text)
  let (right, request) = right.update(
    Planner(@app.PlannerMsg::SelectTerm(term=@app.PlannerTerm::S2)),
  )
  assert_write(request, scheduler_text(right))
  assert_eq(left.pending_write, None)
  assert_eq(pending_text(right), Some(scheduler_text(right)))
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
    let (current, request) = current.update(finished(first, result))
    assert_eq(request, None)
    assert_eq(pending_text(current), Some(scheduler_text(current)))
    assert_eq(current.last_saved_text, seed.last_saved_text)
    assert_true(current.planner.storage_status == @app.StorageStatus::Unsaved)
    assert_true(current.planner.error is None)
    assert_true(current.planner.undo_available())
    assert_eq(current.planner.revision, revision)
    let (saved, _) = current.update(finished(current, Ok(())))
    assert_eq(saved.last_saved_text, Some(scheduler_text(saved)))
    assert_eq(saved.pending_write, None)
    assert_true(saved.planner.undo_available())
  }
}

///|
test "an ambiguous failed write requires saving the previously acknowledged source again" {
  let seed = ready_scheduler()
  let (edited, _) = seed.update(
    Planner(@app.PlannerMsg::SelectTerm(term=@app.PlannerTerm::S2)),
  )
  let (failed, _) = edited.update(finished(edited, Err("Timeout")))
  assert_true(failed.planner.storage_status == @app.StorageStatus::Failed)
  let (returned, request) = failed.update(
    Planner(@app.PlannerMsg::SelectTerm(term=@app.PlannerTerm::S1)),
  )
  assert_eq(scheduler_text(returned), scheduler_text(seed))
  assert_write(request, scheduler_text(seed))
}

///|
test "a missing document seeds before hydration" {
  let model = PersistenceModel::new(scheduler_seed())
  let (seeding, request) = model.update(ReadFinished(Ok("")))
  assert_write(request, scheduler_text(model))
  assert_true(seeding.planner.storage_status == @app.StorageStatus::Loading)
  let (saved, request) = seeding.update(finished(seeding, Ok(())))
  assert_eq(request, None)
  assert_true(saved.planner.storage_status == @app.StorageStatus::Saved)
  assert_eq(saved.pending_write, None)
}

///|
test "a failed seed re-reads storage and remains retryable if it is still empty" {
  let (seeding, _) = PersistenceModel::new(scheduler_seed()).update(
    ReadFinished(Ok("")),
  )
  let (recovering, request) = seeding.update(finished(seeding, Err("Quota")))
  assert_eq(request, Some(Read))
  let (failed, request) = recovering.update(ReadFinished(Ok("")))
  assert_eq(request, None)
  assert_true(failed.planner.storage_status == @app.StorageStatus::Failed)
  assert_eq(failed.planner.error.unwrap().message, "Quota")
  let (edited, request) = failed.update(
    Planner(@app.PlannerMsg::SelectTerm(term=@app.PlannerTerm::S2)),
  )
  assert_write(request, scheduler_text(edited))
}

///|
test "seed recovery hydrates a winning document or protects a failed re-read" {
  let (seeding, _) = PersistenceModel::new(scheduler_seed()).update(
    ReadFinished(Ok("")),
  )
  let (recovering, _) = seeding.update(finished(seeding, Err("Conflict")))
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
    let write = edited.pending_write.unwrap()
    let (completed, _) = edited.update(finished(edited, result))
    let (late_label, request) = completed.update(
      WriteStatus(write, @app.StorageStatus::Saving),
    )
    assert_eq(request, None)
    assert_true(late_label == completed)
    assert_true(late_label.planner.undo_available())
  }
}

///|
test "old outcomes and labels cannot replace the latest repeated-source outcome" {
  for outcome in [Ok(()), Err("Latest write failed")] {
    let (first, _) = ready_scheduler().update(
      Planner(@app.PlannerMsg::SelectTerm(term=@app.PlannerTerm::S2)),
    )
    let (second, _) = first.update(
      Planner(@app.PlannerMsg::SelectTerm(term=@app.PlannerTerm::S1)),
    )
    let (third, _) = second.update(
      Planner(@app.PlannerMsg::SelectTerm(term=@app.PlannerTerm::S2)),
    )
    let (unsaved, request) = third.update(
      WriteStatus(third.pending_write.unwrap(), @app.StorageStatus::Unsaved),
    )
    assert_eq(request, None)
    for status in [@app.StorageStatus::Unsaved, @app.StorageStatus::Saving] {
      let (old_label, request) = unsaved.update(
        WriteStatus(first.pending_write.unwrap(), status),
      )
      assert_eq(request, None)
      assert_true(
        old_label.planner.storage_status == @app.StorageStatus::Unsaved,
      )
      assert_eq(old_label.pending_write, third.pending_write)
    }
    let (completed, _) = unsaved.update(finished(third, outcome))
    for
      event in [
        finished(first, Err("Old timeout")),
        finished(first, Ok(())),
        finished(second, Ok(())),
        finished(third, Err("Duplicate callback")),
        WriteStatus(first.pending_write.unwrap(), @app.StorageStatus::Unsaved),
        WriteStatus(third.pending_write.unwrap(), @app.StorageStatus::Saving),
      ] {
      let (late, request) = completed.update(event)
      assert_eq(request, None)
      assert_true(late == completed)
      assert_eq(late.last_saved_text, completed.last_saved_text)
      assert_eq(late.pending_write, None)
    }
  }
}

///|
test "seed and discard requests keep a monotonic write identity" {
  let (seed, _) = PersistenceModel::new(scheduler_seed()).update(
    ReadFinished(Ok("")),
  )
  let (saved, _) = seed.update(finished(seed, Ok(())))
  let (edited, _) = saved.update(
    Planner(@app.PlannerMsg::SelectTerm(term=@app.PlannerTerm::S2)),
  )
  let (discarded, request) = edited.update(
    Planner(@app.PlannerMsg::DiscardStoredPlan),
  )
  assert_true(
    seed.pending_write.unwrap().sequence <
    edited.pending_write.unwrap().sequence,
  )
  assert_true(
    edited.pending_write.unwrap().sequence <
    discarded.pending_write.unwrap().sequence,
  )
  assert_write(request, scheduler_text(discarded), replace=true)
  let (late, request) = discarded.update(finished(edited, Err("Old error")))
  assert_eq(request, None)
  assert_eq(late.pending_write, discarded.pending_write)
  assert_true(late.planner.error is None)
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
  let (first, _) = edited.update(finished(edited, Err("Timeout")))
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

///|
test "UI-only edits do not retry a failed save of unchanged source" {
  let (edited, _) = ready_scheduler().update(
    Planner(@app.PlannerMsg::SelectTerm(term=@app.PlannerTerm::S2)),
  )
  let (failed, _) = edited.update(finished(edited, Err("Quota")))
  for
    message in [
      @app.PlannerMsg::OpenSettings,
      @app.PlannerMsg::SelectTerm(term=@app.PlannerTerm::S2),
    ] {
    let (unchanged, request) = failed.update(Planner(message))
    assert_eq(scheduler_text(unchanged), scheduler_text(failed))
    assert_eq(request, None)
  }
}
