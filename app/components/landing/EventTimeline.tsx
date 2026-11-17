"use client";

export const EventTimeline = () => {
  return (
    <section className="py-24 md:py-32 border-b border-white/5">
      <div className="max-w-7xl mx-auto px-6">
        <div className="hidden md:block mb-8">
          <div className="flex items-center gap-2 text-[#fe5102] text-xs font-medium tracking-widest uppercase">
            <span>EVENT TIMELINE</span>
          </div>
        </div>

        <h2 className="text-4xl sm:text-5xl font-extrabold tracking-tight text-white mb-6">
          COMPETITION PHASES
        </h2>

        <p className="text-lg text-[#6b6b6d] max-w-2xl mb-10">
          Key phases of the Bid2Build competition.
        </p>

        <div className="relative space-y-8">
          {/* Timeline line */}
          <div className="absolute left-1/2 -translate-x-1/2 top-0 bottom-0 w-1.5 bg-[#fe5102]"></div>

          {/* Stage 1 */}
          <div className="relative flex items-start gap-4 md:w-1/3">
            <div className="absolute left-1/2 -translate-x-1/2 -top-4 w-8 h-8 rounded-full bg-[#0d0d0d] border border-white/5 flex items-center justify-center text-[#fe5102] font-bold text-sm z-10">
              1
            </div>
            <div>
              <h3 className="font-bold text-white text-sm">Team Registration</h3>
              <p className="text-sm text-[#6b6b6d] line-clamp-2">
                Register your team and designate a captain. Provide team details and member information.
              </p>
            </div>
          </div>

          {/* Stage 2 */}
          <div className="relative flex items-start gap-4 md:w-1/3">
            <div className="absolute left-1/2 -translate-x-1/2 -top-4 w-8 h-8 rounded-full bg-[#0d0d0d] border border-white/5 flex items-center justify-center text-[#fe5102] font-bold text-sm z-10">
              2
            </div>
            <div>
              <h3 className="font-bold text-white text-sm">Mock Auction</h3>
              <p className="text-sm text-[#6b6b6d] line-clamp-2">
                Test your account and connection. Familiarize yourself with the bidding interface.
              </p>
            </div>
          </div>

          {/* Stage 3 */}
          <div className="relative flex items-start gap-4 md:w-1/3">
            <div className="absolute left-1/2 -translate-x-1/2 -top-4 w-8 h-8 rounded-full bg-[#0d0d0d] border border-white/5 flex items-center justify-center text-[#fe5102] font-bold text-sm z-10">
              3
            </div>
            <div>
              <h3 className="font-bold text-white text-sm">Live Auction</h3>
              <p className="text-sm text-[#6b6b6d] line-clamp-2">
                Compete for problem statements using bidding points. Winning bids deduct points; losing bids do not.
              </p>
            </div>
          </div>

          {/* Stage 4 */}
          <div className="relative flex items-start gap-4 md:w-1/3">
            <div className="absolute left-1/2 -translate-x-1/2 -top-4 w-8 h-8 rounded-full bg-[#0d0d0d] border border-white/5 flex items-center justify-center text-[#fe5102] font-bold text-sm z-10">
              4
            </div>
            <div>
              <h3 className="font-bold text-white text-sm">Build Phase</h3>
              <p className="text-sm text-[#6b6b6d] line-clamp-2">
                Develop your web application within the 2-hour build window.
              </p>
            </div>
          </div>

          {/* Stage 5 */}
          <div className="relative flex items-start gap-4 md:w-1/3">
            <div className="absolute left-1/2 -translate-x-1/2 -top-4 w-8 h-8 rounded-full bg-[#0d0d0d] border border-white/5 flex items-center justify-center text-[#fe5102] font-bold text-sm z-10">
              5
            </div>
            <div>
              <h3 className="font-bold text-white text-sm">Submission</h3>
              <p className="text-sm text-[#6b6b6d] line-clamp-2">
                Submit your GitHub repository and deployed Vercel application with required details.
              </p>
            </div>
          </div>

          {/* Stage 6 */}
          <div className="relative flex items-start gap-4 md:w-1/3">
            <div className="absolute left-1/2 -translate-x-1/2 -top-4 w-8 h-8 rounded-full bg-[#0d0d0d] border border-white/5 flex items-center justify-center text-[#fe5102] font-bold text-sm z-10">
              6
            </div>
            <div>
              <h3 className="font-bold text-white text-sm">Evaluation</h3>
              <p className="text-sm text-[#6b6b6d] line-clamp-2">
                Submissions are evaluated by judges based on design, functionality, innovation, and code quality.
              </p>
            </div>
          </div>

          {/* Stage 7 */}
          <div className="relative flex items-start gap-4 md:w-1/3">
            <div className="absolute left-1/2 -translate-x-1/2 -top-4 w-8 h-8 rounded-full bg-[#0d0d0d] border border-white/5 flex items-center justify-center text-[#fe5102] font-bold text-sm z-10">
              7
            </div>
            <div>
              <h3 className="font-bold text-white text-sm">Results</h3>
              <p className="text-sm text-[#6b6b6d] line-clamp-2">
                Results announced after the event. Recognition and prizes for top submissions.
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};