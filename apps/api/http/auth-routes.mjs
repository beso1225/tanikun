// One route table for the Phase 5 session boundary and the #179 ceremony
// handler. The route metadata is trusted server configuration; request
// bodies and headers never select a route policy.
//
// `kind` selects the implementation layer:
// - `webauthn` routes are delegated to the verified #179 service.
// - `session` routes are implemented by the #180 boundary.
//
// `session` describes how a presented session cookie is handled:
// - `public`: registration and sign-in. A valid session is used for the
//   registration 409 rule and sign-in rotation; an invalid cookie is ignored
//   and cleared.
// - `optional`: session status. No cookie is `200 {"session":null}`; an
//   invalid cookie is `401`.
// - `required`: a valid session is mandatory.
// - `logout`: no valid session still clears and returns 204 without CSRF.
//
// `binding` describes the ceremony cookie:
// - `options`: reuse a valid cookie or mint one only on a successful response.
// - `verify`: require exactly one valid cookie; never mint or rebind.
//
// This table deliberately does not register anything in the Worker bridge.
// #181 must add the fixed-window D1 abuse limits and #182 must add the sync
// principal before these routes can become reachable in a deployed Worker.
const route = (value) => Object.freeze(value);

export const AUTH_ROUTES = Object.freeze({
  "/api/v1/auth/register/options": route({
    id: "registration_options",
    kind: "webauthn",
    methods: ["POST"],
    allow: "POST",
    session: "public",
    csrf: false,
    recent: false,
    touch: false,
    binding: "options",
    body: "json",
  }),
  "/api/v1/auth/register/verify": route({
    id: "registration_verify",
    kind: "webauthn",
    methods: ["POST"],
    allow: "POST",
    session: "public",
    csrf: false,
    recent: false,
    touch: false,
    binding: "verify",
    body: "json",
  }),
  "/api/v1/auth/sign-in/options": route({
    id: "sign_in_options",
    kind: "webauthn",
    methods: ["POST"],
    allow: "POST",
    session: "public",
    csrf: false,
    recent: false,
    touch: false,
    binding: "options",
    body: "json",
  }),
  "/api/v1/auth/sign-in/verify": route({
    id: "sign_in_verify",
    kind: "webauthn",
    methods: ["POST"],
    allow: "POST",
    session: "public",
    csrf: false,
    recent: false,
    touch: false,
    binding: "verify",
    body: "json",
  }),
  "/api/v1/auth/session": route({
    id: "session_status",
    kind: "session",
    methods: ["GET"],
    allow: "GET",
    session: "optional",
    csrf: false,
    recent: false,
    touch: true,
    binding: "none",
    body: "none",
  }),
  "/api/v1/auth/logout": route({
    id: "logout",
    kind: "session",
    methods: ["POST"],
    allow: "POST",
    session: "logout",
    csrf: true,
    recent: false,
    touch: false,
    binding: "none",
    body: "empty",
  }),
  "/api/v1/auth/logout-all": route({
    id: "logout_all",
    kind: "session",
    methods: ["POST"],
    allow: "POST",
    session: "required",
    csrf: true,
    recent: true,
    touch: false,
    binding: "none",
    body: "empty",
  }),
  "/api/v1/auth/step-up/options": route({
    id: "step_up_options",
    kind: "webauthn",
    methods: ["POST"],
    allow: "POST",
    session: "required",
    csrf: true,
    recent: false,
    touch: true,
    binding: "options",
    body: "json",
  }),
  "/api/v1/auth/step-up/verify": route({
    id: "step_up_verify",
    kind: "webauthn",
    methods: ["POST"],
    allow: "POST",
    session: "required",
    csrf: true,
    recent: false,
    touch: true,
    binding: "verify",
    body: "json",
  }),
  "/api/v1/auth/credentials/options": route({
    id: "credential_add_options",
    kind: "webauthn",
    methods: ["POST"],
    allow: "POST",
    session: "required",
    csrf: true,
    recent: true,
    touch: true,
    binding: "options",
    body: "json",
  }),
  "/api/v1/auth/credentials/verify": route({
    id: "credential_add_verify",
    kind: "webauthn",
    methods: ["POST"],
    allow: "POST",
    session: "required",
    csrf: true,
    recent: true,
    touch: true,
    binding: "verify",
    body: "json",
  }),
});

export function matchAuthRoute(pathname) {
  return AUTH_ROUTES[pathname] ?? null;
}
