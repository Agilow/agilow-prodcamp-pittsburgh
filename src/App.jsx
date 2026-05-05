import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  ClipboardList,
  Command,
  FileText,
  Gauge,
  GitPullRequest,
  LayoutDashboard,
  MessageSquareText,
  Plus,
  RefreshCw,
  Search,
  Send,
  Users,
} from "lucide-react";

const people = {
  shiv: { name: "Shiv Panjwani", initials: "SP", color: "#e8472a", role: "Founder" },
  antonio: { name: "Antonio", initials: "AN", color: "#13294b", role: "Ops" },
  shaurya: { name: "Shaurya Singh", initials: "SS", color: "#5b5bd6", role: "Product" },
  cameron: { name: "Cameron Thompson", initials: "CT", color: "#087f5b", role: "Research" },
  precious: { name: "Precious", initials: "PR", color: "#b7791f", role: "Sales" },
};

const issues = [
  { id: "AG-001", title: "Submit YC application and founder video", area: "Fundraising", owner: "shiv", points: 2, state: "blocked", risk: "Due Monday night; needs Antonio support", due: "Today" },
  { id: "AG-002", title: "Prepare TrainWell pilot scope for LOI", area: "TrainWell", owner: "antonio", points: 2, state: "blocked", risk: "Needs Journey LOI from Shiv", due: "Today" },
  { id: "AG-003", title: "Align Journey Robotics schedule with Keith", area: "Journey", owner: "antonio", points: 2, state: "active", risk: "Onsite cadence still needs confirmation", due: "Today" },
  { id: "AG-004", title: "Automate Sprint Health report generation", area: "Sprint Health", owner: "shaurya", points: 7, state: "active", risk: "Must run from Slack without manual trigger", due: "Tonight" },
  { id: "AG-005", title: "Log LinkedIn outreach and book qualified calls", area: "Sales", owner: "precious", points: 5, state: "active", risk: "5-call target has not moved yet", due: "This week" },
  { id: "AG-006", title: "Complete mentor follow-ups before graduation travel", area: "Research", owner: "cameron", points: 3, state: "review", risk: "Unavailable Wednesday night to Monday", due: "Wed" },
  { id: "AG-007", title: "Build Product Camp prototype from Shiv context", area: "Product Camp", owner: "shaurya", points: 3, state: "active", risk: "Clickable multi-page prototype needs final tweaks", due: "Today" },
  { id: "AG-008", title: "Talk to consultant about architecture review", area: "Architecture", owner: "shiv", points: 1, state: "active", risk: "Needed before pilot build decisions harden", due: "This week" },
  { id: "AG-009", title: "Draft a16z answers and send to Antonio", area: "Fundraising", owner: "shiv", points: 2, state: "active", risk: "Due May 17; Shiv will not drive later", due: "May 17" },
  { id: "AG-010", title: "Re-engage Annette, Andrew, and Chris", area: "Sales", owner: "antonio", points: 1, state: "active", risk: "Warm contacts not restarted", due: "This week" },
  { id: "AG-011", title: "Completed financial planning and analysis", area: "Finance", owner: "shiv", points: 1, state: "done", risk: "Mercury review complete", due: "Done" },
  { id: "AG-012", title: "Journey Robotics onsite onboarding completed", area: "Journey", owner: "antonio", points: 2, state: "done", risk: "Antonio attended onsite and planning", due: "Done" },
  { id: "AG-013", title: "April Substack LinkedIn promotion", area: "Marketing", owner: "cameron", points: 1, state: "done", risk: "Posted on Agilow LinkedIn", due: "Done" },
];

const standups = [
  {
    owner: "antonio",
    time: "6:05 PM",
    yesterday: "Planning with the team. Finished updating prototype for TrainWell.",
    today: "Visit Journey on-site and get onboarded. Prepare TrainWell pilot plan for LOI. Help with YC application video.",
    blockers: "Needs sample Journey LOI from Shiv.",
    discuss: "Sushrut involvement in architecture review and design. Agilow daily bot.",
    signal: "Blocked",
  },
  {
    owner: "cameron",
    time: "6:12 PM",
    yesterday: "Updated sprint goals.",
    today: "Thematic analysis of one interview, watch tutorials, LinkedIn post on Agilow account about April newsletter, follow up with Vincent.",
    blockers: "No blockers.",
    discuss: "Gone Wednesday night to Monday morning/midday for graduation. Already on Agilow calendar.",
    signal: "Clear",
  },
  {
    owner: "precious",
    time: "6:19 PM",
    yesterday: "Updated sprint goal.",
    today: "Send new connection requests and check LinkedIn for messages.",
    blockers: "None.",
    discuss: "Nothing new.",
    signal: "Clear",
  },
  {
    owner: "shiv",
    time: "6:20 PM",
    yesterday: "Sprint planning, documented sprint goals, completed financial planning, sent Steve Fleck reschedule email, sent meeting request to Suhay from Lightscape Partners.",
    today: "Spend day at Journey Robotics with Antonio, conduct knowledge transfer, run sprint planning, customer discovery call, complete YC founder video/application, meet Keith about date changes and blockers.",
    blockers: "Needs Antonio's help for YC founder video and Product Camp submission.",
    discuss: "Financial charges review: Cursor, Granola, calendar subscriptions. Shaurya needs measurable sprint success criteria.",
    signal: "Decision",
  },
  {
    owner: "shaurya",
    time: "6:21 PM",
    yesterday: "Planned automatic Sprint Health report generation, moved infra toward Render instead of AWS, refined prompts for carryover and unplanned work.",
    today: "Complete those three workstreams and deploy to Render tonight so the team can review.",
    blockers: "No blockers.",
    discuss: "Nothing to discuss.",
    signal: "Clear",
  },
];

const sprintPlan = [
  {
    person: "shiv",
    grade: null,
    gradeMax: 5,
    kaizen: "Successful handover from Shiv to Antonio for Journey Robotics",
    goals: [
      {
        title: "Journey Robotics handover",
        points: 2,
        items: [
          "Antonio involved in Journey Robotics sprint planning",
          "Knowledge transfer and preparation covered ahead of time",
          "Schedule for the week is set up",
          "Clear communication for schedule and availability communicated to Keith",
        ],
        success: "Antonio attended sprint planning, weekly schedule set, Keith knows the plan and availability",
      },
      {
        title: "Fundraising & applications",
        points: 2,
        items: [
          "Submit Y Combinator application (due Monday night)",
          "Record founder's video with Antonio for YC",
          "Draft a16z application answers (due May 17) and send to Antonio for review",
        ],
        success: "YC submitted, a16z draft ready for Antonio's review",
      },
      {
        title: "Financial planning & analysis",
        points: 1,
        items: [
          "Review Mercury balance and transactions",
          "Calculate burn rate and remaining budget",
        ],
        success: "We know our burn rate and how much budget remains",
      },
    ],
  },
  {
    person: "antonio",
    grade: null,
    gradeMax: 9,
    kaizen: "Get fully onboarded into Journey Robotics — tools set up, cadences established, and the team running smoothly with me as the point of contact.",
    goals: [
      {
        title: "Journey Robotics",
        points: 2,
        items: [
          "Attend Monday onsite with Shiv to meet the team and get full context",
          "Align with Keith on onsite schedule — 3 days a week, 9 to 3, confirm days",
          "Get access to all tools: Linear, Slack, Fathom, etc.",
          "Understand and document their sprint cadence",
          "Run or support at least one full sprint cycle this week",
        ],
        success: "Onboarded, tools set up, cadence documented, present and adding value",
      },
      {
        title: "TrainWell",
        points: 2,
        items: [
          "Prepare pilot scope document — timeline, deliverables, data handling, price per person",
          "Prepare internal proposal of value with suggested price",
          "Use Journey Robotics contract as structural reference",
          "Present scope in next Kade meeting and review together",
          "Ask Kade to share his calculation of value and WTP, then align on a number",
        ],
        success: "LOI agreed or Kade has given a clear verbal commitment with number and timeline",
      },
      {
        title: "SovaSage",
        points: 1,
        items: [
          "Propose and schedule a realignment meeting",
          "Follow up to receive Zoom transcripts and Gmail emails",
          "Document their needs from the realignment session",
          "Build a prototype using their real data",
          "Schedule a follow-up session to review the prototype",
        ],
        success: "Prototype ready and review session scheduled",
      },
      {
        title: "Tandemn",
        points: 1,
        items: [
          "Follow up with Hetarth and confirm he still wants to move forward",
          "Produce a prototype with mock data for his personal task management use case",
          "Present the prototype and gather his biggest pain points",
        ],
        success: "Prototype presented, pain points documented",
      },
      {
        title: "Sales calls from Precious",
        points: 1,
        items: [
          "Get Steve Fleck's forwarded email from Shiv and confirm meeting details",
          "Research Steve Fleck on LinkedIn before the call",
          "Run the call following the first-contact framework",
          "Document learnings and decide if he's a qualified pilot candidate",
        ],
        success: "Call completed, qualification documented",
      },
      {
        title: "Re-engage warm contacts",
        points: 1,
        items: [
          "Send personalised re-engagement message to Annette, Andrew, and Chris",
        ],
        success: "Messages sent and tracked",
      },
      {
        title: "Document the full sales process",
        points: 1,
        items: [
          "Document outreach-to-prototype stage",
          "Connect to existing three-call strategy to form one end-to-end document",
        ],
        success: "One complete sales process document covering both prongs",
      },
    ],
  },
  {
    person: "shaurya",
    grade: null,
    gradeMax: 7,
    kaizen: null,
    goals: [
      { title: "Automate Sprint Health report end-to-end from Slack standups", points: 2, items: ["Scheduled daily analysis runs", "No manual trigger required"], success: "Daily report runs automatically, >=90% success rate" },
      { title: "Improve Sprint Health analysis quality", points: 1, items: ["Refine prompts", "Improve output reliability"], success: ">=80% of reports need little or no editing, no major hallucinations" },
      { title: "Add human feedback/edit loop", points: 1, items: ["Users can correct AI-generated analysis", "Edits saved and reused to improve future outputs"], success: "Feedback loop live and functional" },
      { title: "Extend Sprint Health to capture Saturday standups", points: 1, items: ["Friday-Saturday progress included in sprint reporting"], success: "Saturday standups included in reports" },
      { title: "Make Sprint Health usable by other teammates", points: 1, items: [">=2 teammates actively using it", "No dependency on Shaurya"], success: "Team can use it independently" },
      { title: "Support sprint review workflows", points: 1, items: ["Comments and edits supported", "Clearer documentation updates"], success: "Reports usable directly in sprint reviews" },
    ],
  },
  {
    person: "cameron",
    grade: null,
    gradeMax: 4,
    kaizen: "Thematic analysis",
    note: "Unavailable Wednesday night - Monday morning for graduation",
    goals: [
      {
        title: "Thematic analysis interviews",
        points: 2,
        items: [
          "1 done Monday",
          "2 done Tuesday (watching tutorials)",
          "3 done Wednesday",
          "Minimum 5 total done before leaving for graduation",
        ],
        success: "At least 5 thematic analyses completed before Wednesday night",
      },
      {
        title: "LinkedIn promotion",
        points: 1,
        items: [
          "Promote April Substack on Agilow LinkedIn on Monday",
          "Promote user research Substack on Agilow LinkedIn on Monday",
        ],
        success: "Both posts published Monday",
      },
      {
        title: "Mentor follow-ups",
        points: 1,
        items: ["Follow up with Vincent", "Follow up with MHCI mentor", "Titus chat"],
        success: "All three follow-ups sent",
      },
    ],
  },
  {
    person: "precious",
    grade: null,
    gradeMax: 5,
    kaizen: "5 Calls",
    goals: [
      {
        title: "Book 5 qualified calls",
        points: 2,
        items: [
          "Use Shiv's and Cameron's LinkedIn accounts for outreach",
          "Focus energy here above everything else",
        ],
        success: "5 meetings on the calendar by end of sprint",
      },
      {
        title: "Send connection requests & DMs",
        points: 1,
        items: ["Daily sends on both accounts", "All activity tracked and logged immediately"],
        success: "Consistent daily sends recorded in tracker sheet",
      },
      {
        title: "Inbox review & tracker update",
        points: 1,
        items: [
          "Check both LinkedIn inboxes for unanswered messages from last week",
          "Every contact added and staged correctly in the sheet",
        ],
        success: "Zero unactioned responses, tracker fully up to date",
      },
      {
        title: "April Substack stats report",
        points: 1,
        items: ["Pull performance data for all April Substack posts", "Compile clean summary and send to team"],
        success: "Report sent to team by end of week",
      },
    ],
  },
];

const retroColumns = [
  {
    title: "What's going well?",
    color: "#16a34a",
    bg: "#f0fdf4",
    items: [
      "Journey Robotics contract signed!!",
      "Renaissance Partners are interested in helping us raise",
      "Prototype with real data from Trainwell presented",
      "New meetings with leads scheduled and taken",
      "Tartan Entrepreneurs Fund applied",
      "Shaurya scrum mastered like a pro",
      "Demonstrated to Kade - now need to convert to paid pilot",
      "Shaurya SM + 1: good first week",
      "Renaissance Partners going well",
      "Standup report & attendance consistency",
      "Journey Robotics signed & started",
      "LinkedIn follow-ups ignited 7-8 new meetings on the calendar",
      "Great learnings & network building in Life Sciences",
      "100 in prompt engineering final project!",
      "Back recovered from pain quickly",
    ],
  },
  {
    title: "What's not going well?",
    color: "#dc2626",
    bg: "#fef2f2",
    items: [
      "Weren't able to use the sprint health feature",
      "We don't have financial planning done",
      "VentureBridge investment not accepted (VB fellowship granted)",
      "SovaSage cycle time",
      "Trainwell strategy to paid pilot feels far",
      "Very low collaboration & team bonding",
      "FP&A needs to be prioritized",
      "Customer response time",
    ],
  },
  {
    title: "What actions/changes should we make?",
    color: "#2563eb",
    bg: "#eff6ff",
    items: [
      "Measuring sprint health during standup",
      "Plan for serving Journey Robotics",
      "Shaurya - SM feedback & coaching",
      "Need to create a CIM for Renaissance",
      "Customer response time",
    ],
  },
  {
    title: "Actions",
    color: "#d97706",
    bg: "#fffbeb",
    items: [],
  },
];

const nav = [
  { id: "overview", label: "Sprint Overview", icon: LayoutDashboard },
  { id: "issues", label: "Goals", icon: GitPullRequest, count: 13 },
  { id: "standup", label: "Daily Brief", icon: MessageSquareText },
  { id: "planning", label: "Planning", icon: ClipboardList },
  { id: "health", label: "Health Report", icon: Gauge },
  { id: "retro", label: "Retro", icon: RefreshCw },
];

function cx(...classes) {
  return classes.filter(Boolean).join(" ");
}

function Avatar({ personKey, size = "md" }) {
  const person = people[personKey];
  return (
    <span className={cx("avatar", `avatar-${size}`)} style={{ background: person.color }}>
      {person.initials}
    </span>
  );
}

function StatusDot({ state }) {
  return <span className={cx("status-dot", state)} />;
}

function Shell({ active, setActive, onOpenCmd, children }) {
  const ActiveIcon = nav.find((item) => item.id === active)?.icon ?? LayoutDashboard;
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <img src="/agi2.png" alt="Agilow" className="brand-logo" />
        </div>

        <div className="quick-search" onClick={onOpenCmd} style={{ cursor: "pointer" }}>
          <Search size={14} />
          <span>Search issues</span>
          <kbd>⌘K</kbd>
        </div>

        <nav className="nav-list">
          {nav.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                className={cx("nav-item", active === item.id && "active")}
                onClick={() => setActive(item.id)}
              >
                <Icon size={16} />
                <span>{item.label}</span>
                {item.count ? <span className="nav-count">{item.count}</span> : null}
              </button>
            );
          })}
        </nav>

        <div className="sidebar-section">
          <div className="sidebar-label">Active sprint</div>
          <div className="sprint-card">
            <div className="sprint-row">
              <span>May 2-9</span>
              <strong>23%</strong>
            </div>
            <div className="progress-line">
              <motion.span initial={{ width: 0 }} animate={{ width: "23%" }} transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }} />
            </div>
            <div className="sprint-meta">
              <span>Day 3 / 8</span>
              <span>-15 pts</span>
            </div>
          </div>
        </div>

        <div className="sidebar-footer">
          <Avatar personKey="shiv" />
          <div>
            <div className="user-name">Shiv V.</div>
            <div className="user-meta">Founder workspace</div>
          </div>
        </div>
      </aside>

      <main className="main">
        {children}
      </main>
    </div>
  );
}

function PageFrame({ children, pageKey }) {
  return (
    <motion.section
      key={pageKey}
      className="page"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -4 }}
      transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
    >
      {children}
    </motion.section>
  );
}

function Overview() {
  const todayQueue = issues.filter((issue) => issue.state !== "done").slice(0, 7);
  return (
    <PageFrame pageKey="overview">
      <div className="overview-wrap">
      <div className="page-header hero-header">
        <div className="hero-copy">
<h1>Sprint Overview</h1>
          <p className="lede">2nd May to 9th May · Team completion is 23% against an expected 38%. YC, TrainWell LOI, and Sprint Health automation need same-day movement.</p>
        </div>
      </div>

      <div className="decision-strip">
        {[
          ["Team complete", "23%", "Expected 38%"],
          ["Behind plan", "-15 pts", "5 days left"],
          ["Grade", "B", "Health report"],
          ["Focus today", "7", "Critical actions"],
        ].map(([label, value, note], index) => (
          <motion.div
            className="signal-cell"
            key={label}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: index * 0.05, duration: 0.28 }}
          >
            <span>{label}</span>
            <strong>{value}</strong>
            <small>{note}</small>
          </motion.div>
        ))}
      </div>

      <div className="overview-grid">
        <section className="panel priority-panel">
          <div className="panel-title queue-title">
            <div>
              <h2>Today Queue</h2>
              <p>Items from May 4 standup and sprint health report.</p>
            </div>
            <span className="pill queue-count">{todayQueue.length} actions</span>
          </div>
          <div className="decision-list">
            {todayQueue.map((issue) => (
              <button className="decision-row" key={issue.id}>
                <span className="decision-id">{issue.id}</span>
                <div className="decision-copy">
                  <span>{issue.title}</span>
                  <small>{issue.risk}</small>
                </div>
                <div className="decision-meta">
                  <span className="impact-chip">{issue.due.toUpperCase()}</span>
                  <Avatar personKey={issue.owner} size="sm" />
                </div>
              </button>
            ))}
          </div>
        </section>

        <section className="panel work-panel">
          <div className="panel-title">
            <div>
              <h2>Active Goals</h2>
              <p>Owner, status, and sprint pressure.</p>
            </div>
            <button className="text-button">View all</button>
          </div>
          <IssueRows rows={issues.filter((issue) => issue.state !== "done").slice(0, 5)} compact />
        </section>

      </div>
      </div>
    </PageFrame>
  );
}

function IssueRows({ rows, compact = false }) {
  return (
    <div className="issue-table">
      {rows.map((issue, index) => (
        <motion.button
          className={cx("issue-row", issue.state)}
          key={issue.id}
          initial={{ opacity: 0, x: -6 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: index * 0.025, duration: 0.22 }}
        >
          <StatusDot state={issue.state} />
          <span className="issue-id">{issue.id}</span>
          <span className="issue-title">{issue.title}</span>
          {!compact && <span className="tag">{issue.area}</span>}
          <span className="issue-risk">{issue.risk}</span>
          <span className="points">{issue.points}</span>
          <Avatar personKey={issue.owner} size="sm" />
        </motion.button>
      ))}
    </div>
  );
}

function IssuesPage() {
  const groups = [
    ["Blocked", issues.filter((i) => i.state === "blocked")],
    ["In progress", issues.filter((i) => i.state === "active")],
    ["Review", issues.filter((i) => i.state === "review")],
    ["Done", issues.filter((i) => i.state === "done")],
  ];
  return (
    <PageFrame pageKey="issues">
      <div className="page-header tight">
        <div>
          <p className="eyebrow">May 2-9 sprint</p>
          <h1>Goals</h1>
        </div>
        <div className="toolbar">
          <button className="ghost-button"><Search size={14} /> Filter</button>
          <button className="ghost-button"><Users size={14} /> Assignee</button>
          <button className="primary-button"><Plus size={14} /> Issue</button>
        </div>
      </div>
      <div className="issue-groups">
        {groups.map(([title, rows]) => (
          <section className="issue-group" key={title}>
            <div className="group-heading">
              <span>{title}</span>
              <small>{rows.length}</small>
            </div>
            <IssueRows rows={rows} />
          </section>
        ))}
      </div>
    </PageFrame>
  );
}

function StandupPage() {
  return (
    <PageFrame pageKey="standup">
      <div className="page-header">
        <div>
          <h1>5 of 5 reported</h1>
          <p className="lede">Captured from Antonio, Cameron, Precious, Shiv, and Shaurya standups.</p>
        </div>
      </div>
      <div className="standup-layout async-layout">
        <section className="panel standup-table-panel">
          <div className="panel-title">
            <button className="icon-button" aria-label="Send"><Send size={15} /></button>
          </div>
          <div className="standup-table">
            {standups.map((item) => (
              <button className="standup-row" key={item.owner}>
                <Avatar personKey={item.owner} size="sm" />
                <div className="standup-person">
                  <span>{people[item.owner].name}</span>
                  <small>{item.time}</small>
                </div>
                <div className="standup-fields">
                  <div><b>Yesterday</b><span>{item.yesterday}</span></div>
                  <div><b>Today</b><span>{item.today}</span></div>
                  <div><b>Blockers</b><span className={cx(item.signal !== "Clear" && "blocker-text")}>{item.blockers}</span></div>
                  <div><b>Discuss</b><span>{item.discuss}</span></div>
                </div>
                <strong className={cx("signal", item.signal.toLowerCase())}>{item.signal}</strong>
              </button>
            ))}
          </div>
        </section>
      </div>
    </PageFrame>
  );
}

function PlanningPage() {
  const [activePerson, setActivePerson] = useState(sprintPlan[0].person);
  const [grades, setGrades] = useState(() => Object.fromEntries(sprintPlan.map((entry) => [entry.person, entry.grade])));
  const [editingPerson, setEditingPerson] = useState(null);
  const [editingValue, setEditingValue] = useState("");
  const personPlan = sprintPlan.find((entry) => entry.person === activePerson) ?? sprintPlan[0];

  function totalPoints(entry) {
    return entry.goals.reduce((sum, goal) => sum + goal.points, 0);
  }

  function startEditing(person) {
    setEditingPerson(person.person);
    const current = grades[person.person];
    setEditingValue(current == null ? "" : String(current));
  }

  function saveGrade(person) {
    const parsed = Number.parseInt(editingValue, 10);
    const nextGrade = Number.isNaN(parsed) ? null : Math.max(0, Math.min(person.gradeMax, parsed));
    setGrades((current) => ({ ...current, [person.person]: nextGrade }));
    setEditingPerson(null);
    setEditingValue("");
  }

  return (
    <PageFrame pageKey="planning">
      <div className="page-header">
        <div>
          <h1>Sprint Plan Document</h1>
          <p className="lede">Per-person kaizen, point-weighted goals, and explicit success criteria for stage demo and daily execution.</p>
        </div>
      </div>
      <div className="planning-v2 panel">
        <section className="person-list">
          {sprintPlan.map((entry) => {
            const active = entry.person === activePerson;
            const currentGrade = grades[entry.person];
            const isEditing = editingPerson === entry.person;
            const pts = totalPoints(entry);
            return (
              <div
                className={cx("person-row", active && "active")}
                key={entry.person}
                onClick={() => setActivePerson(entry.person)}
              >
                <Avatar personKey={entry.person} size="sm" />
                <div className="person-main">
                  <strong>{people[entry.person].name}</strong>
                  <small>{pts} pts</small>
                </div>
                <div className="person-grade-wrap" onClick={(event) => event.stopPropagation()}>
                  {isEditing ? (
                    <input
                      className="person-grade-input"
                      type="number"
                      min="0"
                      max={entry.gradeMax}
                      value={editingValue}
                      onChange={(event) => setEditingValue(event.target.value)}
                      onBlur={() => saveGrade(entry)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") saveGrade(entry);
                        if (event.key === "Escape") setEditingPerson(null);
                      }}
                      autoFocus
                    />
                  ) : (
                    <button className="person-grade" onClick={() => startEditing(entry)}>
                      {currentGrade == null ? "_" : currentGrade}/{entry.gradeMax}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </section>
        <section className="plan-detail">
          {personPlan.kaizen ? (
            <div className="kaizen-block">
              <small>Kaizen</small>
              <p>{personPlan.kaizen}</p>
            </div>
          ) : null}
          {personPlan.note ? <div className="availability-note">{personPlan.note}</div> : null}
          <div className="goal-list">
            {personPlan.goals.map((goal, index) => (
              <article className="goal-card" key={goal.title}>
                <div className="goal-header">
                  <h3>{index + 1}. {goal.title}</h3>
                  <span className="goal-pts">{goal.points} pts</span>
                </div>
                <ul className="goal-items">
                  {goal.items.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
                <div className="goal-sc">
                  <span>SC</span>
                  <p>{goal.success}</p>
                </div>
              </article>
            ))}
          </div>
        </section>
      </div>
    </PageFrame>
  );
}

function HealthPage() {
  const metrics = [
    ["Team completion", 23],
    ["Expected pace", 38],
    ["Antonio progress", 17],
    ["Shaurya progress", 16],
    ["Precious progress", 14],
    ["Cameron progress", 39],
    ["Shiv progress", 41],
  ];
  return (
    <PageFrame pageKey="health">
      <div className="page-header">
        <div>
          <p className="eyebrow">Generated May 5 · 00:49</p>
          <h1>Sprint Health — May 4</h1>
          <p className="lede">Day 3 of 8. Team is at 23% completion, 15 points behind expected pace.</p>
        </div>
        <button className="ghost-button"><FileText size={14} /> Download PDF</button>
      </div>
      <div className="health-layout">
        <section className="grade-card">
          <span>Grade</span>
          <strong>B</strong>
          <small>23% complete · 5 days left</small>
        </section>
        <section className="panel">
          <div className="panel-title"><h2>Signals</h2></div>
          <div className="metric-list">
            {metrics.map(([label, value], index) => (
              <div className="metric-row" key={label}>
                <span>{label}</span>
                <div className="metric-track">
                  <motion.i initial={{ width: 0 }} animate={{ width: `${value}%` }} transition={{ delay: index * 0.08, duration: 0.7, ease: [0.22, 1, 0.36, 1] }} />
                </div>
                <strong>{value}%</strong>
              </div>
            ))}
          </div>
        </section>
      </div>
    </PageFrame>
  );
}

function RetroPage() {
  const [columns, setColumns] = useState(retroColumns);
  const [drafts, setDrafts] = useState(() => Object.fromEntries(retroColumns.map((col) => [col.title, ""])));

  function addRetroItem(title) {
    const value = (drafts[title] ?? "").trim();
    if (!value) return;
    setColumns((current) => current.map((col) => (
      col.title === title
        ? { ...col, items: [...col.items, value] }
        : col
    )));
    setDrafts((current) => ({ ...current, [title]: "" }));
  }

  return (
    <PageFrame pageKey="retro">
      <div className="page-header tight" style={{ marginBottom: 20 }}>
        <div>
          <h1>Retrospective</h1>
          <p className="lede">May 2-9 sprint · What we learned, what we're changing.</p>
        </div>
      </div>
      <div className="retro-grid">
        {columns.map((col) => (
          <section className="retro-column-wrap" key={col.title}>
            <div className="retro-col-header" style={{ background: col.color }}>
              <span>{col.title}</span>
              <span className="retro-col-count">{col.items.length}</span>
            </div>
            <div className="retro-col-body" style={{ background: col.bg }}>
              {col.items.map((item) => (
                <div className="retro-item" key={item} style={{ borderLeftColor: col.color }}>
                  {item}
                </div>
              ))}
              {col.items.length === 0 && (
                <div className="retro-empty">+ Add action</div>
              )}
              <div className="retro-add">
                <input
                  className="retro-add-input"
                  value={drafts[col.title] ?? ""}
                  onChange={(event) => setDrafts((current) => ({ ...current, [col.title]: event.target.value }))}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") addRetroItem(col.title);
                  }}
                  placeholder="Add item..."
                />
                <button className="retro-add-btn" onClick={() => addRetroItem(col.title)}>Add</button>
              </div>
            </div>
          </section>
        ))}
      </div>
    </PageFrame>
  );
}

function CommandPalette({ open, onClose, onNavigate }) {
  const [query, setQuery] = useState("");
  const inputRef = useRef(null);

  useEffect(() => {
    if (open) {
      setQuery("");
      setTimeout(() => inputRef.current?.focus(), 10);
    }
  }, [open]);

  const navResults = nav.filter((item) =>
    item.label.toLowerCase().includes(query.toLowerCase())
  );

  const issueResults = query.length > 1
    ? issues.filter((issue) =>
        issue.title.toLowerCase().includes(query.toLowerCase()) ||
        issue.id.toLowerCase().includes(query.toLowerCase())
      ).slice(0, 5)
    : [];

  if (!open) return null;

  return (
    <div className="cmd-backdrop" onClick={onClose}>
      <motion.div
        className="cmd-modal"
        initial={{ opacity: 0, scale: 0.97, y: -8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.97, y: -8 }}
        transition={{ duration: 0.15 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="cmd-search-row">
          <Search size={16} className="cmd-search-icon" />
          <input
            ref={inputRef}
            className="cmd-input"
            placeholder="Search pages, issues…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Escape" && onClose()}
          />
          <kbd className="cmd-esc">esc</kbd>
        </div>

        <div className="cmd-results">
          {navResults.length > 0 && (
            <div className="cmd-group">
              <div className="cmd-group-label">Pages</div>
              {navResults.map((item) => {
                const Icon = item.icon;
                return (
                  <button key={item.id} className="cmd-item" onClick={() => { onNavigate(item.id); onClose(); }}>
                    <Icon size={14} className="cmd-item-icon" />
                    <span>{item.label}</span>
                  </button>
                );
              })}
            </div>
          )}
          {issueResults.length > 0 && (
            <div className="cmd-group">
              <div className="cmd-group-label">Issues</div>
              {issueResults.map((issue) => (
                <button key={issue.id} className="cmd-item" onClick={onClose}>
                  <span className="cmd-issue-id">{issue.id}</span>
                  <span>{issue.title}</span>
                </button>
              ))}
            </div>
          )}
          {navResults.length === 0 && issueResults.length === 0 && (
            <div className="cmd-empty">No results for "{query}"</div>
          )}
        </div>
      </motion.div>
    </div>
  );
}

export default function App() {
  const [active, setActive] = useState("overview");
  const [cmdOpen, setCmdOpen] = useState(false);

  useEffect(() => {
    function onKey(e) {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setCmdOpen((o) => !o);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const page = useMemo(() => {
    const pages = {
      overview: <Overview />,
      issues: <IssuesPage />,
      standup: <StandupPage />,
      planning: <PlanningPage />,
      health: <HealthPage />,
      retro: <RetroPage />,
    };
    return pages[active] ?? pages.overview;
  }, [active]);

  return (
    <>
      <Shell active={active} setActive={setActive} onOpenCmd={() => setCmdOpen(true)}>
        <AnimatePresence mode="wait">{page}</AnimatePresence>
      </Shell>
      <AnimatePresence>
        {cmdOpen && (
          <CommandPalette
            open={cmdOpen}
            onClose={() => setCmdOpen(false)}
            onNavigate={setActive}
          />
        )}
      </AnimatePresence>
    </>
  );
}
