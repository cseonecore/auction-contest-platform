"use client";

const ruleGroups = [
  {
    title: "Team Eligibility",
    icon: (
      <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
      </svg>
    ),
    rules: [
      "Currently enrolled college students",
      "Teams must contain 3–4 members",
      "Teams of 1 or 2 members are not allowed",
      "One team per student",
      "Maximum of 20 teams overall",
      "One designated captain per team",
    ],
  },
  {
    title: "Auction Guidelines",
    icon: (
      <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
      </svg>
    ),
    rules: [
      "Each team starts with 100 bidding points",
      "Points are deducted only when a team wins",
      "Losing bids do not consume points",
      "Unspent points contribute to the evaluation bonus",
      "Bids are final once placed",
      "Only the designated captain can log in and bid",
    ],
  },
  {
    title: "Development Guidelines",
    icon: (
      <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
      </svg>
    ),
    rules: [
      "Build browser-based web applications for both problem statements",
      "Both problem statements are compulsory to develop",
      "Any suitable web development framework or language is allowed",
      "AI coding tools are permitted",
      "Participants must understand and explain their code",
    ],
  },
  {
    title: "Submission Requirements",
    icon: (
      <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
      </svg>
    ),
    rules: [
      "Select ONE of your two developed solutions for final submission",
      "GitHub repository link with source code",
      "README with project details, instructions, and screenshots",
      "Deployed Vercel application link (mandatory)",
      "Required team submission details",
    ],
  },
  {
    title: "Fair Play",
    icon: (
      <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
      </svg>
    ),
    rules: [
      "No copying another team's work",
      "No unauthorized account sharing",
      "No multiple-device login",
      "No manipulation of evaluation or auction systems",
      "No submission unrelated to the assigned problem",
    ],
  },
];

export const RulesOverview = () => {
  return (
    <section
      id="rules"
      className="py-20 md:py-28 bg-[#0a0a0a] border-b border-white/5 scroll-mt-20"
    >
      <div className="max-w-6xl mx-auto px-4 sm:px-6">
        {/* Header */}
        <div className="mb-10">
          <div className="flex items-center gap-2 text-[#fe5102] text-xs font-semibold tracking-[0.2em] uppercase mb-4">
            <div className="h-px w-6 bg-[#fe5102]" />
            <span>KNOW THE RULES</span>
          </div>
          <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-5">
            <div>
              <h2 className="text-3xl sm:text-4xl lg:text-5xl font-extrabold tracking-tight text-white mb-3">
                Know the Rules.{" "}
                <span className="text-[#fe5102]">Play Smart.</span>
              </h2>
              <p className="text-base text-[#6b6b6d] max-w-xl">
                Review the competition rules before registering. Full details are in the official rulebook.
              </p>
            </div>

            {/* PDF Download — actual working link */}
            <a
              href="/documents/bid2build-rulebook.pdf"
              download="Bid2Build-RuleBook.pdf"
              className="inline-flex items-center gap-2 px-6 py-3 rounded-full bg-[#fe5102] text-white font-semibold text-sm hover:bg-[#e54700] transition-all shadow-lg shadow-[#fe5102]/25 hover:-translate-y-0.5 shrink-0"
            >
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              Read Complete Rule Book
            </a>
          </div>
        </div>

        {/* Rules grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {ruleGroups.map((group) => (
            <div
              key={group.title}
              className="p-5 rounded-2xl bg-[#111111] border border-white/[0.07] hover:border-[#fe5102]/25 transition-all group"
            >
              {/* Card header */}
              <div className="flex items-center gap-3 mb-4">
                <div className="w-9 h-9 rounded-xl bg-[#fe5102]/10 flex items-center justify-center text-[#fe5102] group-hover:bg-[#fe5102]/20 transition-colors shrink-0">
                  {group.icon}
                </div>
                <h3 className="font-bold text-white text-sm">{group.title}</h3>
              </div>

              {/* Rules list */}
              <ul className="space-y-2.5">
                {group.rules.map((rule, i) => (
                  <li key={i} className="flex items-start gap-2.5 text-sm text-[#7a7a7a]">
                    <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-[#fe5102]/50 shrink-0" />
                    <span className="leading-relaxed">{rule}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};
