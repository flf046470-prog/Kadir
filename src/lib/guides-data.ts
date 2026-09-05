export type Guide = {
  slug: string;
  title: string;
  description: string;
  readTime: string;
  sections: { heading: string; body: string }[];
};

export const guides: Record<string, Guide> = {
  "international-dating": {
    slug: "international-dating",
    title: "A realistic guide to international dating",
    description:
      "What actually makes cross-border relationships work — and the specific ways they fail — from language gaps to mismatched intent.",
    readTime: "6 min read",
    sections: [
      {
        heading: "Start with intent, not chemistry",
        body: "The single biggest predictor of a failed international match isn't distance — it's two people wanting different things and not saying so. State your relationship intent plainly on your profile, and take it seriously when someone else does too."
      },
      {
        heading: "Video call earlier than feels necessary",
        body: "Texting for weeks before a video call is one of the most common patterns in both mismatched expectations and romance scams. A short video call early on tells you more in five minutes than two weeks of messages."
      },
      {
        heading: "Language gaps are normal — plan for them",
        body: "You don't need to share a first language to build something real. Be upfront about what languages you speak, use simple phrasing early on, and treat translation tools as a starting point, not a substitute for patience."
      },
      {
        heading: "Money requests are a hard stop",
        body: "No legitimate international relationship requires you to send money, gift cards, or crypto — especially not urgently, and especially not before you've met in person. Treat any request like this as a reason to stop and report, not negotiate."
      }
    ]
  },
  "online-dating-safety": {
    slug: "online-dating-safety",
    title: "Online dating safety, without the paranoia",
    description:
      "Practical safety habits that don't require distrusting everyone — just being deliberate about the handful of moments that actually matter.",
    readTime: "5 min read",
    sections: [
      {
        heading: "Verify with a video call before you're invested",
        body: "Photos can be old, borrowed, or fake. A live video call — even a short one — is the fastest way to confirm you're talking to a real, consistent person."
      },
      {
        heading: "Meet in public, tell someone your plan",
        body: "For a first in-person meeting, pick a public place, arrange your own transportation, and let a friend know where you'll be and when you expect to be done."
      },
      {
        heading: "Keep early conversations in the app",
        body: "Moving to another messaging platform immediately, before any real trust is built, is a common pressure tactic. It's fine to stay in-app until you're comfortable."
      },
      {
        heading: "Trust the report button",
        body: "If something feels like a script instead of a conversation, or the pacing feels engineered, report it. Reports involving fraud signals or safety threats go to a human-reviewed moderation queue."
      }
    ]
  },
  "first-date-ideas": {
    slug: "first-date-ideas",
    title: "First date ideas that actually reduce awkwardness",
    description:
      "Low-pressure formats that give a first date room to go well — or end early without either person feeling stuck.",
    readTime: "4 min read",
    sections: [
      {
        heading: "Pick something with a built-in activity",
        body: "Coffee-and-just-talk is fine, but a walk, a market, or a casual activity gives you something to do with your hands and eyes when conversation naturally pauses — which it will."
      },
      {
        heading: "Keep it short by default",
        body: "Plan for 60–90 minutes with no hard commitment after. A first date that's going well can always extend; one that isn't shouldn't have to run two hours out of politeness."
      },
      {
        heading: "Choose a place you can leave easily",
        body: "Public, well-lit, easy to leave whenever you want — this matters for comfort regardless of how the date is going."
      }
    ]
  },
  "cross-cultural-dating": {
    slug: "cross-cultural-dating",
    title: "Cross-cultural dating: what to actually expect",
    description:
      "Cultural differences in dating pace, family involvement, and communication style — and how to navigate them without stereotyping.",
    readTime: "5 min read",
    sections: [
      {
        heading: "Ask instead of assuming",
        body: "Dating norms vary enormously even within one country. Treat cultural background as a reason to ask genuine questions, not as a template you assume someone fits."
      },
      {
        heading: "Pace expectations can differ",
        body: "How quickly a relationship 'should' move, how much family is involved, and how directly people state intentions varies by culture and by individual. Talk about it directly rather than guessing."
      },
      {
        heading: "Shared languages help — shared effort helps more",
        body: "You don't need perfect language overlap. What matters more is both people making a visible effort to understand each other, including tolerating the occasional awkward translation."
      }
    ]
  }
};
