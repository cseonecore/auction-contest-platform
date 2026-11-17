"use client";

import { useState } from "react";

interface FaqItem {
  question: string;
  answer: string;
}

const faqItems: FaqItem[] = [
  {
    question: "Who can participate?",
    answer:
      "Currently enrolled college students. Teams must contain 2–4 members. No solo participation is allowed.",
  },
  {
    question: "How many members can a team have?",
    answer:
      "Teams must contain 2–4 members. A minimum of 2 members is required; a team of 1 is not permitted.",
  },
  {
    question: "Can we use AI tools?",
    answer:
      "AI coding tools are permitted. However, participants must understand and be able to explain their code during evaluation.",
  },
  {
    question: "Which technologies are allowed?",
    answer:
      "Any suitable web development framework or language is allowed. The application must be browser-based.",
  },
  {
    question: "What do we need to submit?",
    answer:
      "A GitHub repository link containing the project source code and a README with project details, instructions, and screenshots. A deployed Vercel application link is also required.",
  },
  {
    question: "Is a Vercel deployment mandatory?",
    answer:
      "Yes, a deployed Vercel application link is mandatory for all submissions.",
  },
  {
    question: "Can we use existing templates or libraries?",
    answer:
      "Yes, participants may use existing templates or libraries. However, they must understand and explain all code used in their submission.",
  },
  {
    question: "Who can access the team's account?",
    answer:
      "Only the designated team captain and registered team members can access the team's account. No unauthorized sharing or multiple-device login is permitted.",
  },
  {
    question: "How are submissions evaluated?",
    answer:
      "Submissions are evaluated based on design and approach, functionality, topic-specific requirements, innovation, and code quality including README documentation.",
  },
  {
    question: "When will results be announced?",
    answer:
      "Results are announced after the event concludes. Exact timing will be communicated to all registered participants.",
  },
];

export const FaqAccordion = () => {
  const [openIndex, setOpenIndex] = useState<number | null>(null);

  return (
    <section id="faq" className="py-20 md:py-28 border-b border-white/5 scroll-mt-20">
      <div className="max-w-4xl mx-auto px-4 sm:px-6">
        {/* Header */}
        <div className="mb-10">
          <div className="flex items-center gap-2 text-[#fe5102] text-xs font-semibold tracking-[0.2em] uppercase mb-4">
            <div className="h-px w-6 bg-[#fe5102]" />
            <span>FAQ</span>
          </div>
          <h2 className="text-3xl sm:text-4xl lg:text-5xl font-extrabold tracking-tight text-white">
            Frequently Asked Questions
          </h2>
        </div>

        {/* Accordion items */}
        <div className="space-y-2">
          {faqItems.map((item, index) => {
            const isOpen = openIndex === index;
            return (
              <div
                key={index}
                className={`rounded-xl overflow-hidden border transition-colors ${
                  isOpen
                    ? "border-[#fe5102]/30 bg-[#141414]"
                    : "border-white/[0.07] bg-[#0f0f0f] hover:border-white/15"
                }`}
              >
                <button
                  onClick={() => setOpenIndex(isOpen ? null : index)}
                  className="w-full text-left flex items-center justify-between gap-4 py-4 px-5 text-white font-medium text-sm sm:text-base transition-colors"
                  aria-controls={`faq-answer-${index}`}
                  aria-expanded={isOpen}
                >
                  <span className="flex-1">{item.question}</span>
                  <span
                    className={`shrink-0 w-6 h-6 rounded-full flex items-center justify-center transition-all ${
                      isOpen ? "bg-[#fe5102] rotate-45" : "bg-white/10"
                    }`}
                    aria-hidden="true"
                  >
                    <svg
                      className="w-3 h-3 text-white"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth={3}
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                    </svg>
                  </span>
                </button>

                <div
                  id={`faq-answer-${index}`}
                  role="region"
                  className={`overflow-hidden transition-all duration-300 ease-in-out ${
                    isOpen ? "max-h-96" : "max-h-0"
                  }`}
                >
                  <p className="px-5 pb-4 pt-0 text-sm text-[#8a8a8a] leading-relaxed">
                    {item.answer}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
};
