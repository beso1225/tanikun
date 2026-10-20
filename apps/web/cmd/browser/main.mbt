///|
using @rabbita {type Html, type Val}

///|
using @html {button, div, h1, p}

///|
fn app() -> Val[Html] {
  let (count, emit) = @rabbita.create_pure_state(0, update=@app.update)
  count.view(count => {
    div(class="mx-auto mt-[12vh] max-w-2xl p-8", [
      h1(class="text-3xl font-bold", "応物単位くん"),
      p(class="mt-4", "単位の計算難しすぎるっぴ"),
      p(class="mt-4", "カウント: \{count}"),
      div(class="mt-6 flex gap-3 bg-canvas", [
        button(on_click=emit(@app.Increment), "増やす"),
        button(on_click=emit(@app.Reset), "リセット"),
      ]),
    ])
  })
}

///|
fn main {
  @rabbita.new(app).mount("app")
}
