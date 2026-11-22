"use client";

const stats = [
  { value: "25", label: "Maximum Teams", sub: "Limited spots" },
  { value: "2–4", label: "Team Size", sub: "Members per team" },
  { value: "100", label: "Bidding Points", sub: "Per team at start" },
  { value: "2 hrs", label: "Build Window", sub: "+ 25 min extension" },
];

const requirements = [
  {
    icon: (
      <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
      </svg>
    ),
    label: "GitHub",
    desc: "Repository required",
  },
  {
    icon: (
      <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
        <circle cx="12" cy="12" r="10" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M2 12h20M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z" />
      </svg>
    ),
    label: "Vercel",
    desc: "Live deployment required",
  },
  {
    icon: (
      <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
      </svg>
    ),
    label: "README",
    desc: "With screenshots",
  },
];

export const StatsSection = () => {
  return (
    <section className="py-16 md:py-20 bg-[#080808] border-b border-white/5">
      <div className="max-w-6xl mx-auto px-4 sm:px-6">
        {/* Header */}
        <div className="mb-10">
          <div className="flex items-center gap-2 text-[#fe5102] text-xs font-semibold tracking-[0.2em] uppercase mb-4">
            <div className="h-px w-6 bg-[#fe5102]" />
            <span>COMPETITION AT A GLANCE</span>
          </div>
          <h2 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-white">
            Key Facts
          </h2>
        </div>

        {/* Stats grid */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          {stats.map((s) => (
            <div
              key={s.label}
              className="p-5 sm:p-6 rounded-2xl bg-[#0f0f0f] border border-white/[0.07] hover:border-[#fe5102]/25 transition-colors text-center group"
            >
              <div className="text-3xl sm:text-4xl font-black text-[#fe5102] mb-1 group-hover:scale-110 transition-transform">
                {s.value}
              </div>
              <div className="text-sm font-semibold text-white mb-0.5">{s.label}</div>
              <div className="text-xs text-[#5a5a5a]">{s.sub}</div>
            </div>
          ))}
        </div>

        {/* Requirements row */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {requirements.map((r) => (
            <div
              key={r.label}
              className="flex items-center gap-4 p-4 rounded-xl bg-[#0f0f0f] border border-white/[0.07] hover:border-[#fe5102]/20 transition-colors"
            >
              <div className="w-9 h-9 rounded-lg bg-[#fe5102]/10 flex items-center justify-center text-[#fe5102] shrink-0">
                {r.icon}
              </div>
              <div>
                <div className="text-sm font-bold text-white">{r.label}</div>
                <div className="text-xs text-[#5a5a5a]">{r.desc}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};
