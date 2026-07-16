export type ConnectionResponseSet = {
  quickReplies: readonly string[];
  followUps: readonly string[];
};

export const CONNECTION_PROMPTS = [
  {
    label: "Hey 👋",
    message: "Hey 👋"
  },
  {
    label: "Want to link up?",
    message: "Want to link up?"
  },
  {
    label: "Give me a call",
    message: "Give me a call when you're free."
  },
  {
    label: "Coffee?",
    message: "Want to grab coffee?"
  },
  {
    label: "Let's go on a date",
    message: "Would you like to go on a date?"
  },
  {
    label: "Share my glow",
    message: "I'm nearby. My glow is on."
  }
] as const;

const GREETING_RESPONSES: ConnectionResponseSet = {
  quickReplies: ["Hey 👋", "Hi, good to hear from you", "How are you doing?"],
  followUps: ["What are you up to?", "Want to link up?"]
};

const WELLBEING_RESPONSES: ConnectionResponseSet = {
  quickReplies: ["I'm doing well", "I'm okay", "Could be better"],
  followUps: ["How about you?", "What are you up to today?"]
};

const PLANS_RESPONSES: ConnectionResponseSet = {
  quickReplies: ["Yes, let's do it", "Maybe later", "What did you have in mind?"],
  followUps: ["When are you free?", "Would you prefer coffee or a quick catch-up?"]
};

const AVAILABILITY_RESPONSES: ConnectionResponseSet = {
  quickReplies: ["I'm free later today", "This weekend works", "I'm not sure yet"],
  followUps: ["What day works for you?", "Would morning or evening be better?"]
};

const AREA_RESPONSES: ConnectionResponseSet = {
  quickReplies: ["Somewhere public works", "Around my area works", "Let's decide later"],
  followUps: ["What general area works for you?", "Would you prefer somewhere quiet?"]
};

const CALL_RESPONSES: ConnectionResponseSet = {
  quickReplies: ["I'll call you soon", "Can I call later?", "Send me a message first"],
  followUps: ["What time works for a call?", "Is everything okay?"]
};

const COFFEE_RESPONSES: ConnectionResponseSet = {
  quickReplies: ["Coffee sounds good", "Maybe another day", "Tea works for me"],
  followUps: ["What time works for you?", "What general area works for you?"]
};

const DATE_RESPONSES: ConnectionResponseSet = {
  quickReplies: ["I'd love to", "Maybe another time", "Tell me what you have in mind"],
  followUps: ["What day works for you?", "Would you prefer something casual?"]
};

const NEARBY_RESPONSES: ConnectionResponseSet = {
  quickReplies: ["I can see your glow", "I'm nearby too", "I can't meet right now"],
  followUps: ["Want to link up?", "How long will you be around?"]
};

const CONFIRMATION_RESPONSES: ConnectionResponseSet = {
  quickReplies: ["Great, sounds good", "Perfect", "I'll let you know when I'm ready"],
  followUps: ["What time works for you?", "What general area works for you?"]
};

const RESCHEDULE_RESPONSES: ConnectionResponseSet = {
  quickReplies: ["No worries", "Another day works", "Let me know when you're free"],
  followUps: ["Would this weekend work?", "What day is better for you?"]
};

const GENERAL_RESPONSES: ConnectionResponseSet = {
  quickReplies: ["Sounds good", "Tell me more", "I'll get back to you"],
  followUps: ["When are you free?", "What did you have in mind?"]
};

function normalizeMessage(message: string) {
  return message
    .toLocaleLowerCase()
    .replace(/[’']/g, "'")
    .replace(/[^a-z0-9\s']/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function includesAny(message: string, phrases: readonly string[]) {
  return phrases.some((phrase) => message.includes(phrase));
}

export function connectionResponsesFor(message: string): ConnectionResponseSet {
  const normalized = normalizeMessage(message);

  if (includesAny(normalized, ["when are you free", "what time", "what day", "weekend", "later today", "morning", "evening", "available", "i'm free"])) {
    return AVAILABILITY_RESPONSES;
  }

  if (includesAny(normalized, ["what area", "where should", "where can", "somewhere", "public works", "my area", "meet at"])) {
    return AREA_RESPONSES;
  }

  if (includesAny(normalized, ["coffee", "tea"])) return COFFEE_RESPONSES;
  if (includesAny(normalized, ["call", "phone"])) return CALL_RESPONSES;
  if (includesAny(normalized, ["date", "something casual"])) return DATE_RESPONSES;
  if (includesAny(normalized, ["nearby", "glow", "around"])) return NEARBY_RESPONSES;
  if (includesAny(normalized, ["how are you", "how about you", "doing well", "i'm okay", "could be better"])) return WELLBEING_RESPONSES;
  if (includesAny(normalized, ["link up", "catch up", "what did you have in mind", "want to meet", "make plans"])) return PLANS_RESPONSES;
  if (includesAny(normalized, ["maybe", "another day", "another time", "not sure", "busy", "can't", "cannot", "later works"])) return RESCHEDULE_RESPONSES;
  if (includesAny(normalized, ["yes", "sounds good", "perfect", "great", "i'd love", "let's do it", "works for me"])) return CONFIRMATION_RESPONSES;
  if (includesAny(normalized, ["hey", "hello", "hi", "good to hear"])) return GREETING_RESPONSES;

  return GENERAL_RESPONSES;
}
