/** Curated slice of OO-Test-Vault — real notes, real wiki links. */

export type VaultNote = {
  id: string;
  title: string;
  folder: string;
  body: string;
};

export type TreeNode =
  | { type: "folder"; name: string; children: TreeNode[] }
  | { type: "file"; id: string; title: string };

export const VAULT_NOTES: VaultNote[] = [
  {
    id: "01 - Projects/Research/Knowledge Management.md",
    title: "Knowledge Management",
    folder: "01 - Projects",
    body: `# Knowledge Management

The process of creating, sharing, using, and managing knowledge and information.

## Personal vs Organizational

### Personal Knowledge Management (PKM)
- Individual learning systems
- Note-taking methods
- [[Zettelkasten Method]]

### Organizational KM
- Documentation systems
- Wikis and knowledge bases
- Onboarding materials

## The PARA Method

Organizing information by **actionability**:

| Category | Description | Timeframe |
|----------|-------------|-----------|
| **P**rojects | Active efforts | Short-term |
| **A**reas | Ongoing responsibilities | Long-term |
| **R**esources | Reference materials | As needed |
| **A**rchive | Completed/inactive | Historical |

## Second Brain Concept

> "Your mind is for having ideas, not holding them." — David Allen

Offload information to an external system to:
- Free mental capacity
- Ensure nothing is lost
- Enable deeper thinking

## See Also

- [[Zettelkasten Method]]
- [[Reading Queue]]
`,
  },
  {
    id: "01 - Projects/Research/Zettelkasten Method.md",
    title: "Zettelkasten Method",
    folder: "01 - Projects",
    body: `# Zettelkasten Method

A note-taking and knowledge management system developed by German sociologist Niklas Luhmann. He used it to write 70+ books and 400+ articles.

## Core Principles

### 1. Atomic Notes
Each note should contain **one idea** and be self-contained.

### 2. Unique Identifiers
Every note has a unique ID for reference.

### 3. Links Over Folders
Notes are connected through wiki links rather than hierarchical folders.

### 4. Your Own Words
Always write in your own words to process and understand.

## Note Types

| Type | Purpose | Example |
|------|---------|---------|
| Fleeting | Quick captures | Idea Inbox |
| Literature | Book/article notes | [[Atomic Habits Notes]] |
| Permanent | Processed ideas | This note |
| Structure | Navigation | Maps of Content |

## Workflow

1. **Capture** fleeting notes throughout the day
2. **Process** into permanent notes daily
3. **Connect** to existing notes
4. **Review** and strengthen connections

## See Also

- [[Knowledge Management]]
- [[Atomic Habits Notes]]
`,
  },
  {
    id: "01 - Projects/MachineLearning/Transformer Architecture.md",
    title: "Transformer Architecture",
    folder: "01 - Projects",
    body: `# Transformer Architecture

Introduced in "Attention Is All You Need" (2017). Foundation of modern NLP models like GPT, BERT, etc.

## Key Innovation: Self-Attention

Instead of processing sequences step-by-step (like RNNs), transformers process all positions in parallel.

## Self-Attention Formula

\`\`\`
Attention(Q, K, V) = softmax(QK^T / √d_k) V
\`\`\`

Where:
- Q = Query matrix
- K = Key matrix
- V = Value matrix
- d_k = dimension of keys

## Related

- [[Neural Networks Fundamentals]]
- [[Machine Learning Research]]
- [[Reading Queue]]
`,
  },
  {
    id: "01 - Projects/MachineLearning/Neural Networks Fundamentals.md",
    title: "Neural Networks Fundamentals",
    folder: "01 - Projects",
    body: `# Neural Networks Fundamentals

A computational model inspired by biological neurons, consisting of layers of interconnected nodes.

## Key Components

### 1. Neurons
Each neuron computes: \`y = activation(Σ(w_i * x_i) + b)\`

### 2. Activation Functions

| Function | Formula | Use Case |
|----------|---------|----------|
| ReLU | max(0, x) | Hidden layers |
| Sigmoid | 1/(1+e^-x) | Binary output |
| Softmax | e^x_i/Σe^x_j | Multi-class |
| Tanh | (e^x-e^-x)/(e^x+e^-x) | RNNs |

### 3. Loss Functions
- **MSE**: Regression
- **Cross-entropy**: Classification

## See Also

- [[Transformer Architecture]]
- [[Machine Learning Research]]
`,
  },
  {
    id: "01 - Projects/MachineLearning/Machine Learning Research.md",
    title: "Machine Learning Research",
    folder: "01 - Projects",
    body: `# Machine Learning Research

## Current Focus

Exploring [[Neural Networks Fundamentals]] and transformers.

## Research Topics

### Completed
- [x] Linear regression basics
- [x] Classification algorithms
- [x] Decision trees and random forests

### In Progress
- [ ] [[Neural Networks Fundamentals]]
- [ ] [[Transformer Architecture]]
- [ ] Attention mechanisms

### Planned
- [ ] Reinforcement learning
- [ ] GANs and diffusion models
- [ ] MLOps and deployment

## Related Notes

- [[Goals 2024]]
- [[Reading Queue]]
`,
  },
  {
    id: "01 - Projects/WebDev/React Best Practices.md",
    title: "React Best Practices",
    folder: "01 - Projects",
    body: `# React Best Practices

## Component Design

### 1. Keep Components Small
Each component should do one thing well. Follow the **Single Responsibility Principle**.

### 2. Use Functional Components
Prefer functional components with hooks over class components.

\`\`\`jsx
const UserCard = ({ user }) => (
  <div className="user-card">
    <h3>{user.name}</h3>
    <p>{user.email}</p>
  </div>
);
\`\`\`

## State Management

- Use context for global state
- Keep server state out of the UI tree
- Derive, don't duplicate

## See Also

- [[Mobile App Project]]
- [[2024-01-15]]
`,
  },
  {
    id: "01 - Projects/MobileApp/Mobile App Project.md",
    title: "Mobile App Project",
    folder: "01 - Projects",
    body: `# Mobile App Project

Building a habit tracking mobile app with React Native.

## Features

- [ ] User authentication
- [ ] Habit creation and tracking
- [ ] Streak visualization
- [ ] Push notifications
- [ ] Data sync across devices
- [ ] Offline support

## Tech Stack

- **Framework**: React Native
- **Habits model**: see [[Atomic Habits Notes]]
- **Related web work**: [[React Best Practices]]

## See Also

- [[Goals 2024]]
`,
  },
  {
    id: "01 - Projects/Personal/Goals 2024.md",
    title: "Goals 2024",
    folder: "01 - Projects",
    body: `# Goals 2024

## Professional

- [ ] Ship the web portfolio
- [ ] Complete [[Machine Learning Research]] project
- [ ] Get promoted / raise

## Learning

- [ ] Master TypeScript
- [ ] Build 3 projects with React Native — see [[Mobile App Project]]
- [ ] Finish the reading list in [[Reading Queue]]

## Health

- [ ] Exercise 4x/week
- [ ] Sleep 7+ hours consistently
- [ ] Meditation streak — [[Atomic Habits Notes]]

## Quarterly Check-ins

### Q1 (Jan-Mar)
Focus: Foundation
- [ ] Portfolio v1
- [ ] Establish routines
`,
  },
  {
    id: "03 - Resources/Books/Atomic Habits Notes.md",
    title: "Atomic Habits Notes",
    folder: "03 - Resources",
    body: `# Atomic Habits Notes

**Author**: James Clear
**Rating**: 5/5

## The Power of 1%

> Getting 1% better every day: 1.01^365 = 37.78x improvement

Small habits compound into remarkable results.

## The Four Laws of Behavior Change

| Law | To Build | To Break |
|-----|----------|----------|
| 1. Cue | Make it obvious | Make it invisible |
| 2. Craving | Make it attractive | Make it unattractive |
| 3. Response | Make it easy | Make it difficult |
| 4. Reward | Make it satisfying | Make it unsatisfying |

## Identity-Based Habits

Focus on **who you want to become**, not what you want to achieve.

- Goal: "I want to read more"
- Identity: "I am a reader"

## See Also

- [[Zettelkasten Method]]
- [[Goals 2024]]
`,
  },
  {
    id: "03 - Resources/Books/Deep Work Notes.md",
    title: "Deep Work Notes",
    folder: "03 - Resources",
    body: `# Deep Work Notes

**Author**: Cal Newport
**Rating**: 5/5

## Definition

> **Deep Work**: Professional activities performed in a state of distraction-free concentration that push your cognitive capabilities to their limit.

vs.

> **Shallow Work**: Non-cognitively demanding, logistical tasks, often performed while distracted.

## Why Deep Work Matters

1. **Rare**: Most people can't do it
2. **Valuable**: Produces high-quality output
3. **Meaningful**: Provides satisfaction

## Strategies

### 1. Monastic
Eliminate or radically minimize shallow work.

### 2. Bimodal
Dedicate blocks of time to deep work.

### 3. Rhythmic
Make deep work a daily habit.

## See Also

- [[2024-01-15]]
- [[Reading Queue]]
`,
  },
  {
    id: "00 - Inbox/Reading Queue.md",
    title: "Reading Queue",
    folder: "00 - Inbox",
    body: `# Reading Queue

## Currently Reading

- [ ] **Atomic Habits** — James Clear → [[Atomic Habits Notes]]
- [ ] **Clean Code** — Robert Martin

## Up Next

- [ ] Designing Data-Intensive Applications
- [ ] The Psychology of Money
- [ ] Staff Engineer — Will Larson

## Articles to Read

- [ ] Understanding [[Transformer Architecture]]
- [ ] System Design interview prep

## Completed

- [x] Deep Work — Cal Newport → [[Deep Work Notes]]
- [x] Show Your Work — Austin Kleon
`,
  },
  {
    id: "05 - Daily Notes/2024-01-15.md",
    title: "2024-01-15",
    folder: "05 - Daily Notes",
    body: `# Monday, January 15, 2024

## Morning Reflection

Today's focus: Complete the [[React Best Practices]] implementation.

## Tasks

- [x] Review PRs
- [x] Team standup
- [ ] Implement new feature
- [x] Update documentation
- [ ] Read chapter of [[Deep Work Notes]]

## Notes

Met with team about [[Mobile App Project]]. Key decisions:
- Use React Native for cross-platform
- Start with iOS first
- Target launch: Q2

## Ideas Captured

- Could use [[Transformer Architecture]] for search
- Look into API design for new endpoints

## Evening Review

### What went well?
- Good progress on PR reviews
- Clear meeting outcomes

### What could improve?
- Got distracted after lunch
- Need better focus blocks

## Tomorrow

- [ ] Continue feature implementation
- [ ] 1:1 with manager
`,
  },
];

export const VAULT_TREE: TreeNode[] = [
  {
    type: "folder",
    name: "00 - Inbox",
    children: [{ type: "file", id: "00 - Inbox/Reading Queue.md", title: "Reading Queue" }],
  },
  {
    type: "folder",
    name: "01 - Projects",
    children: [
      {
        type: "folder",
        name: "MachineLearning",
        children: [
          { type: "file", id: "01 - Projects/MachineLearning/Machine Learning Research.md", title: "Machine Learning Research" },
          { type: "file", id: "01 - Projects/MachineLearning/Neural Networks Fundamentals.md", title: "Neural Networks Fundamentals" },
          { type: "file", id: "01 - Projects/MachineLearning/Transformer Architecture.md", title: "Transformer Architecture" },
        ],
      },
      {
        type: "folder",
        name: "MobileApp",
        children: [{ type: "file", id: "01 - Projects/MobileApp/Mobile App Project.md", title: "Mobile App Project" }],
      },
      {
        type: "folder",
        name: "Personal",
        children: [{ type: "file", id: "01 - Projects/Personal/Goals 2024.md", title: "Goals 2024" }],
      },
      {
        type: "folder",
        name: "Research",
        children: [
          { type: "file", id: "01 - Projects/Research/Knowledge Management.md", title: "Knowledge Management" },
          { type: "file", id: "01 - Projects/Research/Zettelkasten Method.md", title: "Zettelkasten Method" },
        ],
      },
      {
        type: "folder",
        name: "WebDev",
        children: [{ type: "file", id: "01 - Projects/WebDev/React Best Practices.md", title: "React Best Practices" }],
      },
    ],
  },
  {
    type: "folder",
    name: "03 - Resources",
    children: [
      {
        type: "folder",
        name: "Books",
        children: [
          { type: "file", id: "03 - Resources/Books/Atomic Habits Notes.md", title: "Atomic Habits Notes" },
          { type: "file", id: "03 - Resources/Books/Deep Work Notes.md", title: "Deep Work Notes" },
        ],
      },
    ],
  },
  {
    type: "folder",
    name: "05 - Daily Notes",
    children: [{ type: "file", id: "05 - Daily Notes/2024-01-15.md", title: "2024-01-15" }],
  },
];

export const ASK_PROMPTS = [
  {
    id: "zettel",
    q: "What is Zettelkasten?",
    a: "A linking-first note system from Niklas Luhmann: atomic notes, written in your own words, connected by wiki links instead of folders. Capture fleeting notes, process them into permanent ones, then spend the time on connections.",
    cites: ["01 - Projects/Research/Zettelkasten Method.md", "01 - Projects/Research/Knowledge Management.md"],
  },
  {
    id: "read",
    q: "What should I read next?",
    a: "Atomic Habits is in progress. Up next: Designing Data-Intensive Applications, The Psychology of Money, and Staff Engineer. Deep Work is already finished.",
    cites: ["00 - Inbox/Reading Queue.md", "03 - Resources/Books/Deep Work Notes.md"],
  },
  {
    id: "transformers",
    q: "How do transformers work?",
    a: "They replace step-by-step RNNs with self-attention so every token can look at every other token in parallel. The core step is softmax(QKᵀ / √d_k) V. That paper is the foundation of GPT and BERT, and it sits next to the neural-network fundamentals note in this vault.",
    cites: ["01 - Projects/MachineLearning/Transformer Architecture.md", "01 - Projects/MachineLearning/Neural Networks Fundamentals.md"],
  },
  {
    id: "jan15",
    q: "What happened on Jan 15?",
    a: "PR reviews and standup got done. The mobile app meeting locked React Native, iOS first, Q2 launch. Evening review: good meeting outcomes, weak focus after lunch. Tomorrow: keep the feature moving and a 1:1.",
    cites: ["05 - Daily Notes/2024-01-15.md", "01 - Projects/MobileApp/Mobile App Project.md"],
  },
] as const;

const WIKI_RE = /\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|([^\]]+))?\]\]/g;

export function noteById(id: string) {
  return VAULT_NOTES.find((n) => n.id === id);
}

export function noteByTitle(title: string) {
  const key = title.trim().toLowerCase();
  return VAULT_NOTES.find((n) => n.title.toLowerCase() === key);
}

export function extractWikiTargets(body: string) {
  const titles = new Set<string>();
  for (const match of body.matchAll(WIKI_RE)) {
    titles.add(match[1].trim());
  }
  return [...titles];
}

export function backlinksTo(id: string) {
  const note = noteById(id);
  if (!note) return [];
  return VAULT_NOTES.filter((other) => {
    if (other.id === id) return false;
    return extractWikiTargets(other.body).some((title) => title.toLowerCase() === note.title.toLowerCase());
  });
}

export function wordCount(body: string) {
  return body.replace(/[#>*`|\-\[\]]/g, " ").split(/\s+/).filter(Boolean).length;
}
