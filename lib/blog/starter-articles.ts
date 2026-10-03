import type { Article } from "./model";

// Deployment seed, not a fallback content source. Once inserted, the owner
// edits these in Admin; future deploys never overwrite those edits.
export const starterArticles: Article[] = [
  {
    slug: "how-to-make-new-friends-in-accra",
    title: "How to make new friends in Accra, without forcing it",
    description: "New to Accra, or ready to widen your circle? Start with shared interests, low-pressure conversations, and plans that are easy to keep.",
    category: "Friendship", audience: "Adults new to Accra or rebuilding their social circle", searchIntent: "How to make new friends in Accra", feature: "linkr",
    body: `You can live in a busy city and still struggle to find your people. In Accra, a full workweek, long journeys, and different schedules can make friendship feel like something you will get to later.

The answer does not have to be a bigger social calendar. Start with one setting you actually enjoy, one conversation, and one plan you can follow through on.

## Start with something you already like

It is easier to talk when you have something to talk about. If you play guitar, look for opportunities to practise with other musicians. If you enjoy football, a regular game gives you a reason to see the same people again. Design, photography, volunteering, fitness, and language practice can all give a conversation somewhere to begin.

Choose an activity you would enjoy even if you did not meet anyone that day. That takes the pressure off and makes it easier to return.

- Pick one interest, rather than joining everything at once.
- Look for a setting you can reach without stretching your budget or schedule.
- Ask how often people meet and whether newcomers can join.
- Return when you can. Familiar faces make the next hello easier.

## Keep the first conversation small

You do not need a perfect introduction. A question about what is happening around you is enough: “Is this your first time here?” or “How did you get into this?”

Listen to the answer before trying to impress anyone. Share a little about yourself, ask a follow-up question, and give the person space. A brief, comfortable exchange is a better start than a long conversation neither person knows how to end.

If you get along, ask whether they would like to stay in touch. Not every chat needs to become a friendship. Mutual interest matters more than collecting contacts.

## Use online discovery to open a real conversation

Online introductions can help when your usual routine does not bring you into contact with new people. Be clear about what you enjoy and the kind of activity you would like to share. “I enjoy photography and would like to practise with other beginners” gives someone more to respond to than “Looking for friends.”

Mad Buddy’s Linkr is built for deliberately discovering someone new. You choose to enable discovery, approximate proximity stays privacy-safe, and a continuing connection depends on mutual choice. It is a way to begin a conversation, not a promise that everyone nearby wants to meet.

Take your time. You can chat before deciding whether a meeting makes sense, and you do not need to share your home address or exact location to get to know someone.

## Suggest a plan that is easy to accept

“We should hang out sometime” is friendly, but hard to act on. Offer one specific idea instead: a short coffee, an afternoon activity, or joining the same group session next week.

Choose a public place that works for both people. Agree on the time, expected cost, and how long you will stay. For a first meeting, keep your own transport arrangements and let someone you trust know your plans.

If the person cannot make it, leave room for another suggestion. Repeated pressure is not follow-through. You are looking for a connection both people want.

## Build a routine, not a contact list

Friendship usually needs more than a good first conversation. Send a message that refers to something you actually discussed. Suggest another manageable catch-up. Show up when you say you will, and communicate if your plans change.

It is fine to start slowly. One person you enjoy spending time with is more useful than a long list of names you never speak to.

## A simple place to begin this week

Choose one activity you enjoy and one realistic opportunity to take part. Introduce yourself to one person. If the interest is mutual, suggest a small next step.

You do not need to become a different person to make friends in Accra. You need a few chances to meet people who appreciate the person you already are.`
  },
  {
    slug: "friends-nearby-without-sharing-exact-location", title: "Stay close to friends without sharing your exact location",
    description: "What privacy-safe proximity means, how it differs from live tracking, and how to choose when trusted friends can see that you are nearby.",
    category: "Privacy", audience: "Friends who want spontaneous catch-ups without continuous tracking", searchIntent: "See friends nearby without sharing exact location", feature: "muddies",
    body: "## The question to answer\n\nHow can friends notice an opportunity to catch up without needing a map, an exact distance, or a location history?\n\n## Explain the choices\n\nDescribe approved Muddies, approximate proximity, visibility choices, Ghost Mode, and Privacy Zones against the current product. Clearly distinguish ordinary social proximity from the separate Safe Arrival experience.\n\n## End with a useful next step\n\nHelp readers choose a visibility setting that suits them before inviting them to connect with a trusted friend."
  },
  {
    slug: "turn-we-should-meet-into-a-real-plan", title: "Turn “we should meet” into a plan that actually happens",
    description: "A practical way for busy friends to agree on an activity, a time, and a place without getting stuck in a never-ending group chat.",
    category: "Making plans", audience: "Busy friends struggling to arrange a catch-up", searchIntent: "How to organise a meetup with friends", feature: "plans",
    body: "## Start with one decision\n\nExplain why one specific invitation is easier to answer than an open-ended discussion.\n\n## Make the plan manageable\n\nUse an activity, time, place, cost, and a clear response deadline. Include public-meeting and transport considerations where relevant.\n\n## Connect the advice to Plans\n\nShow how a Mad Buddy Plan turns an intention into details people can respond to. Confirm the exact current RSVP and reminder behaviour before writing the finished guide."
  },
  {
    slug: "meet-people-through-shared-interests", title: "Make meeting people easier with a shared interest",
    description: "Music, sport, design, or a simple walk: give a new conversation a starting point by being clear about what you would enjoy doing together.",
    category: "Friendship", audience: "People who prefer activity-led introductions to small talk", searchIntent: "How to meet people with similar interests", feature: "upfor",
    body: "## Give the conversation a starting point\n\nUse specific examples such as guitar practice, football, photography, or a short public walk. Avoid claiming the app automatically matches people by interests.\n\n## Be clear about the invitation\n\nExplain what, when, and how much commitment is involved. Make declining easy.\n\n## Show what you are UpFor\n\nConnect the advice to sharing what you are open to doing right now, using only capabilities confirmed in the current UpFor implementation."
  },
  {
    slug: "why-mad-buddy-is-built-for-real-life-connection", title: "Why Mad Buddy is built for showing up, not just scrolling",
    description: "The idea behind Mad Buddy: use technology to open a conversation, notice a chance to meet, and spend more time with people in real life.",
    category: "Behind Mad Buddy", audience: "People considering Mad Buddy who want to understand its purpose", searchIntent: "What is Mad Buddy and how is it different", feature: "linkr",
    body: "## The founder’s starting point\n\nUse Godfred’s confirmed reason for building Mad Buddy: bridging digital conversation and real-life connection rather than encouraging endless scrolling. Do not invent personal anecdotes.\n\n## Two different kinds of connection\n\nDistinguish trusted Muddies from intentionally enabled Linkr discovery.\n\n## From hello to a shared experience\n\nExplain the role of UpFor and Plans and give a clear privacy-safe invitation to try the product."
  }
];
