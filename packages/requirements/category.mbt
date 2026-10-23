///|
/// A category defined by a program's requirement set.
pub struct Category {
  id : @tanikun-domain.CategoryId
  name : String
}

///|
pub fn Category::new(
  id : @tanikun-domain.CategoryId,
  name : String,
) -> Result[Category, @tanikun-domain.DomainError] {
  match
    @tanikun-domain.validate_display_name(
      name,
      @tanikun-domain.DomainError::EmptyCategoryName,
    ) {
    Err(error) => Err(error)
    Ok(_) => Ok({ id, name, })
  }
}
