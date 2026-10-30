///|
pub(all) enum UiErrorTarget {
  General
  Course(course_id~ : @tanikun-domain.CourseId)
  Offering(offering_id~ : @tanikun-domain.OfferingId)
}

///|
pub(all) enum UiErrorKind {
  DomainValidation
  SlotConflict
  NotOfferedInTerm
  UnknownOffering
  UnknownEnrollment
  MissingRequirementSet
  DifferentAcademicYear
  General
} derive(Eq)

///|
pub extend UiErrorKind with Eq::{not_equal, equal}

///|
pub struct UiError {
  target : UiErrorTarget
  kind : UiErrorKind
  message : String
}

///|
pub fn UiError::new(
  target : UiErrorTarget,
  kind : UiErrorKind,
  message : String,
) -> UiError {
  { target, kind, message, }
}

///|
/// Maps a pure validation error into a UI error without exposing the enum to
/// the view. The target comes from the form or course that produced the error.
pub fn UiError::from_domain(
  error : @tanikun-domain.DomainError,
  target : UiErrorTarget,
) -> UiError {
  let message = match error {
    @tanikun-domain.DomainError::MissingOfferingPhase(_) =>
      "ターム別の授業枠が不足しています"
    @tanikun-domain.DomainError::UnexpectedOfferingPhase(_) =>
      "開講しないタームの授業枠があります"
    @tanikun-domain.DomainError::InvalidAllocationEvidence =>
      "共用枠の確認元を指定してください"
    @tanikun-domain.DomainError::InvalidCredits(_) =>
      "単位数が正しくありません"
    @tanikun-domain.DomainError::InvalidAcademicYear(_) =>
      "年度が正しくありません"
    @tanikun-domain.DomainError::InvalidPeriod(_) =>
      "時限が正しくありません"
    @tanikun-domain.DomainError::EmptyIdField(..) =>
      "IDを入力してください"
    @tanikun-domain.DomainError::ControlCharacterInId(..) =>
      "IDに使用できない文字があります"
    @tanikun-domain.DomainError::EmptyCourseName =>
      "科目名を入力してください"
    @tanikun-domain.DomainError::DuplicateCourseId(_) =>
      "科目IDが重複しています"
    @tanikun-domain.DomainError::EmptyOfferingTerms =>
      "開講学期を指定してください"
    @tanikun-domain.DomainError::DuplicateOfferingTerm(_) =>
      "開講学期が重複しています"
    @tanikun-domain.DomainError::MixedOfferingTerms =>
      "同じセメスターの学期を指定してください"
    @tanikun-domain.DomainError::MissingOfferingSlots =>
      "曜限を指定してください"
    @tanikun-domain.DomainError::UnexpectedOfferingSlots =>
      "この開講では曜限を指定できません"
    @tanikun-domain.DomainError::DuplicateOfferingSlot(_) =>
      "曜限が重複しています"
    @tanikun-domain.DomainError::DuplicateOverride(..) =>
      "同じ上書きが重複しています"
    @tanikun-domain.DomainError::InvalidOverrideCombination(..) =>
      "この属性にはこの値を使えません"
    @tanikun-domain.DomainError::EmptyOverrideText =>
      "上書きの値を入力してください"
    @tanikun-domain.DomainError::EmptyProgramName =>
      "プログラム名を入力してください"
    @tanikun-domain.DomainError::EmptyCategoryName =>
      "区分名を入力してください"
    @tanikun-domain.DomainError::DuplicateCategoryId(_) =>
      "区分IDが重複しています"
    @tanikun-domain.DomainError::UnknownCategory(_) =>
      "区分が見つかりません"
    @tanikun-domain.DomainError::DuplicateCategoryAssignment(_) =>
      "科目の区分が重複しています"
    @tanikun-domain.DomainError::DuplicateRequirementSet(..) =>
      "同じプログラムと年度の要件セットがあります"
    @tanikun-domain.DomainError::EmptyRuleCategories =>
      "区分を指定してください"
    @tanikun-domain.DomainError::DuplicateRuleCategory(_) =>
      "ルールの区分が重複しています"
    @tanikun-domain.DomainError::UnknownRuleCategory(_) =>
      "ルールの区分が見つかりません"
    @tanikun-domain.DomainError::EmptyRuleCourses =>
      "科目を指定してください"
    @tanikun-domain.DomainError::DuplicateRuleCourse(_) =>
      "ルールの科目が重複しています"
    @tanikun-domain.DomainError::UnknownRuleCourse(_) =>
      "ルールの科目が見つかりません"
    @tanikun-domain.DomainError::EmptyRuleChildren =>
      "ルールの子がありません"
    @tanikun-domain.DomainError::InvalidRuleThreshold(_) =>
      "ルールの単位数が正しくありません"
    @tanikun-domain.DomainError::InvalidAtLeastCount(..) =>
      "ルールの個数が子の数と合いません"
    @tanikun-domain.DomainError::DuplicateOfferingId(_) =>
      "開講IDが重複しています"
    @tanikun-domain.DomainError::DuplicateEnrollment(_) =>
      "同じ開講がすでに登録されています"
    @tanikun-domain.DomainError::UnknownOffering(_) =>
      "開講が見つかりません"
    @tanikun-domain.DomainError::UnknownEnrollment(_) =>
      "履修が見つかりません"
    @tanikun-domain.DomainError::UnknownCourse(_) =>
      "科目が見つかりません"
    @tanikun-domain.DomainError::DuplicatePassedCourse(_) =>
      "合格した科目が重複しています"
    @tanikun-domain.DomainError::ProfileRequirementSetMismatch =>
      "プロファイルと要件セットが一致しません"
    @tanikun-domain.DomainError::RetiredCourseEnrollment(_) =>
      "過去科目は履修できません"
    @tanikun-domain.DomainError::NotOfferedEnrollment(_) =>
      "この年度には開講されていません"
    @tanikun-domain.DomainError::PassedSnapshotCourseMismatch(..) =>
      "合格時の科目情報が開講と一致しません"
  }
  UiError::new(target, UiErrorKind::DomainValidation, message)
}

///|
pub(all) enum TimetableError {
  SlotConflict(
    offering_id~ : @tanikun-domain.OfferingId,
    slot~ : @tanikun-domain.Slot
  )
  NotOfferedInTerm(offering_id~ : @tanikun-domain.OfferingId)
  UnknownOffering(offering_id~ : @tanikun-domain.OfferingId)
}

///|
pub fn TimetableError::to_ui(self : TimetableError) -> UiError {
  match self {
    SlotConflict(offering_id~, ..) =>
      UiError::new(
        UiErrorTarget::Offering(offering_id~),
        UiErrorKind::SlotConflict,
        "同じ曜限に別の開講があります",
      )
    NotOfferedInTerm(offering_id~) =>
      UiError::new(
        UiErrorTarget::Offering(offering_id~),
        UiErrorKind::NotOfferedInTerm,
        "選択中の学期には開講されていません",
      )
    UnknownOffering(offering_id~) =>
      UiError::new(
        UiErrorTarget::Offering(offering_id~),
        UiErrorKind::UnknownOffering,
        "開講が見つかりません",
      )
  }
}

///|
/// One field in the custom course form.
