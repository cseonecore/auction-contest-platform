"use client";

const stages = [
  {
    num: "01",
    title: "Team Registration",
    desc: "Register your team and designate a captain. Provide team details, member USNs, and contact information.",
    icon: (
      <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
      </svg>
    ),
  },
  {
    num: "02",
    title: "Mock Auction",
    desc: "Test your account access and bidding interface. Familiarize yourself with the platform before the live event.",
    icon: (
      <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
      </svg>
    ),
  },
  {
    num: "03",
    title: "Live Auction",
    desc: "Compete for problem statements using your 100 bidding points. Only winning bids deduct points — losers get theirs back.",
    icon: (
      <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
      </svg>
    ),
  },
  {
    num: "04",
    title: "Build Phase",
    desc: "Develop a working, browser-based application within the available build window. Speed and quality both count.",
    icon: (
      <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
      </svg>
    ),
  },
  {
    num: "05",
    title: "Submission",
    desc: "Submit your GitHub repository, README, and deployed Vercel application before the deadline.",
    icon: (
      <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
      </svg>
    ),
  },
  {
    num: "06",
    title: "Evaluation",
    desc: "Applications undergo AI-assisted evaluation and organizer review across design, functionality, innovation, and code quality.",
    icon: (
      <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    ),
  },
  {
    num: "07",
    title: "Results",
    desc: "Results are announced after the event. Top submissions receive recognition from the organizing committee.",
    icon: (
      <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z" />
      </svg>
    ),
  },
];

export const HowItWorks = () => {
  return (
    <section
      id="how-it-works"
      className="py-20 md:py-28 border-b border-white/5 bg-[#0d0d0d] scroll-mt-20"
    >
      <div className="max-w-6xl mx-auto px-4 sm:px-6">
        {/* Header */}
        <div className="mb-14 md:mb-16">
          <div className="flex items-center gap-2 text-[#fe5102] text-xs font-semibold tracking-[0.2em] uppercase mb-4">
            <div className="h-px w-6 bg-[#fe5102]" />
            <span>HOW IT WORKS</span>
          </div>
          <h2 className="text-3xl sm:text-4xl lg:text-5xl font-extrabold tracking-tight text-white mb-4">
            Your Competition Journey
          </h2>
          <p className="text-base sm:text-lg text-[#6b6b6d] max-w-xl">
            Seven stages from registration to results.
          </p>
        </div>

        {/* Desktop: Alternating connected map */}
        <div className="hidden md:block">
          {stages.map((stage, i) => {
            const isEven = i % 2 === 0;
            const isLast = i === stages.length - 1;
            return (
              <div key={stage.num} className="relative">
                {/* Stage row */}
                <div
                  className={`flex items-start gap-0 ${isEven ? "flex-row" : "flex-row-reverse"}`}
                >
                  {/* Content card */}
                  <div className={`w-[42%] ${isEven ? "pr-10 text-right" : "pl-10 text-left"}`}>
                    <div
                      className={`inline-block p-5 rounded-2xl bg-[#141414] border border-white/[0.07] hover:border-[#fe5102]/30 transition-all group ${
                        isEven ? "ml-auto" : "mr-auto"
                      }`}
                      style={{ minWidth: 220 }}
                    >
                      <div
                        className={`flex items-center gap-3 mb-2 ${
                          isEven ? "flex-row-reverse justify-start" : ""
                        }`}
                      >
                        <div className="w-8 h-8 rounded-lg bg-[#fe5102]/10 flex items-center justify-center text-[#fe5102] group-hover:bg-[#fe5102]/20 transition-colors shrink-0">
                          {stage.icon}
                        </div>
                        <span className="text-xs font-bold tracking-widest text-[#fe5102]">
                          {stage.num}
                        </span>
                      </div>
                      <h3 className="font-bold text-white text-base mb-1 group-hover:text-[#fe5102] transition-colors">
                        {stage.title}
                      </h3>
                      <p className="text-sm text-[#6b6b6d] leading-relaxed">
                        {stage.desc}
                      </p>
                    </div>
                  </div>

                  {/* Center spine */}
                  <div className="w-[16%] flex flex-col items-center">
                    {/* Stage node */}
                    <div className="relative z-10 w-12 h-12 rounded-full bg-[#fe5102] flex items-center justify-center shadow-lg shadow-[#fe5102]/30 shrink-0 ring-4 ring-[#0d0d0d]">
                      <span className="text-white font-black text-sm">{parseInt(stage.num)}</span>
                    </div>
                    {/* Connecting line going down */}
                    {!isLast && (
                      <div className="w-px flex-1 min-h-[48px] bg-gradient-to-b from-[#fe5102]/60 to-[#fe5102]/10 mt-1" />
                    )}
                  </div>

                  {/* Spacer for the other side */}
                  <div className="w-[42%]" />
                </div>
              </div>
            );
          })}
        </div>

        {/* Mobile: Vertical connected timeline */}
        <div className="md:hidden">
          <div className="relative pl-8">
            {/* Vertical spine line */}
            <div
              className="absolute left-[15px] top-5 bottom-5 w-px bg-gradient-to-b from-[#fe5102]/80 via-[#fe5102]/30 to-transparent"
              aria-hidden="true"
            />

            {stages.map((stage, i) => (
              <div key={stage.num} className={`relative flex gap-5 ${i < stages.length - 1 ? "mb-8" : ""}`}>
                {/* Node */}
                <div className="absolute -left-8 top-0 z-10 w-8 h-8 rounded-full bg-[#fe5102] flex items-center justify-center shadow-md shadow-[#fe5102]/30 ring-2 ring-[#0d0d0d] shrink-0">
                  <span className="text-white font-black text-xs">{parseInt(stage.num)}</span>
                </div>

                {/* Card */}
                <div className="flex-1 p-4 rounded-xl bg-[#141414] border border-white/[0.07] hover:border-[#fe5102]/30 transition-all group">
                  <div className="flex items-center gap-2 mb-2">
                    <div className="w-7 h-7 rounded-lg bg-[#fe5102]/10 flex items-center justify-center text-[#fe5102] shrink-0">
                      {stage.icon}
                    </div>
                    <span className="text-[10px] font-bold tracking-widest text-[#fe5102]">{stage.num}</span>
                  </div>
                  <h3 className="font-bold text-white text-sm mb-1 group-hover:text-[#fe5102] transition-colors">
                    {stage.title}
                  </h3>
                  <p className="text-xs text-[#6b6b6d] leading-relaxed">{stage.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
};
