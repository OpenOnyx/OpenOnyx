export type CompensationStatus =
  | "paid"
  | "unpaid"
  | "volunteer"
  | "internship"
  | "contract"
  | "maintainer"
  | "contributor"
  | "unknown";

export type CareerRole = {
  slug: string;
  title: string;
  team: string;
  type: "Full-time" | "Part-time" | "Contract" | "Internship" | "Maintainer" | "Contributor";
  location: string;
  compensation: {
    status: CompensationStatus;
    label: string;
  };
  description: string;
  skills: string[];
  applyUrl: string;
  isOpen: boolean;
  responsibilities: string[];
  lookingFor: string[];
  niceToHave: string[];
  application: string;
};

export const CAREER_ROLES = [
  {
    slug: "primary-maintainer",
    title: "Primary Maintainer",
    team: "Open Source",
    type: "Maintainer",
    location: "Remote",
    compensation: {
      status: "maintainer",
      label: "Maintainer role · compensation TBD",
    },
    description:
      "Help steward OpenOnyx as an open-source project: review technical direction, improve contributor flow, keep releases healthy, and protect the local-first product philosophy.",
    skills: ["TypeScript", "Electron", "Open source", "Code review", "Release quality"],
    applyUrl: "https://github.com/OpenOnyx/OpenOnyx/discussions",
    isOpen: true,
    responsibilities: [
      "Review pull requests and help contributors understand the architecture.",
      "Keep the project aligned with local-first, Markdown-first, open-source principles.",
      "Help triage issues, plan releases, and improve maintainer documentation.",
      "Identify fragile systems and turn them into clear, testable, durable code paths.",
      "Make technical decisions in the open with enough context for contributors to follow.",
    ],
    lookingFor: [
      "You should be comfortable reading and reviewing TypeScript across frontend, Electron, and tooling code.",
      "You understand how open-source communities work and can give direct, respectful feedback.",
      "You can balance product taste with engineering reliability.",
      "You care about user-owned files, privacy, and software that remains useful over time.",
    ],
    niceToHave: [
      "Experience maintaining an Electron or desktop application.",
      "Experience with release automation, code signing, packaging, or CI.",
      "Experience with knowledge tools, Markdown editors, or graph-based interfaces.",
    ],
    application:
      "Start a GitHub Discussion with context on your open-source work, the parts of OpenOnyx you would improve first, and links to relevant projects or pull requests.",
  },
  {
    slug: "product-manager",
    title: "Product Manager",
    team: "Product",
    type: "Contract",
    location: "Remote",
    compensation: {
      status: "contract",
      label: "Contract · compensation TBD",
    },
    description:
      "Shape the product direction for a local-first knowledge platform: turn user needs, technical constraints, and open-source feedback into clear product decisions.",
    skills: ["Product strategy", "Developer tools", "Knowledge work", "Writing", "Open source"],
    applyUrl: "https://github.com/OpenOnyx/OpenOnyx/discussions",
    isOpen: true,
    responsibilities: [
      "Translate user feedback, issues, and discussions into clear product priorities.",
      "Write concise specs for workflows across editor, graph, vault intelligence, plugins, and MCP.",
      "Work with engineering to separate core product bets from nice-to-have ideas.",
      "Improve onboarding, documentation, and release communication.",
      "Protect the product from generic SaaS patterns that do not fit OpenOnyx.",
    ],
    lookingFor: [
      "You should be comfortable with technical products and open-source development.",
      "You can write clearly enough that maintainers and contributors know what problem they are solving.",
      "You understand knowledge work, local-first software, or developer/productivity tools.",
      "You can make tradeoffs without hiding behind process.",
    ],
    niceToHave: [
      "Experience with Markdown tools, note-taking systems, or personal knowledge management.",
      "Experience working with open-source communities.",
      "Ability to prototype flows or write lightweight interface copy.",
    ],
    application:
      "Start a GitHub Discussion with a short note about your product work, what you think OpenOnyx should improve next, and examples of specs, product writing, or shipped product decisions.",
  },
] satisfies CareerRole[];
