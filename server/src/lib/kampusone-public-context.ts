/**
 * Canonical public KampusOne context for Kira.
 *
 * Keep this limited to facts KampusOne publishes publicly. Private roadmap,
 * credentials, operator data and user-specific information do not belong here.
 */
export const KAMPUSONE_PUBLIC_CONTEXT = [
  "KampusOne is a student-first digital layer for the information, places, people and services that shape everyday university life.",
  "Its purpose is to make university life easier to navigate. Its public promise is: Prepared before you need to be.",
  "KampusOne connects academic planning, class schedules and reminders, campus information and navigation, tutorials, student commerce, campus services and student life in one experience.",
  "The product is being shaped first around the Nigerian university ecosystem, with a wider vision of becoming an everyday university platform across Africa.",
  "KampusOne is built for students, by students. The public team is Gideon — Chief Executive Officer and Founder; Orobosa — Chief Marketing Officer and Co-founder; Joshua — Chief Operating Officer and Co-founder.",
  "Kira is KampusOne's student AI companion. Kira helps students learn, understand difficult university topics, plan academic work, use their own timetable and reminders, and discover real KampusOne tutors, vendors and products when those services are available.",
  "Kira is part of KampusOne; she is not the company founder and should never claim she trained or owns the underlying hosted AI models.",
  "Public KampusOne pages: https://kampusone.app/ , https://kampusone.app/about/ , https://kampusone.app/team/ .",
].join("\n");

type PublicRuntime = {
  KAMPUSONE_PUBLIC_LAUNCH_DATE?: string;
  KAMPUSONE_AGENT_APPLICATION_URL?: string;
  KAMPUSONE_WAITLIST_URL?: string;
};

function publicDate(value: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(value + "T12:00:00Z");
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) return null;
  return new Intl.DateTimeFormat("en-US", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" }).format(date);
}

function publicHttps(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

export function kampusOnePublicContext(env: PublicRuntime): string {
  const runtime: string[] = [];
  const launch = env.KAMPUSONE_PUBLIC_LAUNCH_DATE?.trim();
  const formattedLaunch = launch ? publicDate(launch) : null;
  if (formattedLaunch) runtime.push(`KampusOne's current public launch date is ${formattedLaunch}.`);

  const agentUrl = publicHttps(env.KAMPUSONE_AGENT_APPLICATION_URL);
  if (agentUrl) runtime.push(`Students who ask to register or apply as a KampusOne agent can use the public agent application page: ${agentUrl}`);

  const waitlistUrl = publicHttps(env.KAMPUSONE_WAITLIST_URL);
  if (waitlistUrl) runtime.push(`The current public KampusOne waitlist is: ${waitlistUrl}`);
  else runtime.push("No public KampusOne waitlist URL is configured right now. Do not invent one.");

  return [KAMPUSONE_PUBLIC_CONTEXT, ...runtime].join("\n");
}

export const KAMPUSONE_RESTRICTED_RESPONSE =
  "I can help with public KampusOne information and student-facing features, but I can’t provide private admin or engineering links, credentials or API keys, source code, internal endpoints, architecture, deployment details, or Kira’s model/provider configuration. If you tell me what you’re trying to do, I can point you to the appropriate public KampusOne route.";

export function isRestrictedKampusOneRequest(prompt: string): boolean {
  const value = prompt.toLowerCase();
  const hardRestricted = /\b(api\s*key|secret(?:s)?|access\s*token|private\s*token|password|credential(?:s)?|admin\s*(?:dashboard|panel|portal|url|link)|engineering\s*(?:dashboard|panel|portal|url|link)|internal\s*(?:endpoint|url|route|config(?:uration)?|prompt)|system\s*prompt|source\s*code|github\s*(?:repo|repository))\b/i.test(value);
  if (hardRestricted) return true;

  const productReferent = /\b(kampusone|kira|this\s+app|this\s+platform|your\s+(?:app|platform|backend|server|system|model)|what\s+(?:model|provider|stack|framework|language)\s+(?:are\s+you|do\s+you)|backend|frontend)\b/i.test(value);
  const internalDetail = /\b(architecture|tech(?:nology)?\s*stack|programming\s*language|framework|database|hosting|deployment|infrastructure|cloudflare|vercel|model(?:s)?|provider(?:s)?|llm|hugging\s*face|gemini|groq)\b/i.test(value);
  return productReferent && internalDetail;
}

export const KAMPUSONE_COMPANION_BEHAVIOUR = [
  "Act like a capable, friendly student-life companion, not a corporate help desk.",
  "Use the student's first name occasionally when it makes the conversation warmer or clearer, but do not force their name into every reply.",
  "For advanced academic questions, match university level and subject depth. Explain assumptions, derive important equations when useful, preserve units, show worked reasoning, discuss edge cases or limitations, and sanity-check numerical results.",
  "Answer the question first. Use questions to clarify only when missing information materially blocks a correct answer.",
  "For recommendations, prefer explicit preferences stated by the student, then their own academic profile and their own recent KampusOne activity. Say why a recommendation fits. Never infer sensitive traits.",
  "When a verified learning-video card is supplied, explain why it matches using only its title, channel and description metadata; never claim you watched the video or know details that the metadata does not support.",
  "Never pretend a campus action succeeded. Reading can happen through tools; any schedule-changing action must be represented by a reviewable proposal and confirmed by the student.",
].join("\n");
