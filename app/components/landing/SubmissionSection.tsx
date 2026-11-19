"use client";

export const SubmissionSection = () => {
  return (
    <section className="py-24 md:py-32 border-b border-white/5">
      <div className="max-w-7xl mx-auto px-6">
        <div className="hidden md:block mb-8">
          <div className="flex items-center gap-2 text-[#fe5102] text-xs font-medium tracking-widest uppercase">
            <span>SUBMISSION REQUIREMENTS</span>
          </div>
        </div>

        <h2 className="text-4xl sm:text-5xl font-extrabold tracking-tight text-white mb-6">
          Submission Requirements
        </h2>

        <p className="text-lg text-[#6b6b6d] max-w-2xl mb-10">
          What you need to submit for evaluation.
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          <div className="p-6 rounded-2xl bg-[#16171b] border border-white/10">
            <div className="w-12 h-12 rounded-xl bg-[#fe5102]/15 flex items-center justify-center mb-4">
              <svg className="w-6 h-6 text-[#fe5102]" viewBox="0 0 24 24" fill="currentColor">
                <path d="M3 3h2l7 17 2-7h3l7-17 2 7h5l-5 15-5-15H5l-2-7zM6 15h4v4H6zM4 9h16v2H4z" />
              </svg>
            </div>
            <h4 className="font-bold text-white mb-2">GitHub Repository</h4>
            <p className="text-sm text-[#6b6b6d]">
              Full repository with source code, branches, and commit history.
            </p>
          </div>

          <div className="p-6 rounded-2xl bg-[#16171b] border border-white/10">
            <div className="w-12 h-12 rounded-xl bg-[#fe5102]/15 flex items-center justify-center mb-4">
              <svg className="w-6 h-6 text-[#fe5102]" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 2c5.523 0 10 4.477 10 10s-4.477 10-10 10S2 17.523 2 12 6.477 2 12 2zm1 14h-2v-2h2v2zm0-4h-2V8h2v6zm0-4h-2V4h2v2zm4-5h-2v9.59l3 3 2.29-2.29L16 5.88l-3.57 3.57a.9959.9959 0 0 0 0 1.41l1.72 1.72c.26.26.26.68.01.94l-1.88 1.88a1 1 0 0 0 0 1.41l1.71 1.71c.25.25.68.26.94.01l1.89-1.89a1 1 0 0 0 1.41-1.41l-1.72-1.72c-.26-.26-.68-.26-.94 0l-1.88 1.88L20 9.59l-3 3-2.3-2.3L15.12 7l1.71-1.71z" />
              </svg>
            </div>
            <h4 className="font-bold text-white mb-2">Vercel Deployment</h4>
            <p className="text-sm text-[#6b6b6d]">
              Live deployment of your web application on Vercel.
            </p>
          </div>

          <div className="p-6 rounded-2xl bg-[#16171b] border border-white/10">
            <div className="w-12 h-12 rounded-xl bg-[#fe5102]/15 flex items-center justify-center mb-4">
              <svg className="w-6 h-6 text-[#fe5102]" viewBox="0 0 24 24" fill="currentColor">
                <path d="M2 4h16c.552 0 1 .448 1 1v1c0 .668-.548 1.397-.99 1.49L8.293 14.293a.997.997 0 0 1-1.413-.01L2 10c0-.552.448-1 1-1zM2 6h4v2H2V6zm4 8H8v2h8v-2h-4zm0 4H8v2h12v-2H8z" />
              </svg>
            </div>
            <h4 className="font-bold text-white mb-2">README Documentation</h4>
            <p className="text-sm text-[#6b6b6d]">
              Detailed project description, setup instructions, and screenshots.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
};