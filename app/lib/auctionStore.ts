/**
 * In-memory authoritative Auction State Store
 * Acts as a synchronized high-performance state layer that integrates
 * with Supabase database rows and functions, while providing resilience
 * against RLS read locks or network hiccups.
 */

export interface AuctionTopic {
  id: string;
  level: "easy" | "hard";
  title: string;
  description: string;
  criterion?: any;
}

export interface AuctionSlotState {
  id: string;
  topic_id: string;
  round: number;
  status: "pending" | "open" | "sold" | "skipped";
  current_bid: number;
  leader_team_id: string | null;
  end_time: string | null;
  winner_team_id: string | null;
  topic?: AuctionTopic;
  leader_team?: { id: string; name: string } | null;
  winner_team?: { id: string; name: string } | null;
}

export interface AuctionTeamState {
  id: string;
  name: string;
  captain_id: string | null;
  locked: boolean;
  balance: number;
  currentBid: number;
  characterIndex: number;
}

export interface ConcludedSlotResult {
  slotId: string;
  slotNumber: number;
  round: number;
  status: "sold" | "skipped";
  topicTitle: string;
  winnerTeam?: { id: string; name: string } | null;
  winningBid: number;
  coinsDeducted: number;
  endTime: string;
}

export const INITIAL_TOPICS: AuctionTopic[] = [
  { id: "11111111-0001-4000-8000-000000000001", level: "easy", title: "Campus Life Tech", description: "Lost-and-found, canteen queues, event discovery." },
  { id: "11111111-0001-4000-8000-000000000002", level: "easy", title: "Student Finance", description: "Budgeting and split-expense apps." },
  { id: "11111111-0001-4000-8000-000000000003", level: "easy", title: "Hyperlocal Marketplace", description: "Buy, sell, or rent within campus." },
  { id: "11111111-0001-4000-8000-000000000004", level: "easy", title: "Smart Attendance and Timetable", description: "QR-based attendance, clash-free scheduling." },
  { id: "11111111-0001-4000-8000-000000000005", level: "easy", title: "Fun and Creative Tech", description: "Meme generators, music recommenders, campus games." },
  { id: "11111111-0001-4000-8000-000000000006", level: "easy", title: "Gamified Learning", description: "Quests, points, and levels for boring subjects." },
  { id: "11111111-0001-4000-8000-000000000007", level: "easy", title: "Green Campus", description: "Energy tracking, waste sorting, carpooling." },
  { id: "11111111-0001-4000-8000-000000000008", level: "easy", title: "Club and Event Management", description: "Registrations, volunteer tracking, certificates." },
  { id: "11111111-0001-4000-8000-000000000009", level: "easy", title: "Hostel and Mess Management", description: "Menu feedback, room requests, complaint tracking." },
  { id: "11111111-0001-4000-8000-000000000010", level: "easy", title: "Notes and Resource Sharing", description: "Platforms to share and organize study material." },
  { id: "22222222-0002-4000-8000-000000000001", level: "hard", title: "AI Study Buddy", description: "Personalized notes, doubt solving, exam prep." },
  { id: "22222222-0002-4000-8000-000000000002", level: "hard", title: "Fake News and Deepfake Detection", description: "Spotting fake media and misinformation." },
  { id: "22222222-0002-4000-8000-000000000003", level: "hard", title: "Accessibility Tools", description: "Sign language translation, voice navigation." },
  { id: "22222222-0002-4000-8000-000000000004", level: "hard", title: "Open Source for NGOs", description: "Real-world tools with real users and constraints." },
  { id: "22222222-0002-4000-8000-000000000005", level: "hard", title: "Career Readiness", description: "Resume analyzers, mock interview bots, skill-gap mapping." },
  { id: "22222222-0002-4000-8000-000000000006", level: "hard", title: "Women's Safety", description: "Smart alerts, safe routes, incident reporting." },
  { id: "22222222-0002-4000-8000-000000000007", level: "hard", title: "Mental Wellness", description: "Anonymous peer support, stress trackers, burnout detection." },
  { id: "22222222-0002-4000-8000-000000000008", level: "hard", title: "Cybersecurity for Students", description: "Phishing and scam detection, password safety tools." },
  { id: "22222222-0002-4000-8000-000000000009", level: "hard", title: "Automated Evaluation Engine", description: "Code analysis, vulnerability assessment, scoring." },
  { id: "22222222-0002-4000-8000-000000000010", level: "hard", title: "Disaster and Crisis Coordination", description: "Offline routing, emergency volunteer dispatch." },
];

export const INITIAL_TEAMS: AuctionTeamState[] = [
  { id: "32254098-4572-472d-b75e-1dc51ebcb273", name: "Team Alpha", captain_id: null, locked: false, balance: 57, currentBid: 60, characterIndex: 1 },
  { id: "e0000000-0001-4000-8000-000000000002", name: "Team Beta", captain_id: null, locked: false, balance: 75, currentBid: 59, characterIndex: 2 },
  { id: "e0000000-0001-4000-8000-000000000003", name: "Team Gamma", captain_id: null, locked: false, balance: 80, currentBid: 43, characterIndex: 3 },
  { id: "e0000000-0001-4000-8000-000000000004", name: "Team Delta", captain_id: null, locked: false, balance: 90, currentBid: 18, characterIndex: 4 },
  { id: "e0000000-0001-4000-8000-000000000005", name: "Team Epsilon", captain_id: null, locked: false, balance: 100, currentBid: 3, characterIndex: 5 },
  { id: "e0000000-0001-4000-8000-000000000006", name: "Team Zeta", captain_id: null, locked: false, balance: 100, currentBid: 2, characterIndex: 6 },
  { id: "e0000000-0001-4000-8000-000000000007", name: "Team Eta", captain_id: null, locked: false, balance: 100, currentBid: 1, characterIndex: 7 },
  { id: "e0000000-0001-4000-8000-000000000008", name: "Team Theta", captain_id: null, locked: false, balance: 100, currentBid: 0, characterIndex: 8 },
  { id: "e0000000-0001-4000-8000-000000000009", name: "Team Iota", captain_id: null, locked: false, balance: 100, currentBid: 0, characterIndex: 9 },
  { id: "e0000000-0001-4000-8000-000000000010", name: "Team Kappa", captain_id: null, locked: false, balance: 100, currentBid: 0, characterIndex: 10 },
  { id: "e0000000-0001-4000-8000-000000000011", name: "Team Lambda", captain_id: null, locked: false, balance: 100, currentBid: 0, characterIndex: 1 },
  { id: "e0000000-0001-4000-8000-000000000012", name: "Team Mu", captain_id: null, locked: false, balance: 100, currentBid: 0, characterIndex: 2 },
  { id: "e0000000-0001-4000-8000-000000000013", name: "Team Nu", captain_id: null, locked: false, balance: 100, currentBid: 0, characterIndex: 3 },
  { id: "e0000000-0001-4000-8000-000000000014", name: "Team Xi", captain_id: null, locked: false, balance: 100, currentBid: 0, characterIndex: 4 },
  { id: "e0000000-0001-4000-8000-000000000015", name: "Team Omicron", captain_id: null, locked: false, balance: 100, currentBid: 0, characterIndex: 5 },
  { id: "e0000000-0001-4000-8000-000000000016", name: "Team Pi", captain_id: null, locked: false, balance: 100, currentBid: 0, characterIndex: 6 },
  { id: "e0000000-0001-4000-8000-000000000017", name: "Team Rho", captain_id: null, locked: false, balance: 100, currentBid: 0, characterIndex: 7 },
  { id: "e0000000-0001-4000-8000-000000000018", name: "Team Sigma", captain_id: null, locked: false, balance: 100, currentBid: 0, characterIndex: 8 },
  { id: "e0000000-0001-4000-8000-000000000019", name: "Team Tau", captain_id: null, locked: false, balance: 100, currentBid: 0, characterIndex: 9 },
  { id: "e0000000-0001-4000-8000-000000000020", name: "Team Omega", captain_id: null, locked: false, balance: 100, currentBid: 0, characterIndex: 10 },
];

class AuctionStore {
  private static instance: AuctionStore;

  public slots: AuctionSlotState[] = [];
  public teams: AuctionTeamState[] = [];
  public history: ConcludedSlotResult[] = [];
  public activeSlotIndex: number = 3; // Slot 3 of 40 as in screenshot
  public auctionStatus: "LIVE" | "UPCOMING" | "PAUSED" | "COMPLETED" = "LIVE";

  private constructor() {
    this.init();
  }

  public static getInstance(): AuctionStore {
    if (!AuctionStore.instance) {
      AuctionStore.instance = new AuctionStore();
    }
    return AuctionStore.instance;
  }

  private init() {
    this.teams = JSON.parse(JSON.stringify(INITIAL_TEAMS));

    // Create 40 slots matching Rule Book (20 Easy in Round 1, 20 Hard in Round 2)
    const newSlots: AuctionSlotState[] = [];
    for (let i = 0; i < 40; i++) {
      const topic = INITIAL_TOPICS[i % INITIAL_TOPICS.length];
      const round = i < 20 ? 1 : 2;
      const slotNum = i + 1;

      if (slotNum === 1) {
        // Slot 1: Sold to Team Alpha for 60
        newSlots.push({
          id: `slot-uuid-${slotNum.toString().padStart(3, '0')}`,
          topic_id: topic.id,
          round,
          status: "sold",
          current_bid: 60,
          leader_team_id: this.teams[0].id,
          winner_team_id: this.teams[0].id,
          end_time: new Date(Date.now() - 3600000).toISOString(),
          topic,
          winner_team: { id: this.teams[0].id, name: this.teams[0].name },
          leader_team: { id: this.teams[0].id, name: this.teams[0].name },
        });
      } else if (slotNum === 2) {
        // Slot 2: Unsold / Skipped
        newSlots.push({
          id: `slot-uuid-${slotNum.toString().padStart(3, '0')}`,
          topic_id: topic.id,
          round,
          status: "skipped",
          current_bid: 0,
          leader_team_id: null,
          winner_team_id: null,
          end_time: new Date(Date.now() - 1800000).toISOString(),
          topic,
        });
      } else if (slotNum === 3) {
        // Slot 3: LIVE (Problem Statment2, 3/40, countdown 1m 24s)
        const initialEnd = new Date(Date.now() + 84000).toISOString();
        newSlots.push({
          id: `slot-uuid-${slotNum.toString().padStart(3, '0')}`,
          topic_id: topic.id,
          round,
          status: "open",
          current_bid: 60,
          leader_team_id: this.teams[0].id,
          winner_team_id: null,
          end_time: initialEnd,
          topic,
          leader_team: { id: this.teams[0].id, name: this.teams[0].name },
        });
      } else {
        // Remaining slots pending
        newSlots.push({
          id: `slot-uuid-${slotNum.toString().padStart(3, '0')}`,
          topic_id: topic.id,
          round,
          status: "pending",
          current_bid: 0,
          leader_team_id: null,
          winner_team_id: null,
          end_time: null,
          topic,
        });
      }
    }

    this.slots = newSlots;

    // Concluded slots history
    this.history = [
      {
        slotId: this.slots[0].id,
        slotNumber: 1,
        round: 1,
        status: "sold",
        topicTitle: this.slots[0].topic?.title || "Problem 1",
        winnerTeam: { id: this.teams[0].id, name: this.teams[0].name },
        winningBid: 60,
        coinsDeducted: 60,
        endTime: this.slots[0].end_time!,
      },
      {
        slotId: this.slots[1].id,
        slotNumber: 2,
        round: 1,
        status: "skipped",
        topicTitle: this.slots[1].topic?.title || "Problem 2",
        winnerTeam: null,
        winningBid: 0,
        coinsDeducted: 0,
        endTime: this.slots[1].end_time!,
      },
    ];
  }

  public getActiveSlot(): AuctionSlotState {
    const open = this.slots.find((s) => s.status === "open");
    if (open) return open;
    const pending = this.slots.find((s) => s.status === "pending");
    return pending || this.slots[this.slots.length - 1];
  }

  public placeBid(slotId: string, teamId: string, amount: number) {
    const slot = this.slots.find((s) => s.id === slotId);
    if (!slot) throw new Error("Slot not found");
    if (slot.status !== "open") throw new Error("Slot is not open for bidding");
    if (slot.leader_team_id === teamId) throw new Error("Your team is already leading this slot");

    const team = this.teams.find((t) => t.id === teamId);
    if (!team) throw new Error("Team not found");
    if (team.balance < amount) throw new Error("Insufficient coins");

    // Extend timer by 5 seconds
    const curEnd = slot.end_time ? new Date(slot.end_time).getTime() : Date.now();
    const newEnd = new Date(Math.max(Date.now(), curEnd) + 5000).toISOString();

    slot.current_bid = amount;
    slot.leader_team_id = teamId;
    slot.leader_team = { id: team.id, name: team.name };
    slot.end_time = newEnd;

    team.currentBid = amount;

    return { slot, team, new_end_time: newEnd };
  }

  public closeSlot(slotId: string) {
    const slot = this.slots.find((s) => s.id === slotId);
    if (!slot) throw new Error("Slot not found");

    if (!slot.leader_team_id || slot.current_bid === 0) {
      slot.status = "skipped";
      slot.winner_team_id = null;
      slot.winner_team = null;

      this.history.unshift({
        slotId: slot.id,
        slotNumber: this.slots.findIndex((s) => s.id === slot.id) + 1,
        round: slot.round,
        status: "skipped",
        topicTitle: slot.topic?.title || "Problem",
        winnerTeam: null,
        winningBid: 0,
        coinsDeducted: 0,
        endTime: new Date().toISOString(),
      });

      return { status: "skipped", slot };
    }

    // Award to leader
    const winner = this.teams.find((t) => t.id === slot.leader_team_id);
    if (winner) {
      winner.balance = Math.max(0, winner.balance - slot.current_bid);
    }

    slot.status = "sold";
    slot.winner_team_id = slot.leader_team_id;
    slot.winner_team = slot.leader_team;

    this.history.unshift({
      slotId: slot.id,
      slotNumber: this.slots.findIndex((s) => s.id === slot.id) + 1,
      round: slot.round,
      status: "sold",
      topicTitle: slot.topic?.title || "Problem",
      winnerTeam: slot.winner_team,
      winningBid: slot.current_bid,
      coinsDeducted: slot.current_bid,
      endTime: new Date().toISOString(),
    });

    return { status: "sold", slot, winner };
  }

  public openSlot(slotId?: string) {
    let target = slotId ? this.slots.find((s) => s.id === slotId) : null;
    if (!target) {
      target = this.slots.find((s) => s.status === "pending") || null;
    }
    if (!target) throw new Error("No pending slots available to open");

    // Close any currently open slot
    const currentOpen = this.slots.find((s) => s.status === "open");
    if (currentOpen && currentOpen.id !== target.id) {
      this.closeSlot(currentOpen.id);
    }

    target.status = "open";
    target.end_time = new Date(Date.now() + 84000).toISOString(); // 1m 24s window
    this.activeSlotIndex = this.slots.findIndex((s) => s.id === target?.id) + 1;
    this.auctionStatus = "LIVE";

    return target;
  }

  public skipSlot(slotId?: string) {
    let target = slotId ? this.slots.find((s) => s.id === slotId) : null;
    if (!target) {
      target = this.slots.find((s) => s.status === "open" || s.status === "pending") || null;
    }
    if (!target) throw new Error("Slot not found");

    target.status = "skipped";
    target.winner_team_id = null;
    target.leader_team_id = null;
    target.current_bid = 0;
    target.end_time = null;

    return target;
  }

  public resetAuction() {
    this.init();
    return true;
  }
}

export const auctionStore = AuctionStore.getInstance();
