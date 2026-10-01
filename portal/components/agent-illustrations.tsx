import Image from "next/image";
import day from "../../mobile/assets/illustrations/auth-study-v2.png";
import people from "../../mobile/assets/illustrations/feed-empty-v2.png";
import market from "../../mobile/assets/illustrations/home-student-v2.png";
export function AgentAccessIllustration() {
  return (
    <Image
      className="agent-illustration"
      src={market}
      sizes="(max-width: 800px) 90vw, 480px"
      alt="A KampusOne student checking their phone"
      priority
    />
  );
}
export function AgentApplicationIllustration({
  complete = false,
  step = 0,
}: {
  complete?: boolean;
  step?: number;
}) {
  const art =
    complete || step === 2 ? market : step === 1 || step === 3 ? day : people;
  return (
    <Image
      className="agent-illustration agent-application-illustration"
      src={art}
      sizes="(max-width: 800px) 90vw, 360px"
      alt=""
    />
  );
}
