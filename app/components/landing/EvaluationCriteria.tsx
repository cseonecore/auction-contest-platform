"use client";

const criteria = [
  {
    title: "Design & Approach",
    desc: "Creativity, originality, and thoughtful problem-solving. How well does the solution address the assigned problem with intent and design thinking?",
    icon: (
      <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zm0 0h12a2 2 0 002-2v-4a2 2 0 00-2-2h-2.343M11 7.343l1.657-1.657a2 2 0 012.828 0l2.829 2.829a2 2 0 010 2.828l-8.486 8.485M7 17h.01" />
      </svg>
    ),
  },
  {
    title: "Functionality",
    desc: "A working application with the features described in the problem statement. No broken links, crashes, or incomplete flows during evaluation.",
    icon: (
      <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    ),
  },
  {
    title: "Topic-Specific Requirements",
    desc: "Adherence to the assigned problem statement and all technical requirements. Does the solution fulfill everything the problem asks for?",
    icon: (
      <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
      </svg>
    ),
  },
  {
    title: "Innovation",
    desc: "Unique solution approach, creative use of technology, or novel interpretation of the problem statement. What makes this submission stand out?",
    icon: (
      <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
      </svg>
    ),
  },
  {
    title: "Code Quality & README",
    desc: "Well-structured, readable, and maintainable code. A comprehensive README with project details, setup instructions, and screenshots.",
    icon: (
      <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
      </svg>
    ),
  },
];

export const EvaluationCriteria = () => {
  return (
    <section className="py-20 md:py-28 border-b border-white/5 bg-[#0d0d0d]">
      <div className="max-w-6xl mx-auto px-4 sm:px-6">
        {/* Header */}
        <div className="mb-10">
          <div className="flex items-center gap-2 text-[#fe5102] text-xs font-semibold tracking-[0.2em] uppercase mb-4">
            <div className="h-px w-6 bg-[#fe5102]" />
            <span>EVALUATION CRITERIA</span>
          </div>
          <h2 className="text-3xl sm:text-4xl lg:text-5xl font-extrabold tracking-tight text-white mb-3">
            How Submissions Are Evaluated
          </h2>
          <p className="text-base text-[#6b6b6d] max-w-xl">
            All submissions are evaluated across the following dimensions by our judging panel.
          </p>
        </div>

        {/* Criteria grid — 3 + 2 layout */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5 mb-5">
          {criteria.slice(0, 3).map((c) => (
            <div
              key={c.title}
              className="p-5 rounded-2xl bg-[#101010] border border-white/[0.07] hover:border-[#fe5102]/30 transition-all group"
            >
              <div className="w-10 h-10 rounded-xl bg-[#fe5102]/10 flex items-center justify-center text-[#fe5102] mb-4 group-hover:bg-[#fe5102]/20 transition-colors">
                {c.icon}
              </div>
              <h3 className="font-bold text-white text-base mb-2 group-hover:text-[#fe5102] transition-colors">
                {c.title}
              </h3>
              <p className="text-sm text-[#6b6b6d] leading-relaxed">{c.desc}</p>
            </div>
          ))}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
          {criteria.slice(3).map((c) => (
            <div
              key={c.title}
              className="p-5 rounded-2xl bg-[#101010] border border-white/[0.07] hover:border-[#fe5102]/30 transition-all group"
            >
              <div className="w-10 h-10 rounded-xl bg-[#fe5102]/10 flex items-center justify-center text-[#fe5102] mb-4 group-hover:bg-[#fe5102]/20 transition-colors">
                {c.icon}
              </div>
              <h3 className="font-bold text-white text-base mb-2 group-hover:text-[#fe5102] transition-colors">
                {c.title}
              </h3>
              <p className="text-sm text-[#6b6b6d] leading-relaxed">{c.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};
