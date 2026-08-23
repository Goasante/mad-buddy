/**
 * The ordinary goals, and the shortest normal path to each.
 *
 * Every control name here was taken from the crawl inventory, not invented, so
 * a failure means the PATH is wrong rather than the label being mistyped. Where
 * a task ends in a destructive or state-changing mutation, the journey stops at
 * the last screen before commit: measuring the cost of reaching "Create" does
 * not require creating, and this program does not mutate more than it must.
 *
 * `decisions` is the count of genuine choices the user must make on the way --
 * a tab to pick, a type to choose, an audience to set. It is declared rather
 * than measured because a "decision" is a judgement about meaning, not a DOM
 * property; each is justified in the comment beside it.
 */
export const TASKS = [
  // --- MESSAGING ----------------------------------------------------------
  {
    name: "send a message (existing thread)",
    from: "/dashboard",
    decisions: 1, // which conversation
    steps: [
      { do: "tap", text: "Messages", role: "link", href: "/messages" },
      { do: "tap", text: "Kofi Mensah", role: "button" },
      { do: "type", selector: "textarea, input[type=text][placeholder*='essage']", value: "Task-cost probe." },
      { do: "expect-url", contains: "/messages" }
    ]
  },
  {
    name: "start a NEW conversation",
    from: "/dashboard",
    decisions: 1, // which person
    steps: [
      { do: "tap", text: "Messages", role: "link", href: "/messages" },
      { do: "tap", text: "New message" },
      { do: "expect-text", contains: "Kofi" }
    ]
  },

  // --- MUDDIES ------------------------------------------------------------
  {
    name: "find a Muddy",
    from: "/dashboard",
    decisions: 0,
    steps: [
      { do: "tap", text: "Muddies", role: "link", href: "/friends" },
      { do: "expect-text", contains: "Kofi Mensah" }
    ]
  },
  {
    name: "open a Muddy profile",
    from: "/friends",
    decisions: 0,
    steps: [
      { do: "tap", text: "Kofi Mensah, open profile", role: "button", exact: true },
      { do: "expect-text", contains: "@kofim" }
    ]
  },
  {
    name: "open a Muddy profile (from Home)",
    from: "/dashboard",
    decisions: 0,
    /* The same job measured from where the app actually OPENS. Home names the
       person by first name only ("KM Kofi Just Around"), the list uses the full
       name -- so the two surfaces need different labels for one person, which
       is itself worth knowing. */
    steps: [
      { do: "tap", text: "Muddies", role: "link", href: "/friends" },
      /* EXACT accessible name, not a fragment. `/friends` carries TWO controls
         naming this person -- "Kofi Mensah, just around" in the proximity rail
         and "Kofi Mensah, open profile" in the list -- so a fragment match is
         ambiguous and `.first()` silently picks whichever the DOM happens to
         order first. This is the same strict-mode trap the state-graph crawler
         hit; the fix there was identical: select by identity. */
      { do: "tap", text: "Kofi Mensah, open profile", role: "button", exact: true },
      { do: "expect-text", contains: "@kofim" }
    ]
  },
  {
    name: "view a NEARBY Muddy",
    from: "/dashboard",
    decisions: 0,
    // Home surfaces proximity directly; this measures whether "who is around"
    // costs anything beyond opening the app.
    steps: [
      { do: "tap", text: "Kofi, Just Around. Open profile", role: "button" },
      { do: "expect-text", contains: "Kofi" }
    ]
  },
  {
    name: "message a Muddy from their profile",
    from: "/friends",
    decisions: 0,
    steps: [
      { do: "tap", text: "Kofi Mensah, open profile", role: "button", exact: true },
      { do: "tap", text: "Message" },
      { do: "expect-url", contains: "/messages" }
    ]
  },

  // --- LINKR --------------------------------------------------------------
  {
    name: "discover someone in Linkr",
    from: "/dashboard",
    decisions: 1, // opting in is a real consent decision
    steps: [
      { do: "tap", text: "Linkr", role: "link", href: "/linkr" },
      { do: "expect-text", contains: "Linkr" }
    ]
  },

  // --- UPFOR --------------------------------------------------------------
  {
    name: "create an UpFor",
    from: "/dashboard",
    decisions: 1, // which activity
    steps: [
      { do: "tap", text: "UpFor", role: "link", href: "/hangout-mode" },
      { do: "tap", text: "Start an UpFor for Food" },
      { do: "expect-text", contains: "Food" }
    ]
  },
  {
    name: "browse UpFor feed",
    from: "/dashboard",
    decisions: 0,
    steps: [
      { do: "tap", text: "UpFor", role: "link", href: "/hangout-mode" },
      { do: "expect-text", contains: "UpFor" }
    ]
  },

  // --- PLANS --------------------------------------------------------------
  {
    name: "create a Plan (reach the form)",
    from: "/dashboard",
    decisions: 0,
    steps: [
      { do: "tap", text: "See all plans", role: "link" },
      { do: "tap", text: "New plan" },
      { do: "expect-text", contains: "Plan" }
    ]
  },
  {
    name: "create a Plan from Plans tab",
    from: "/plans",
    decisions: 0,
    steps: [
      { do: "tap", text: "New plan" },
      { do: "expect-text", contains: "Plan" }
    ]
  },
  {
    name: "open a Plan you created",
    from: "/plans",
    decisions: 1, // which tab holds it
    steps: [
      /* QA HOSTS this Plan, so it sits under "Created by you" and is correctly
         absent from "Invitations" -- you are not invited to your own Plan.
         Measuring "RSVP" against the host was the wrong task: a host does not
         RSVP. This measures reaching the Plan they own, which is the real job
         from this account. A guest-side RSVP needs a second signed-in account
         and is covered by the Plan membership sequence probe. */
      { do: "tap", text: "Created by you" },
      { do: "tap", text: "detail-fixture dinner" },
      { do: "expect-text", contains: "going" }
    ]
  },

  // --- EVENTS -------------------------------------------------------------
  {
    name: "create an Event (reach the form)",
    from: "/events",
    decisions: 0,
    steps: [
      { do: "tap", text: "Create", exact: true },
      { do: "expect-text", contains: "vent" }
    ]
  },
  {
    name: "open an Event",
    from: "/events",
    decisions: 0,
    steps: [
      { do: "tap", text: "detail-fixture launch night" },
      { do: "expect-text", contains: "launch night" }
    ]
  },

  // --- SAFETY -------------------------------------------------------------
  {
    name: "start Safe Arrival",
    from: "/dashboard",
    decisions: 2, // destination, and who to tell
    steps: [
      { do: "tap", text: "Open quick actions" },
      { do: "tap", text: "Safe Arrival" },
      { do: "tap", text: "Start Safe Arrival" },
      { do: "expect-text", contains: "rrival" }
    ]
  },

  // --- PROFILE / ACCOUNT --------------------------------------------------
  {
    name: "update Profile",
    from: "/dashboard",
    decisions: 0,
    steps: [
      { do: "tap", text: "Menu" },
      { do: "tap", text: "Profile", role: "link" },
      { do: "tap", text: "Edit profile" },
      { do: "expect-text", contains: "rofile" }
    ]
  },
  {
    name: "change a privacy setting",
    from: "/dashboard",
    decisions: 1, // which privacy control
    steps: [
      { do: "tap", text: "Menu" },
      { do: "tap", text: "Settings", role: "link" },
      { do: "tap", text: "Account Privacy" },
      { do: "expect-text", contains: "rivacy" }
    ]
  },
  {
    name: "find account export / deletion",
    from: "/dashboard",
    decisions: 0,
    // A safety-critical control. Regulators and users both expect it to be
    // findable without help; cost here is a trust property, not a convenience.
    steps: [
      { do: "tap", text: "Menu" },
      { do: "tap", text: "Settings", role: "link" },
      { do: "tap", text: "Account", exact: true },
      { do: "expect-text", contains: "ccount" }
    ]
  },
  {
    name: "check notifications",
    from: "/dashboard",
    decisions: 0,
    steps: [
      { do: "tap", text: "Notifications", role: "link" },
      { do: "expect-url", contains: "/notifications" }
    ]
  }
];
