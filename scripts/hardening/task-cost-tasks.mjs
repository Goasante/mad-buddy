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
      { do: "tap", text: "Messages", role: "link" },
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
      { do: "tap", text: "Messages", role: "link" },
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
      { do: "tap", text: "Muddies", role: "link" },
      { do: "expect-text", contains: "Kofi Mensah" }
    ]
  },
  {
    name: "open a Muddy profile",
    from: "/dashboard",
    decisions: 0,
    steps: [
      { do: "tap", text: "Muddies", role: "link" },
      { do: "tap", text: "Kofi Mensah, open profile", role: "button" },
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
      { do: "tap", text: "Kofi Mensah, open profile", role: "button" },
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
      { do: "tap", text: "Linkr", role: "link" },
      { do: "expect-text", contains: "Linkr" }
    ]
  },

  // --- UPFOR --------------------------------------------------------------
  {
    name: "create an UpFor",
    from: "/dashboard",
    decisions: 1, // which activity
    steps: [
      { do: "tap", text: "UpFor", role: "link" },
      { do: "tap", text: "Start an UpFor for Food" },
      { do: "expect-text", contains: "Food" }
    ]
  },
  {
    name: "browse UpFor feed",
    from: "/dashboard",
    decisions: 0,
    steps: [
      { do: "tap", text: "UpFor", role: "link" },
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
    name: "RSVP to a Plan",
    from: "/plans",
    decisions: 1, // going / not going
    steps: [
      { do: "tap", text: "detail-fixture dinner", role: "link" },
      { do: "expect-text", contains: "Going" }
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
