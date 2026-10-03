import Image from "next/image";
import day from "../../mobile/assets/illustrations/intro-plan-original.png";
import people from "../../mobile/assets/illustrations/intro-people-original.png";
import market from "../../mobile/assets/illustrations/intro-services-original.png";
import styles from "./agent-intake.module.css";

export function AgentRoleChoices({
  value,
  onChange,
}: {
  value: string;
  onChange(value: string): void;
}) {
  const roles = [
    {
      value: "VENDOR",
      name: "Vendor",
      copy: "Sell products on campus",
      art: market,
    },
    { value: "TUTOR", name: "Tutor", copy: "Help students learn", art: day },
    {
      value: "RIDER",
      name: "Rider",
      copy: "Deliver campus orders",
      art: "/brand-scenes/rider-illustration.svg",
    },
  ];
  return (
    <fieldset className={styles.roleField}>
      <legend>How would you like to work with students?</legend>
      <div className={styles.roleOptions}>
        {roles.map((role) => (
          <label
            key={role.value}
            className={
              value === role.value ? styles.selectedRole : styles.roleOption
            }
          >
            <input
              type="radio"
              name="agentType"
              value={role.value}
              checked={value === role.value}
              onChange={() => onChange(role.value)}
            />
            <Image
              src={role.art}
              alt=""
              width={180}
              height={120}
              sizes="(max-width: 440px) 80px, 140px"
            />
            <strong>{role.name}</strong>
            <small>{role.copy}</small>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
export function AgentAccessIllustration() {
  return (
    <Image
      className="agent-illustration"
      src={market}
      sizes="(max-width: 800px) 90vw, 480px"
      alt="A KampusOne student picking up a campus purchase"
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
      priority
    />
  );
}
