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
  if @tanikun-domain.is_blank(name) {
    Err(@tanikun-domain.DomainError::EmptyCategoryName)
  } else {
    Ok({ id, name, })
  }
}
