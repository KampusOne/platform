import Image from "next/image";
import day from "../../mobile/assets/illustrations/intro-day.png";
import people from "../../mobile/assets/illustrations/intro-people.png";
import market from "../../mobile/assets/illustrations/intro-market.png";
export function AgentAccessIllustration() {
  return (
    <Image
      className="agent-illustration"
      src={market}
      sizes="(max-width: 800px) 90vw, 480px"
      alt="Students and vendors building a campus community"
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
