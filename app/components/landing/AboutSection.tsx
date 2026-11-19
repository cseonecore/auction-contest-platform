"use client";

const pillars = [
  {
    num: "01",
    title: "Strategic Bidding",
    desc: "Teams use 100 bidding points to secure problem statements. Only winning bids deduct points — losers conserve resources for the next round.",
    icon: (
      <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
      </svg>
    ),
  },
  {
    num: "02",
    title: "Rapid Development",
    desc: "Build a fully functioning, browser-based web application within the allotted build window. Speed, quality, and technical depth all matter.",
    icon: (
      <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
      </svg>
    ),
  },
  {
    num: "03",
    title: "Innovation & Execution",
    desc: "Demonstrate technical skills through well-designed, explainable solutions. Judges evaluate design, functionality, innovation, and code quality.",
    icon: (
      <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
      </svg>
    ),
  },
];

export const AboutSection = () => {
  return (
    <section
      id="about"
      className="py-20 md:py-28 border-b border-white/5 scroll-mt-20"
    >
      <div className="max-w-6xl mx-auto px-4 sm:px-6">
        {/* Header */}
        <div className="mb-12">
          <div className="flex items-center gap-2 text-[#fe5102] text-xs font-semibold tracking-[0.2em] uppercase mb-4">
            <div className="h-px w-6 bg-[#fe5102]" />
            <span>WHAT IS BID2BUILD?</span>
          </div>
          <h2 className="text-3xl sm:text-4xl lg:text-5xl font-extrabold tracking-tight text-white mb-5 max-w-3xl">
            Where Auction Strategy Meets{" "}
            <span className="text-[#fe5102]">Development Skill</span>
          </h2>
          <p className="text-base sm:text-lg text-[#7a7a7a] max-w-2xl leading-relaxed">
            Bid2Build is a web development auction contest where teams compete to secure problem
            statements through live bidding, then build working web applications within a strict
            time window. It combines the strategy of an auction with the creativity of a hackathon —
            challenging participants to balance rapid decision-making with technical execution.
          </p>
        </div>

        {/* Three pillars */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-5">
          {pillars.map((p) => (
            <div
              key={p.num}
              className="group p-6 rounded-2xl bg-[#101010] border border-white/[0.07] hover:border-[#fe5102]/30 hover:bg-[#111111] transition-all"
            >
              {/* Icon + number */}
              <div className="flex items-start justify-between mb-4">
                <div className="w-11 h-11 rounded-xl bg-[#fe5102]/10 flex items-center justify-center text-[#fe5102] group-hover:bg-[#fe5102]/20 transition-colors">
                  {p.icon}
                </div>
                <span className="text-xs font-black text-[#fe5102]/30 tracking-widest mt-1">
                  {p.num}
                </span>
              </div>

              <h3 className="font-bold text-white text-base mb-2 group-hover:text-[#fe5102] transition-colors">
                {p.title}
              </h3>
              <p className="text-sm text-[#6b6b6d] leading-relaxed">{p.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};
