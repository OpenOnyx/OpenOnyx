import { lazy, Suspense, useState, type KeyboardEvent } from "react";
import { Link } from "react-router-dom";
import { LiveVaultGraph } from "../components/LiveVaultGraph";
import { PRODUCT } from "../data/facts";
import { usePageMeta } from "../lib/meta";

const InteractiveWorkspace = lazy(() =>
  import("../components/product/Workspace").then((module) => ({ default: module.Workspace })),
);
const AIGraphDemo = lazy(() => import("../components/product/AIGraphDemo").then((module) => ({ default: module.AIGraphDemo })));

const MARQUEE_ITEMS = [
  "Plain Markdown",
  "Local-first",
  "Grounded AI",
  "Knowledge Graph",
  "Obsidian Vault Compatible",
  "Your files",
  "Optional Sync",
  "Open source",
];

type ConnectedTopic = {
  id: string;
  label: string;
  file: string;
  heading: string;
  body: string;
  links: string[];
  related: Array<{ title: string; score: string }>;
  answer: string;
  graph: {
    nodes: Array<{ id: string; label: string; x: number; y: number; current?: boolean }>;
    edges: Array<[string, string]>;
  };
};

type VaultSource = {
  title: string;
  snippet: string;
};

const CONNECTED_TOPICS: ConnectedTopic[] = [
  {
    id: "machine-learning",
    label: "Machine Learning",
    file: "Machine Learning.md",
    heading: "Machine Learning",
    body: "Models become useful when training data, evaluation, and deployment constraints stay connected.",
    links: ["Evaluation Metrics", "Model Drift"],
    related: [
      { title: "Evaluation Metrics", score: "88%" },
      { title: "Model Drift", score: "80%" },
      { title: "Data Pipelines", score: "73%" },
    ],
    answer: "Your notes on evaluation and model drift both discuss how model behavior changes after training, especially when data shifts in production.",
    graph: {
      nodes: [
        { id: "ml", label: "Machine Learning", x: 50, y: 44, current: true },
        { id: "eval", label: "Evaluation Metrics", x: 22, y: 22 },
        { id: "drift", label: "Model Drift", x: 76, y: 26 },
        { id: "data", label: "Data Pipelines", x: 28, y: 75 },
        { id: "deploy", label: "Deployment", x: 78, y: 72 },
        { id: "training", label: "Training Data", x: 12, y: 45 },
        { id: "features", label: "Features", x: 45, y: 12 },
        { id: "validation", label: "Validation", x: 85, y: 48 },
        { id: "monitoring", label: "Monitoring", x: 53, y: 88 },
        { id: "bias", label: "Data Bias", x: 12, y: 88 },
        { id: "inference", label: "Inference", x: 90, y: 88 },
      ],
      edges: [["ml", "eval"], ["ml", "drift"], ["ml", "data"], ["drift", "deploy"], ["data", "deploy"], ["training", "data"], ["training", "features"], ["features", "ml"], ["eval", "validation"], ["validation", "deploy"], ["monitoring", "drift"], ["monitoring", "deploy"], ["bias", "training"], ["bias", "eval"], ["inference", "deploy"]],
    },
  },
  {
    id: "distributed-systems",
    label: "Distributed Systems",
    file: "Distributed Systems.md",
    heading: "Distributed Systems",
    body: "Consensus allows independent nodes to agree on shared state even when individual machines fail.",
    links: ["Fault Tolerance", "Raft Consensus"],
    related: [
      { title: "Raft Consensus", score: "86%" },
      { title: "Fault Tolerance", score: "78%" },
      { title: "Distributed Databases", score: "71%" },
    ],
    answer: "Your notes on Raft and fault tolerance both discuss maintaining consistency during node failures.",
    graph: {
      nodes: [
        { id: "ds", label: "Distributed Systems", x: 50, y: 44, current: true },
        { id: "raft", label: "Raft Consensus", x: 23, y: 21 },
        { id: "fault", label: "Fault Tolerance", x: 77, y: 25 },
        { id: "db", label: "Distributed Databases", x: 28, y: 75 },
        { id: "state", label: "Shared State", x: 78, y: 73 },
        { id: "replication", label: "Replication", x: 12, y: 46 },
        { id: "logs", label: "Event Logs", x: 47, y: 12 },
        { id: "quorum", label: "Quorum", x: 88, y: 47 },
        { id: "partitions", label: "Partitions", x: 50, y: 89 },
        { id: "recovery", label: "Recovery", x: 12, y: 88 },
        { id: "consistency", label: "Consistency", x: 90, y: 88 },
      ],
      edges: [["ds", "raft"], ["ds", "fault"], ["ds", "db"], ["raft", "state"], ["fault", "state"], ["replication", "db"], ["replication", "raft"], ["logs", "raft"], ["logs", "replication"], ["quorum", "raft"], ["quorum", "consistency"], ["partitions", "fault"], ["partitions", "consistency"], ["recovery", "fault"], ["recovery", "logs"], ["consistency", "state"]],
    },
  },
  {
    id: "pkm",
    label: "Personal Knowledge Management",
    file: "Personal Knowledge Management.md",
    heading: "Personal Knowledge Management",
    body: "A useful knowledge system helps notes become connected decisions, references, and questions over time.",
    links: ["Zettelkasten Method", "Progressive Summarization"],
    related: [
      { title: "Zettelkasten Method", score: "84%" },
      { title: "Knowledge Graphs", score: "77%" },
      { title: "Progressive Summarization", score: "69%" },
    ],
    answer: "Your notes on Zettelkasten and progressive summarization both describe turning captured information into durable understanding.",
    graph: {
      nodes: [
        { id: "pkm", label: "PKM", x: 50, y: 44, current: true },
        { id: "zettel", label: "Zettelkasten", x: 21, y: 25 },
        { id: "graph", label: "Knowledge Graphs", x: 77, y: 22 },
        { id: "summary", label: "Summaries", x: 27, y: 75 },
        { id: "review", label: "Review", x: 76, y: 73 },
        { id: "capture", label: "Capture", x: 12, y: 46 },
        { id: "links", label: "Backlinks", x: 47, y: 12 },
        { id: "ideas", label: "Ideas", x: 88, y: 46 },
        { id: "questions", label: "Questions", x: 50, y: 89 },
        { id: "research", label: "Research", x: 12, y: 88 },
        { id: "decisions", label: "Decisions", x: 90, y: 88 },
      ],
      edges: [["pkm", "zettel"], ["pkm", "graph"], ["pkm", "summary"], ["summary", "review"], ["graph", "review"], ["capture", "zettel"], ["capture", "research"], ["links", "zettel"], ["links", "graph"], ["ideas", "graph"], ["ideas", "questions"], ["questions", "research"], ["research", "summary"], ["decisions", "review"], ["decisions", "ideas"]],
    },
  },
];

const VAULT_SOURCES: VaultSource[] = [
  {
    title: "Knowledge Management.md",
    snippet: "Knowledge becomes more useful when relationships between ideas remain visible and easy to revisit.",
  },
  {
    title: "Zettelkasten Method.md",
    snippet: "Permanent notes should be written in your own words and connected when the relationship changes what you understand.",
  },
  {
    title: "Research Notes.md",
    snippet: "A useful answer should preserve the path back to the notes that supplied its context.",
  },
];

function Arrow() {
  return <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="M2 8h11M8.5 3.5 13 8l-4.5 4.5" /></svg>;
}

function SectionTag({ children }: { children: string }) {
  return <p className="studio-tag"><span />{children}</p>;
}

function HeroCanvas() {
  return (
    <div className="studio-hero-workspace" aria-label="Interactive OpenOnyx workspace">
      <Suspense fallback={<div className="studio-workspace-loading">Opening the workspace…</div>}>
        <InteractiveWorkspace />
      </Suspense>
    </div>
  );
}

function HeroMarquee() {
  const renderItems = () => MARQUEE_ITEMS.map((item) => (
    <span className="studio-marquee-item" key={item}>{item}</span>
  ));

  return (
    <div className="studio-marquee" aria-label="OpenOnyx capabilities">
      <div className="studio-marquee-track">
        <div className="studio-marquee-group">{renderItems()}</div>
        <div className="studio-marquee-group" aria-hidden="true">{renderItems()}</div>
      </div>
    </div>
  );
}

function MiniKnowledgeGraph({ topic }: { topic: ConnectedTopic }) {
  return <LiveVaultGraph data={topic.graph} fitPadding={24} />;
}

function ConnectedThinking() {
  const [activeId, setActiveId] = useState("distributed-systems");
  const active = CONNECTED_TOPICS.find((topic) => topic.id === activeId) ?? CONNECTED_TOPICS[1];
  const activeIndex = CONNECTED_TOPICS.findIndex((topic) => topic.id === active.id);

  const focusTopic = (index: number, event: KeyboardEvent<HTMLDivElement>) => {
    const nextIndex = (index + CONNECTED_TOPICS.length) % CONNECTED_TOPICS.length;
    const nextTopic = CONNECTED_TOPICS[nextIndex];
    const buttons = event.currentTarget.querySelectorAll<HTMLButtonElement>("[role='tab']");
    setActiveId(nextTopic.id);
    window.requestAnimationFrame(() => buttons[nextIndex]?.focus());
  };

  const handleTopicKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      event.preventDefault();
      focusTopic(activeIndex + 1, event);
    }
    if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      event.preventDefault();
      focusTopic(activeIndex - 1, event);
    }
    if (event.key === "Home") {
      event.preventDefault();
      focusTopic(0, event);
    }
    if (event.key === "End") {
      event.preventDefault();
      focusTopic(CONNECTED_TOPICS.length - 1, event);
    }
  };

  return (
    <section className="studio-connected" id="connected-thinking">
      <div className="studio-wrap">
        <div className="studio-connected-heading">
          <div>
            <SectionTag>03 / Connected Thinking</SectionTag>
            <h2>Your notes shouldn't<br />end where you<br />wrote them.</h2>
          </div>
          <p>OpenOnyx connects what you write today with what you already know. Links, search, graphs, and grounded intelligence turn a folder of Markdown files into a growing body of knowledge.</p>
        </div>

        <div className="studio-topic-tabs" role="tablist" aria-label="Example knowledge topics" onKeyDown={handleTopicKeyDown}>
          {CONNECTED_TOPICS.map((topic) => (
            <button
              key={topic.id}
              id={`connected-topic-${topic.id}`}
              type="button"
              role="tab"
              aria-selected={topic.id === active.id}
              aria-controls="connected-thinking-panel"
              tabIndex={topic.id === active.id ? 0 : -1}
              className={topic.id === active.id ? "is-active" : undefined}
              onClick={() => setActiveId(topic.id)}
            >
              {topic.label}
            </button>
          ))}
        </div>

        <div
          id="connected-thinking-panel"
          className="studio-connected-demo"
          key={active.id}
          role="tabpanel"
          aria-labelledby={`connected-topic-${active.id}`}
        >
          <article className="studio-connected-note" aria-label={`${active.file} note`}>
            <div><span>{active.file}</span><span>01 / WRITE</span></div>
            <pre><code>{`# ${active.heading}\n\n${active.body}\n\n${active.links.map((link) => `[[${link}]]`).join("\n")}`}</code></pre>
          </article>

          <div className="studio-connected-side">
            <section className="studio-related" aria-label="Related knowledge">
              <div className="studio-step-label">02 / DISCOVER</div>
              <h3>Related knowledge</h3>
              <ol>
                {active.related.map((item) => (
                  <li key={item.title}><span>{item.title}</span><b>{item.score}</b></li>
                ))}
              </ol>
            </section>

            <section className="studio-understand" aria-label="Vault Intelligence explanation">
              <div className="studio-step-label">03 / UNDERSTAND</div>
              <h3>Why are these connected?</h3>
              <p>“{active.answer}”</p>
            </section>
          </div>

          <section className="studio-graph-card" aria-label="Graph">
            <div className="studio-step-label">04 / GRAPH</div>
            <MiniKnowledgeGraph topic={active} />
          </section>
        </div>
      </div>
    </section>
  );
}

function IntelligenceCard() {
  const [sourceIndex, setSourceIndex] = useState(0);
  const source = VAULT_SOURCES[sourceIndex] ?? VAULT_SOURCES[0];

  return (
    <div className="studio-intelligence">
      <h3>Ask your own<br />knowledge.</h3>
      <div className="studio-prompt">What helps a knowledge system stay useful? <Arrow /></div>
      <div className="studio-answer">
        <span>Answer built from your vault</span>
        <p>Useful systems keep source notes readable, preserve meaningful links, and let answers point back to the files that shaped them.</p>
        <div className="studio-answer-trace" aria-hidden="true"><span>Question</span><span>Relevant notes</span><span>Answer</span></div>
        <div className="studio-sources" aria-label="Answer sources">
          <b><span>SOURCES</span><i>Retrieved from your vault</i></b>
          {VAULT_SOURCES.map((item, index) => (
            <button
              key={item.title}
              type="button"
              aria-pressed={index === sourceIndex}
              className={index === sourceIndex ? "is-active" : undefined}
              onFocus={() => setSourceIndex(index)}
              onMouseEnter={() => setSourceIndex(index)}
              onClick={() => setSourceIndex(index)}
            >
              <span>{String(index + 1).padStart(2, "0")}</span>{item.title}
            </button>
          ))}
        </div>
        <div className="studio-source-preview"><span>{source.title}</span><p>{source.snippet}</p></div>
      </div>
    </div>
  );
}

function OwnershipFilesystem() {
  return (
    <div className="studio-filesystem" aria-label="Your vault as readable files on disk">
      <div className="studio-filesystem-top"><span>Your Vault</span><span>local folder</span></div>
      <pre>{`notes/
├── projects/
│   ├── openonyx.md
│   └── architecture.md
├── research/
│   └── knowledge-systems.md
└── journal/
    └── 2026-09-26.md`}</pre>
      <dl>
        <div><dt>Format</dt><dd>.md</dd></div>
        <div><dt>Location</dt><dd>Your disk</dd></div>
        <div><dt>Database</dt><dd>Not required</dd></div>
        <div><dt>Readable by</dt><dd>Any text editor</dd></div>
      </dl>
    </div>
  );
}

function ProductThesis() {
  return (
    <section className="studio-thesis" aria-label="OpenOnyx product thesis">
      <div className="studio-wrap">
        <SectionTag>OpenOnyx / 00</SectionTag>
        <h2><span>Not another place<br />to put information.</span><i>A place to build<br />understanding.</i></h2>
        <p>Your files. Your connections. Your context.<br />A knowledge system designed to remain useful for years.</p>
      </div>
    </section>
  );
}

export function Home() {
  usePageMeta("OpenOnyx — Make space for thought.", "A local-first knowledge workspace for notes, connected thinking, and AI grounded in your own files.");

  return (
    <div className="studio-page">
      <section className="studio-hero">
        <div className="studio-wrap">
          <div className="studio-hero-grid">
            <div className="studio-hero-copy">
              <SectionTag>Local-first knowledge management</SectionTag>
              <h1>Make space<br /><i><span>for</span><span>thought.</span></i></h1>
              <p>A quiet, powerful workspace for ideas that deserve to stay yours.</p>
              <div className="studio-actions">
                <Link className="studio-button studio-button-dark" to="/download">Download OpenOnyx <Arrow /></Link>
                <a className="studio-text-link" href={PRODUCT.repo} target="_blank" rel="noreferrer">Explore the source <Arrow /></a>
              </div>
              <div className="studio-proof"><span>Plain Markdown</span><span>Local-first</span><span>Open source</span></div>
            </div>
            <HeroCanvas />
          </div>
        </div>
        <HeroMarquee />
      </section>

      <section className="studio-intro" id="why">
        <div className="studio-wrap studio-intro-grid">
          <article className="studio-principle-card">
            <span className="studio-card-label">Plain Markdown</span>
            <h3>Your notes.<br /><i>Yours forever.</i></h3>
            <p>Open, portable Markdown files that stay on your machine. No proprietary formats. No vendor lock-in.</p>
            <div className="studio-principle-files" aria-label="Markdown file list and folder tree">
              <span className="studio-tree-folder"><b>your-vault/</b><em>folder</em></span>
              <span><b>ideas/contexts.md</b><em>.md file</em></span>
              <span><b>research/notes.md</b><em>.md file</em></span>
            </div>
          </article>
          <div className="studio-context-card">
            <span className="studio-card-label">Vault Intelligence</span>
            <h2>Ask your<br /><i>knowledge.</i></h2>
            <p>AI grounded in your own notes. Get answers with citations, summaries, and related sources from your vault.</p>
            <div className="studio-ai-preview" aria-label="Example answer with sources and citations">
              <div className="studio-ai-preview-top"><span>Ask your vault</span><span>Sources · Citations</span></div>
              <div className="studio-ai-prompt">What connects focus and tools?</div>
              <div className="studio-ai-answer">The best tools protect attention and make useful habits easier.</div>
              <div className="studio-ai-citations"><span>Attention.md</span><span>Tooling/Focus.md</span><span>+2 sources</span></div>
            </div>
          </div>
        </div>
      </section>

      <section className="studio-panels" id="connect">
        <div className="studio-wrap studio-panel-grid">
          <article className="studio-panel studio-panel-cream">
            <span className="studio-card-label">AI Graph</span>
            <h3>Discover hidden<br />connections.</h3>
            <div role="group" aria-label="Interactive example of suggested knowledge connections">
              <Suspense fallback={<p className="studio-graph-hint">Opening the AI graph…</p>}><AIGraphDemo /></Suspense>
            </div>
          </article>
          <article className="studio-panel studio-panel-graph">
            <h3>See the shape<br />of your thinking.</h3>
            <div className="studio-connect-row">
              <div className="studio-manual-graph-copy">
                <p>Follow links, discover relationships, and move through a living body of knowledge.</p>
                <p className="studio-graph-context"><strong>Your links, made visible.</strong><span>Each node is a note. Each line is a link you wrote. Select a note to trace its connections.</span></p>
              </div>
              <LiveVaultGraph />
            </div>
          </article>
        </div>
      </section>

      <ConnectedThinking />

      <section className="studio-intelligence-section" id="intelligence">
        <div className="studio-wrap studio-feature-grid">
          <div>
            <SectionTag>04 / Vault Intelligence</SectionTag>
            <h2>Ask better<br /><i>questions.</i></h2>
            <p>Ask your vault a question. OpenOnyx retrieves relevant notes, builds context from your knowledge, and answers from what you've actually written.</p>
            <a className="studio-text-link" href="#connected-thinking">See how it works <Arrow /></a>
          </div>
          <IntelligenceCard />
        </div>
      </section>

      <section className="studio-ownership">
        <div className="studio-wrap studio-ownership-grid">
          <OwnershipFilesystem />
          <div>
            <SectionTag>05 / Ownership by default</SectionTag>
            <h2>Leave whenever<br /><i>you want.</i></h2>
            <p>Your work is stored as ordinary files on your machine. If OpenOnyx disappeared tomorrow, the knowledge still exists as readable Markdown in your vault.</p>
          </div>
        </div>
      </section>

      <ProductThesis />

      <section className="studio-final">
        <div className="studio-wrap">
          <SectionTag>OpenOnyx</SectionTag>
          <div className="studio-final-title">
            <h2>Keep your<br /><i>thinking close.</i></h2>
            <div className="studio-actions">
              <Link className="studio-button studio-button-light" to="/download">Download OpenOnyx <Arrow /></Link>
              <a className="studio-text-link studio-text-link-light" href={PRODUCT.repo} target="_blank" rel="noreferrer">View on GitHub <Arrow /></a>
            </div>
          </div>
          <div className="studio-footer-links">
            <p>Make space for thought.<br />Keep ownership of every idea.</p>
            <div><h3>Product</h3><Link to="/download">Download</Link><a href="#why">Product</a><a href="#intelligence">Intelligence</a><Link to="/docs/start">Docs</Link></div>
            <div><h3>Resources</h3><a href={PRODUCT.repo} target="_blank" rel="noreferrer">GitHub</a><a href={`${PRODUCT.repo}/discussions`} target="_blank" rel="noreferrer">Community</a><a href={`${PRODUCT.repo}/releases`} target="_blank" rel="noreferrer">Releases</a><Link to="/privacy">Privacy</Link><Link to="/terms">Terms</Link></div>
          </div>
          <div className="studio-footer-word" aria-label="OpenOnyx"><span aria-hidden="true">O</span><span aria-hidden="true">p</span><span aria-hidden="true">e</span><span aria-hidden="true">n</span><span aria-hidden="true">O</span><span aria-hidden="true">n</span><span aria-hidden="true">y</span><span aria-hidden="true">x</span></div>
        </div>
      </section>
    </div>
  );
}
