import { useLocalSearchParams } from "expo-router";
import { Text, View } from "react-native";
import { ToolPage } from "@/src/components/toolkit";
import { useAppearance } from "@/src/lib/appearance";
// Product policy draft. The operator must supply its legal identity, contact,
// retention periods and approved minor-agent terms before production launch.
const privacy = [
  [
    "Product activity",
    "KampusOne records screen names and tool completion or failure events to understand which features work. These events do not contain your private study prompts, documents or bank details.",
  ],
  [
    "Your information",
    "KampusOne uses account and university details to provide your campus services. Information you publish, such as your name, profile photo and posts, can be visible to other users.",
  ],
  [
    "Private information",
    "Identity documents, guardian details and bank details are not part of your public profile. Access is restricted to authorised verification, safety and payment workflows. Do not put these details in a public post.",
  ],
  [
    "Device permissions",
    "Photos and files are selected from your device when you choose to upload them. Notifications and location require device permission. You can change permissions in your device settings.",
  ],
  [
    "Payments and service providers",
    "Payment providers process payments and payouts. Infrastructure providers process the data needed to host, secure and deliver KampusOne. Do not submit card details through support messages.",
  ],
  [
    "Your choices",
    "You can edit your profile and preferences, sign out, revoke device sessions, and request a copy or deletion of your account information through Help & support. Some transaction and safety records may need to be retained.",
  ],
  [
    "Young agents",
    "Agent applications start at age 16. Applicants under 18 need a guardian approval process in addition to their own acceptance. Claiming a trial does not bypass identity or eligibility checks.",
  ],
];
const terms = [
  [
    "Your account",
    "Keep your login private and give accurate information. You are responsible for content and activities submitted through your account. Do not impersonate another person or use someone else’s identity documents.",
  ],
  [
    "Campus community",
    "Do not post scams, threats, harassment or unlawful content. Respect other people’s privacy and intellectual property. Report unsafe content through Help & support.",
  ],
  [
    "Buying and selling",
    "Check the item or service description, price and delivery information before paying. Sellers, tutors and riders must complete the required verification before offering services. Disputed transactions may be held while reviewed.",
  ],
  [
    "Trials and commissions",
    "Eligible approved sellers can claim a twelve-month trial without a subscription charge. Existing trials retain their saved start and end dates. The trial does not waive transaction commissions. Your earnings statement and withdrawal confirmation show applicable deductions. A trial does not automatically become a paid subscription without an agreed plan.",
  ],
  [
    "Refunds and restrictions",
    "Use the order support flow to request a refund or report a problem. Accounts may be restricted for safety or policy violations. You can submit an appeal through Help & support.",
  ],
  [
    "Academic information",
    "Check important academic information against your university’s official sources. Review imported timetables before saving. AI outputs, where available, may need correction.",
  ],
];
export default function Legal() {
  const { document } = useLocalSearchParams<{ document?: string }>();
  const { theme } = useAppearance();
  const sections = document === "terms" ? terms : privacy;
  return (
    <ToolPage
      title={document === "terms" ? "Terms of service" : "Privacy policy"}
    >
      {sections.map(([title, body]) => (
        <View key={title} style={{ marginBottom: 24 }}>
          <Text
            style={{
              fontFamily: theme.font.display,
              fontSize: 19,
              color: theme.text,
              marginBottom: 8,
            }}
          >
            {title}
          </Text>
          <Text
            style={{
              fontFamily: theme.font.body,
              fontSize: 14,
              lineHeight: 23,
              color: theme.textMuted,
            }}
          >
            {body}
          </Text>
        </View>
      ))}
    </ToolPage>
  );
}
