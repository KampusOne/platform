import { Fragment, type ReactNode } from "react";
import { Platform, Text, View } from "react-native";
import { useAppearance } from "@/src/lib/appearance";

type MathSegment =
  | { kind: "text"; value: string }
  | { kind: "fraction"; numerator: string; denominator: string };

const superscripts: Record<string, string> = {
  "0": "⁰", "1": "¹", "2": "²", "3": "³", "4": "⁴",
  "5": "⁵", "6": "⁶", "7": "⁷", "8": "⁸", "9": "⁹",
  "+": "⁺", "-": "⁻", "=": "⁼", "(": "⁽", ")": "⁾",
};

const subscripts: Record<string, string> = {
  "0": "₀", "1": "₁", "2": "₂", "3": "₃", "4": "₄",
  "5": "₅", "6": "₆", "7": "₇", "8": "₈", "9": "₉",
  "+": "₊", "-": "₋", "=": "₌", "(": "₍", ")": "₎",
  "a": "ₐ", "e": "ₑ", "h": "ₕ", "i": "ᵢ", "j": "ⱼ",
  "k": "ₖ", "l": "ₗ", "m": "ₘ", "n": "ₙ", "o": "ₒ",
  "p": "ₚ", "r": "ᵣ", "s": "ₛ", "t": "ₜ", "u": "ᵤ",
  "v": "ᵥ", "x": "ₓ",
};

function script(value: string, map: Record<string, string>) {
  return [...value].map((character) => map[character] ?? character).join("");
}

function normalizeMathText(input: string) {
  let value = input.trim();
  for (let pass = 0; pass < 3; pass += 1) {
    value = value.replace(/\\(?:text|mathrm|mathbf|operatorname)\{([^{}]*)\}/g, "$1");
    value = value.replace(/\\sqrt\{([^{}]+)\}/g, "√($1)");
  }

  value = value
    .replace(/\\left|\\right/g, "")
    .replace(/\\(?:quad|qquad|,|;|:)\b?/g, " ")
    .replace(/\\!/g, "")
    .replace(/\\cdot/g, "·")
    .replace(/\\times/g, "×")
    .replace(/\\div/g, "÷")
    .replace(/\\pm/g, "±")
    .replace(/\\leq?/g, "≤")
    .replace(/\\geq?/g, "≥")
    .replace(/\\neq/g, "≠")
    .replace(/\\approx/g, "≈")
    .replace(/\\rightarrow|\\to/g, "→")
    .replace(/\\infty/g, "∞")
    .replace(/\\Delta/g, "Δ")
    .replace(/\\delta/g, "δ")
    .replace(/\\theta/g, "θ")
    .replace(/\\lambda/g, "λ")
    .replace(/\\mu/g, "μ")
    .replace(/\\pi/g, "π")
    .replace(/\\rho/g, "ρ")
    .replace(/\\sigma/g, "σ")
    .replace(/\\omega/g, "ω")
    .replace(/\\alpha/g, "α")
    .replace(/\\beta/g, "β")
    .replace(/\\gamma/g, "γ")
    .replace(/\\sin/g, "sin")
    .replace(/\\cos/g, "cos")
    .replace(/\\tan/g, "tan")
    .replace(/\\log/g, "log")
    .replace(/\\ln/g, "ln")
    .replace(/\^\{([^{}]+)\}/g, (_, content: string) => script(content, superscripts))
    .replace(/\^([0-9+\-=()])/g, (_, content: string) => script(content, superscripts))
    .replace(/_\{([^{}]+)\}/g, (_, content: string) => script(content, subscripts))
    .replace(/_([0-9a-z+\-=()])/g, (_, content: string) => script(content, subscripts))
    .replace(/\\([A-Za-z]+)/g, "$1")
    .replace(/[{}]/g, "")
    .replace(/~/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  return value;
}

function mathToPlain(input: string) {
  let value = input;
  let previous = "";
  for (let pass = 0; pass < 6 && previous !== value; pass += 1) {
    previous = value;
    value = value.replace(/\\frac\{([^{}]+)\}\{([^{}]+)\}/g, "($1)/($2)");
  }
  return normalizeMathText(value);
}

function readBraced(input: string, start: number) {
  if (input[start] !== "{") return null;
  let depth = 0;
  for (let index = start; index < input.length; index += 1) {
    if (input[index] === "{") depth += 1;
    if (input[index] === "}") {
      depth -= 1;
      if (depth === 0) {
        return { value: input.slice(start + 1, index), end: index + 1 };
      }
    }
  }
  return null;
}

function splitMath(expression: string): MathSegment[] {
  const segments: MathSegment[] = [];
  const marker = "\\frac";
  let cursor = 0;

  while (cursor < expression.length) {
    const fractionIndex = expression.indexOf(marker, cursor);
    if (fractionIndex < 0) {
      const tail = mathToPlain(expression.slice(cursor));
      if (tail) segments.push({ kind: "text", value: tail });
      break;
    }

    const before = mathToPlain(expression.slice(cursor, fractionIndex));
    if (before) segments.push({ kind: "text", value: before });

    const numerator = readBraced(expression, fractionIndex + marker.length);
    if (!numerator) {
      const remaining = mathToPlain(expression.slice(fractionIndex));
      if (remaining) segments.push({ kind: "text", value: remaining });
      break;
    }

    const denominator = readBraced(expression, numerator.end);
    if (!denominator) {
      const remaining = mathToPlain(expression.slice(fractionIndex));
      if (remaining) segments.push({ kind: "text", value: remaining });
      break;
    }

    segments.push({
      kind: "fraction",
      numerator: mathToPlain(numerator.value),
      denominator: mathToPlain(denominator.value),
    });
    cursor = denominator.end;
  }

  return segments.length ? segments : [{ kind: "text", value: mathToPlain(expression) }];
}

function MathBlock({ value }: { value: string }) {
  const { theme } = useAppearance();
  const segments = splitMath(value);
  const mathText = {
    color: theme.text,
    fontFamily: theme.font.semibold,
    fontSize: 16,
    lineHeight: 23,
  };

  return (
    <View
      accessible
      accessibilityRole="text"
      accessibilityLabel={mathToPlain(value)}
      style={{
        flexDirection: "row",
        flexWrap: "wrap",
        alignItems: "center",
        gap: 4,
        marginVertical: 8,
        paddingVertical: 2,
      }}
    >
      {segments.map((segment, index) =>
        segment.kind === "fraction" ? (
          <View
            key={"fraction-" + index}
            style={{
              minWidth: 34,
              marginHorizontal: 3,
              alignItems: "stretch",
              justifyContent: "center",
            }}
          >
            <Text selectable style={{ ...mathText, textAlign: "center", fontSize: 15 }}>
              {segment.numerator}
            </Text>
            <View style={{ height: 1, backgroundColor: theme.text, marginVertical: 2 }} />
            <Text selectable style={{ ...mathText, textAlign: "center", fontSize: 15 }}>
              {segment.denominator}
            </Text>
          </View>
        ) : (
          <Text key={"math-" + index} selectable style={mathText}>
            {segment.value}
          </Text>
        ),
      )}
    </View>
  );
}

/** Deliberately no HTML, embedded media, or clickable model-generated URLs. */
export function StudyAnswer({ value }: { value: string }) {
  const { theme } = useAppearance();
  const base = { fontFamily: theme.font.body, color: theme.text, fontSize: 16, lineHeight: 27 };

  const inline = (line: string): ReactNode[] =>
    line.split(/(\*\*[^*]+\*\*|\x60[^\x60]+\x60|\$[^$\n]+\$|\\\([^)]*\\\))/g).map((part, index) => {
      if (part.startsWith("**") && part.endsWith("**")) {
        return (
          <Text key={index} style={{ fontFamily: theme.font.semibold }}>
            {part.slice(2, -2)}
          </Text>
        );
      }

      if (part.length >= 2 && part.charCodeAt(0) === 96 && part.charCodeAt(part.length - 1) === 96) {
        return (
          <Text
            key={index}
            style={{
              fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
              fontSize: 14,
              backgroundColor: theme.surfaceMuted,
            }}
          >
            {part.slice(1, -1)}
          </Text>
        );
      }

      const dollarMath = part.startsWith("$") && part.endsWith("$");
      const parenMath = part.startsWith("\\(") && part.endsWith("\\)");
      if (dollarMath || parenMath) {
        return (
          <Text key={index} style={{ fontFamily: theme.font.semibold }}>
            {mathToPlain(part.slice(dollarMath ? 1 : 2, dollarMath ? -1 : -2))}
          </Text>
        );
      }

      return <Fragment key={index}>{part}</Fragment>;
    });

  const blocks: ReactNode[] = [];
  let code: string[] | null = null;
  let math: string[] | null = null;
  const codeFence = String.fromCharCode(96, 96, 96);

  const flushMath = (key: string) => {
    if (!math) return;
    const expression = math.join(" ").trim();
    if (expression) blocks.push(<MathBlock key={key} value={expression} />);
    math = null;
  };

  for (const [index, line] of value.split("\n").entries()) {
    const trimmed = line.trim();

    if (line.startsWith(codeFence)) {
      if (math) flushMath("math-before-code-" + index);
      if (code) {
        blocks.push(
          <View
            key={"code-" + index}
            style={{ padding: 14, backgroundColor: theme.surfaceMuted, borderRadius: 10, marginVertical: 10 }}
          >
            <Text
              selectable
              style={{
                ...base,
                fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
                fontSize: 13,
                lineHeight: 21,
              }}
            >
              {code.join("\n")}
            </Text>
          </View>,
        );
        code = null;
      } else {
        code = [];
      }
      continue;
    }

    if (code) {
      code.push(line);
      continue;
    }

    const sameLineDollar = trimmed.match(/^\$\$(.+)\$\$$/);
    const sameLineBracket = trimmed.match(/^\\\[(.+)\\\]$/);
    if (sameLineDollar || sameLineBracket) {
      if (math) flushMath("math-before-inline-" + index);
      blocks.push(
        <MathBlock key={"math-inline-" + index} value={(sameLineDollar?.[1] ?? sameLineBracket?.[1] ?? "").trim()} />,
      );
      continue;
    }

    if (trimmed === "$$" || trimmed === "\\[" || trimmed === "\\]") {
      if (math) flushMath("math-" + index);
      else math = [];
      continue;
    }

    if (math) {
      math.push(line);
      continue;
    }

    if (!trimmed) {
      blocks.push(<View key={index} style={{ height: 9 }} />);
      continue;
    }

    const heading = line.match(/^(#{1,3})\s+(.+)$/);
    const list = line.match(/^\s*(?:[-*•]|(\d+)\.)\s+(.+)$/);

    if (heading) {
      blocks.push(
        <Text
          key={index}
          selectable
          style={{
            ...base,
            fontFamily: theme.font.semibold,
            fontSize: heading[1]?.length === 1 ? 21 : 18,
            lineHeight: 29,
            marginTop: 12,
            marginBottom: 6,
          }}
        >
          {inline(heading[2] ?? "")}
        </Text>,
      );
      continue;
    }

    if (list) {
      blocks.push(
        <View key={index} style={{ flexDirection: "row", gap: 10, marginVertical: 3 }}>
          <Text style={{ ...base, color: theme.brand, minWidth: 17 }}>{list[1] ? list[1] + "." : "•"}</Text>
          <Text selectable style={{ ...base, flex: 1 }}>
            {inline(list[2] ?? "")}
          </Text>
        </View>,
      );
      continue;
    }

    blocks.push(
      <Text key={index} selectable style={base}>
        {inline(line)}
      </Text>,
    );
  }

  if (math) flushMath("unfinished-math");
  if (code) {
    blocks.push(
      <Text key="unfinished-code" selectable style={base}>
        {code.join("\n")}
      </Text>,
    );
  }

  return <View>{blocks}</View>;
}
