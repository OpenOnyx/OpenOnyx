import { Link, useParams } from "react-router-dom";
import type { ReactNode } from "react";
import { CAREER_ROLES, type CareerRole } from "../data/careers";
import { PRODUCT } from "../data/facts";
import { usePageMeta } from "../lib/meta";

const GITHUB_DISCUSSIONS = `${PRODUCT.repo}/discussions`;
const GOOD_FIRST_ISSUES = `${PRODUCT.repo}/labels/good%20first%20issue`;

const WORK_PRINCIPLES = [
  {
    index: "01",
    title: "Open by default",
    body:
      "Important product development happens in the open. Code, issues, discussions, and technical decisions should be understandable to the people contributing to the project.",
  },
  {
    index: "02",
    title: "Ship, then learn",
    body:
      "We prefer working software and real feedback over endless planning. Small, well-considered iterations beat giant speculative rewrites.",
  },
  {
    index: "03",
    title: "Own the problem",
    body:
      "You should understand why something exists, not just implement a ticket. Maintainers and contributors are encouraged to question assumptions.",
  },
  {
    index: "04",
    title: "Local-first matters",
    body:
      "Privacy and user ownership are architectural constraints, not marketing checkboxes.",
  },
] as const;

const WORK_AREAS = [
  {
    title: "Local-first architecture",
    body: "Design systems where user knowledge remains portable and under user control.",
  },
  {
    title: "Knowledge intelligence",
    body: "Build semantic connections, retrieval, synthesis, and contextual discovery across a user's vault.",
  },
  {
    title: "Desktop engineering",
    body: "Work on Electron, filesystem integration, performance, packaging, updates, and cross-platform behavior.",
  },
  {
    title: "Tools & MCP",
    body: "Connect knowledge to external capabilities while maintaining explicit permissions and strong security boundaries.",
  },
  {
    title: "Editor & knowledge UX",
    body: "Design interfaces for writing, navigating, connecting, and understanding large personal knowledge bases.",
  },
  {
    title: "Open-source infrastructure",
    body: "Improve releases, CI/CD, signing, testing, documentation, contributor experience, and project infrastructure.",
  },
] as const;

const OPEN_SOURCE_STEPS = [
  ["01", "Use OpenOnyx", "Understand the product and find something that bothers you."],
  ["02", "Pick a problem", "Browse issues, discussions, or identify something worth improving."],
  ["03", "Build", "Open a pull request, prototype an idea, improve documentation, or start a technical discussion."],
  ["04", "Keep showing up", "Strong contributors can grow into maintainers and deeper project roles."],
] as const;

const FIT_STATEMENTS = [
  "You care about the details users notice.",
  "You can work without every decision being specified for you.",
  "You'd rather understand a system than blindly add another abstraction.",
  "You believe open-source software can still have exceptional product design.",
  "You're comfortable saying: “I don't know yet — I'll figure it out.”",
  "You care about shipping something people can actually use.",
] as const;

function SectionLabel({ children }: { children: string }) {
  return <p className="careers-label">{children}</p>;
}

function RoleRow({ role }: { role: CareerRole }) {
  return (
    <li>
      <Link to={`/careers/${role.slug}`} className="careers-role-row">
        <div className="careers-role-main">
          <span>{role.team}</span>
          <h3>{role.title}</h3>
          <p>{role.description}</p>
          <div className="careers-role-skills" aria-label={`${role.title} skills`}>
            {role.skills.map((skill) => (
              <small key={skill}>{skill}</small>
            ))}
          </div>
        </div>
        <div className="careers-role-meta">
          <span>{role.location}</span>
          <span>{role.type}</span>
          <span>{role.compensation.label}</span>
          <b>View role →</b>
        </div>
      </Link>
    </li>
  );
}

export function Careers() {
  const openRoles = CAREER_ROLES.filter((role) => role.isOpen);

  usePageMeta(
    "Careers — OpenOnyx",
    "Build open-source, local-first software for knowledge work with OpenOnyx.",
  );

  return (
    <article className="careers-page">
      <section className="careers-hero" aria-labelledby="careers-title">
        <div>
          <SectionLabel>OPENONYX / CAREERS</SectionLabel>
          <h1 id="careers-title">
            Build tools for <span>people who think.</span>
          </h1>
        </div>
        <div className="careers-hero-copy">
          <p>
            OpenOnyx is building an open-source, local-first knowledge system where your notes, files, connections,
            and tools stay under your control.
          </p>
          <p>
            We're looking for people who care about thoughtful software, open systems, and building things that last.
          </p>
          <div className="careers-actions">
            <a className="careers-button is-primary" href="#open-roles">View open roles ↓</a>
            <a className="careers-button" href={PRODUCT.repo} target="_blank" rel="noreferrer">Contribute on GitHub →</a>
          </div>
        </div>
      </section>

      <section className="careers-thesis" aria-labelledby="careers-why-title">
        <SectionLabel>01 / WHY OPENONYX</SectionLabel>
        <h2 id="careers-why-title">
          We're not building another place to store information.
          <span>We're building a place to understand it.</span>
        </h2>
        <div>
          <p>Most knowledge tools stop at storing what you write.</p>
          <p>
            OpenOnyx is exploring what happens when local knowledge can connect, surface relationships, answer
            questions, and interact with tools — without giving up ownership of the underlying files.
          </p>
          <p>We are building this in the open.</p>
        </div>
      </section>

      <section className="careers-section" aria-labelledby="careers-work-title">
        <div className="careers-section-head">
          <SectionLabel>02 / HOW WE WORK</SectionLabel>
          <h2 id="careers-work-title">Small team. Real ownership.</h2>
        </div>
        <div className="careers-principles">
          {WORK_PRINCIPLES.map((principle) => (
            <article key={principle.title}>
              <span>{principle.index}</span>
              <h3>{principle.title}</h3>
              <p>{principle.body}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="careers-section careers-work" aria-labelledby="careers-work-areas-title">
        <div className="careers-section-head">
          <SectionLabel>03 / THE WORK</SectionLabel>
          <h2 id="careers-work-areas-title">Hard problems. Useful software.</h2>
        </div>
        <div className="careers-work-list">
          {WORK_AREAS.map((area) => (
            <article key={area.title}>
              <h3>{area.title}</h3>
              <p>{area.body}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="careers-section careers-roles" id="open-roles" aria-labelledby="careers-roles-title">
        <div className="careers-section-head">
          <SectionLabel>04 / OPEN ROLES</SectionLabel>
          <h2 id="careers-roles-title">Come build with us.</h2>
        </div>
        {openRoles.length > 0 ? (
          <ul className="careers-role-list">
            {openRoles.map((role) => (
              <RoleRow key={role.slug} role={role} />
            ))}
          </ul>
        ) : (
          <div className="careers-empty">
            <span>OPEN ROLES</span>
            <h3>Nothing formal right now.</h3>
            <p>
              We're still building. OpenOnyx is an open-source project, so you don't need to wait for a job posting to
              work with us.
            </p>
            <p>
              Find something worth improving, open an issue, join a discussion, or send a pull request.
            </p>
            <div className="careers-actions">
              <a className="careers-button is-primary" href={PRODUCT.repo} target="_blank" rel="noreferrer">Explore GitHub</a>
              <a className="careers-button" href={GOOD_FIRST_ISSUES} target="_blank" rel="noreferrer">See good first issues</a>
            </div>
          </div>
        )}
      </section>

      <section className="careers-section careers-open-source" aria-labelledby="careers-open-source-title">
        <div className="careers-section-head">
          <SectionLabel>05 / START IN THE OPEN</SectionLabel>
          <h2 id="careers-open-source-title">You don't need permission to start.</h2>
        </div>
        <div>
          <ol className="careers-steps">
            {OPEN_SOURCE_STEPS.map(([index, title, body]) => (
              <li key={title}>
                <span>{index}</span>
                <h3>{title}</h3>
                <p>{body}</p>
              </li>
            ))}
          </ol>
          <p className="careers-note">
            Open-source contribution does not guarantee employment or a paid role, but it is one of the best ways for us
            to understand how you think and build.
          </p>
        </div>
      </section>

      <section className="careers-fit" aria-labelledby="careers-fit-title">
        <SectionLabel>06 / YOU MIGHT LIKE IT HERE IF</SectionLabel>
        <h2 id="careers-fit-title" className="sr-only">You might like it here if</h2>
        <ul>
          {FIT_STATEMENTS.map((statement) => (
            <li key={statement}>{statement}</li>
          ))}
        </ul>
      </section>

      <section className="careers-final" aria-labelledby="careers-final-title">
        <h2 id="careers-final-title">Don't see your role?</h2>
        <p>If you think you can meaningfully improve OpenOnyx, we'd still like to see what you build.</p>
        <div className="careers-actions">
          <a className="careers-button is-primary" href={PRODUCT.repo} target="_blank" rel="noreferrer">Contribute on GitHub →</a>
          <Link className="careers-button" to="/">Explore OpenOnyx →</Link>
        </div>
      </section>
    </article>
  );
}

function RoleDetailContent({ role }: { role: CareerRole }) {
  return (
    <article className="career-role-page">
      <nav className="career-role-crumb" aria-label="Breadcrumb">
        <Link to="/careers">OPENONYX / CAREERS</Link>
        <span>/</span>
        <span>{role.team}</span>
      </nav>
      <header className="career-role-hero">
        <div>
          <h1>{role.title}</h1>
          <dl>
            <div><dt>Location</dt><dd>{role.location}</dd></div>
            <div><dt>Type</dt><dd>{role.type}</dd></div>
            <div><dt>Compensation</dt><dd>{role.compensation.label}</dd></div>
          </dl>
        </div>
        <a className="careers-button is-primary" href={role.applyUrl}>Apply</a>
      </header>
      <div className="career-role-body">
        <RoleSection title="The role">
          <p>{role.description}</p>
        </RoleSection>
        <RoleList title="What you'll work on" items={role.responsibilities} />
        <RoleList title="What we're looking for" items={role.lookingFor} />
        {role.niceToHave.length > 0 && <RoleList title="Nice to have" items={role.niceToHave} />}
        <RoleSection title="How we work">
          <p>
            OpenOnyx is open-source-first, local-first, and product-minded. We value direct communication, careful
            implementation, and ownership over vague process.
          </p>
        </RoleSection>
        <RoleSection title="How to apply">
          <p>{role.application}</p>
        </RoleSection>
      </div>
    </article>
  );
}

function RoleSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h2>{title}</h2>
      {children}
    </section>
  );
}

function RoleList({ title, items }: { title: string; items: string[] }) {
  return (
    <RoleSection title={title}>
      <ul>
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </RoleSection>
  );
}

export function CareerRolePage() {
  const { slug } = useParams();
  const role = CAREER_ROLES.find((item) => item.slug === slug);

  usePageMeta(
    role ? `${role.title} — OpenOnyx Careers` : "Role not found — OpenOnyx Careers",
    role?.description ?? "OpenOnyx careers and open-source contribution opportunities.",
  );

  if (!role || !role.isOpen) {
    return (
      <section className="career-role-page">
        <div className="career-role-missing">
          <SectionLabel>OPENONYX / CAREERS</SectionLabel>
          <h1>Role not found.</h1>
          <p>This role is not currently open. Return to Careers to see the latest status.</p>
          <Link className="careers-button is-primary" to="/careers">Back to Careers</Link>
        </div>
      </section>
    );
  }

  return <RoleDetailContent role={role} />;
}
